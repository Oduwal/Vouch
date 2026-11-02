// Checks that the model the judge asks runs in a genuine TEE, following
// https://docs.near.ai/cloud/verification. A node is trusted only if its Intel TDX quote verifies,
// the quote binds our fresh nonce and the node's signing address, and NVIDIA confirms its GPUs.

import { createHash, randomBytes } from "node:crypto";
import { getCollateralAndVerify } from "@phala/dcap-qvl";

export const NEARAI_API = "https://cloud-api.near.ai/v1";
const NRAS = "https://nras.attestation.nvidia.com/v3/attest/gpu";
// TCB states that still mean a patched, genuine TDX platform. OutOfDate, Revoked and Unknown fail.
const ACCEPTED_TCB = new Set(["UpToDate", "SWHardeningNeeded", "ConfigurationNeeded", "ConfigurationAndSWHardeningNeeded"]);

type ModelReport = {
  request_nonce?: string;
  signing_address?: string;
  signing_algo?: string;
  intel_quote?: string;
  nvidia_payload?: string;
  tls_cert_fingerprint?: string;
};

export type TrustedNode = {
  signingAddress: string;
  tcbStatus: string;
  quoteSha256: string;
  gpuVerified: true;
};

export type Attestation = {
  model: string;
  nonce: string;
  trusted: TrustedNode[];
  rejected: { signingAddress: string | null; reason: string }[];
};

export const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

export function nearAiHeaders(): Record<string, string> {
  const key = process.env.NEARAI_API_KEY;
  if (!key) throw new Error("NEARAI_API_KEY is not set");
  return { Authorization: `Bearer ${key}`, Accept: "application/json", "x-no-aliasing": "true" };
}

export async function attestModel(model: string): Promise<Attestation> {
  const nonce = randomBytes(32).toString("hex");
  const params = new URLSearchParams({
    model,
    provider: "near",
    signing_algo: "ecdsa",
    include_tls_fingerprint: "false",
    nonce,
  });
  const res = await fetch(`${NEARAI_API}/attestation/report?${params}`, {
    headers: nearAiHeaders(),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Attestation report failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const report: { model_attestations?: ModelReport[] } = await res.json();

  const results = await Promise.all(
    (report.model_attestations ?? []).map(async (node) => {
      try {
        return { ok: true as const, node: await checkNode(node, nonce) };
      } catch (e) {
        return { ok: false as const, signingAddress: node.signing_address ?? null, reason: (e as Error).message };
      }
    }),
  );

  return {
    model,
    nonce,
    trusted: results.flatMap((r) => (r.ok ? [r.node] : [])),
    rejected: results.flatMap((r) => (r.ok ? [] : [{ signingAddress: r.signingAddress, reason: r.reason }])),
  };
}

async function checkNode(node: ModelReport, nonce: string): Promise<TrustedNode> {
  if (node.request_nonce !== nonce) throw new Error("Report does not echo our nonce");
  if (node.signing_algo !== "ecdsa" || !node.signing_address) throw new Error("Report has no ECDSA signing address");
  if (!node.intel_quote) throw new Error("Report has no TDX quote");

  const quote = Buffer.from(node.intel_quote, "hex");
  const verified = await getCollateralAndVerify(quote);
  if (!ACCEPTED_TCB.has(verified.status)) throw new Error(`TDX platform status is ${verified.status}`);

  const td = verified.report.asTd10() ?? verified.report.asTd15()?.base;
  if (!td) throw new Error("Quote is not a TDX quote");
  const identity = Buffer.from(node.signing_address.replace(/^0x/, ""), "hex");
  const bound = node.tls_cert_fingerprint
    ? createHash("sha256").update(Buffer.concat([identity, Buffer.from(node.tls_cert_fingerprint, "hex")])).digest()
    : Buffer.concat([identity, Buffer.alloc(32 - identity.length)]);
  const expected = Buffer.concat([bound, Buffer.from(nonce, "hex")]);
  if (!Buffer.from(td.reportData).equals(expected)) {
    throw new Error("Quote does not bind this signing address and nonce");
  }

  await checkGpu(node.nvidia_payload, nonce);

  return {
    signingAddress: node.signing_address,
    tcbStatus: verified.status,
    quoteSha256: sha256(quote),
    gpuVerified: true,
  };
}

async function checkGpu(payload: string | undefined, nonce: string) {
  if (!payload) throw new Error("Report has no GPU evidence");
  const evidence = JSON.parse(payload);
  if (String(evidence.nonce).toLowerCase() !== nonce) throw new Error("GPU evidence does not carry our nonce");

  const res = await fetch(NRAS, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(evidence),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`NVIDIA attestation failed: ${res.status}`);
  const verdict: unknown[] = await res.json();
  const overall = verdict.find((item): item is [string, string] => Array.isArray(item) && item[0] === "JWT");
  if (!overall) throw new Error("NVIDIA returned no overall verdict");
  const claims = JSON.parse(Buffer.from(overall[1].split(".")[1], "base64url").toString("utf8"));
  if (claims["x-nvidia-overall-att-result"] !== true) throw new Error("NVIDIA did not pass the GPUs");
}
