// Checks that the model the judge asks runs in a genuine TEE, following
// https://docs.near.ai/cloud/verification. A node is trusted only if all of this holds:
// - its Intel TDX quote verifies on a patched platform, and it isn't a debug VM
// - the quote binds our fresh nonce and the node's signing address
// - its event log replays to the registers in the quote, and names the software in its app description
// - that software is NEAR AI's, or matches a pinned hash when one is set
// - NVIDIA signed a passing verdict on its GPUs, carrying our nonce
// NEAR AI's gateway has to pass the same hardware checks.

import { createHash, createPublicKey, randomBytes, verify, type JsonWebKey } from "node:crypto";
import { getCollateralAndVerify } from "@phala/dcap-qvl";
import { NEARAI_API, nearAiHeaders, readCapped } from "../llm";

const NRAS = "https://nras.attestation.nvidia.com/v3/attest/gpu";
const NRAS_ISSUER = "https://nras.attestation.nvidia.com";
const NRAS_KEYS = `${NRAS_ISSUER}/.well-known/jwks.json`;
// A patched platform. ConfigurationNeeded, OutOfDate, Revoked and Unknown all fail.
const ACCEPTED_TCB = new Set(["UpToDate", "SWHardeningNeeded"]);
// The software NEAR AI's model nodes are launched by. Anyone can rent a TDX VM, so genuine hardware
// alone doesn't say whose code ran on it.
const NEAR_AI_IMAGE = "nearaidev/compose-manager@sha256:";
const MAX_REPORT_BYTES = 2 * 1024 * 1024;

type EventLogEntry = { imr: number; digest: string; event?: string; event_payload?: string };

type TcbInfo = { app_compose?: string | object; event_log?: EventLogEntry[] };

type NodeInfo = { compose_hash?: string; os_image_hash?: string; tcb_info?: TcbInfo | string };

type ReportedNode = {
  request_nonce?: string;
  signing_address?: string;
  signing_algo?: string;
  intel_quote?: string;
  nvidia_payload?: string | object;
  tls_cert_fingerprint?: string;
  info?: NodeInfo;
};

export type TrustedNode = {
  signingAddress: string;
  tcbStatus: string;
  advisories: string[];
  quoteSha256: string;
  mrTd: string;
  composeHash: string;
  osImageHash: string | null;
  gpuVerified: true;
  // The raw evidence, so anyone can re-check it later from the proof alone.
  intelQuote: string;
  gpuToken: string;
};

export type Attestation = {
  model: string;
  nonce: string;
  trusted: TrustedNode[];
  rejected: { signingAddress: string | null; reason: string }[];
};

export const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

const parseMaybe = <T>(value: T | string): T => (typeof value === "string" ? (JSON.parse(value) as T) : value);
const hexOf = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

async function fetchReport(model: string, nonce: string) {
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
  const body = await readCapped(res, MAX_REPORT_BYTES);
  if (!res.ok) throw new Error(`Attestation report failed: ${res.status} ${body.slice(0, 200)}`);
  return JSON.parse(body) as { model_attestations?: ReportedNode[]; gateway_attestation?: ReportedNode };
}

export async function attestModel(model: string): Promise<Attestation> {
  const nonce = randomBytes(32).toString("hex");
  const report = await fetchReport(model, nonce);

  if (!report.gateway_attestation) throw new Error("Report has no gateway attestation");
  await checkHardware(report.gateway_attestation, nonce);

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

// Is this genuine, patched, non-debug hardware, bound to our nonce, running what it says it's running?
export async function checkHardware(node: ReportedNode, nonce: string) {
  if (node.request_nonce !== nonce) throw new Error("Report does not echo our nonce");
  if (node.signing_algo !== "ecdsa" || !node.signing_address) throw new Error("Report has no ECDSA signing address");
  if (!node.intel_quote) throw new Error("Report has no TDX quote");

  const quote = Buffer.from(node.intel_quote, "hex");
  const verified = await getCollateralAndVerify(quote);
  if (!ACCEPTED_TCB.has(verified.status)) throw new Error(`TDX platform status is ${verified.status}`);

  const td = verified.report.asTd10() ?? verified.report.asTd15()?.base;
  if (!td) throw new Error("Quote is not a TDX quote");
  // Bit 0 is DEBUG: the host could read and change the VM's memory, and the quote would still verify.
  if (td.tdAttributes[0] & 1) throw new Error("Quote is from a debug VM");

  const identity = Buffer.from(node.signing_address.replace(/^0x/, ""), "hex");
  const bound = node.tls_cert_fingerprint
    ? createHash("sha256").update(Buffer.concat([identity, Buffer.from(node.tls_cert_fingerprint, "hex")])).digest()
    : Buffer.concat([identity, Buffer.alloc(32 - identity.length)]);
  const expected = Buffer.concat([bound, Buffer.from(nonce, "hex")]);
  if (!Buffer.from(td.reportData).equals(expected)) {
    throw new Error("Quote does not bind this signing address and nonce");
  }

  // The event log is a claim until it replays to the registers the hardware signed. It's the copy in the
  // app info: the top-level copy leaves out the digests of the app's own events.
  const tcb = node.info?.tcb_info ? parseMaybe<TcbInfo>(node.info.tcb_info) : null;
  if (!tcb?.event_log?.length) throw new Error("Report has no event log");
  const log = tcb.event_log;
  const registers = [Buffer.alloc(48), Buffer.alloc(48), Buffer.alloc(48), Buffer.alloc(48)];
  for (const entry of log) {
    if (entry.imr < 0 || entry.imr > 3) continue;
    registers[entry.imr] = createHash("sha384")
      .update(Buffer.concat([registers[entry.imr], Buffer.from(entry.digest, "hex")]))
      .digest();
  }
  const signed = [td.rtMr0, td.rtMr1, td.rtMr2, td.rtMr3];
  registers.forEach((register, i) => {
    if (!register.equals(Buffer.from(signed[i]))) throw new Error(`Event log does not replay to RTMR${i}`);
  });

  // The replayed log names a hash of the app description, so the description can be trusted too.
  if (!tcb.app_compose) throw new Error("Report has no app description");
  const composeText = typeof tcb.app_compose === "string" ? tcb.app_compose : JSON.stringify(tcb.app_compose);
  const composeHash = sha256(composeText);
  const named = log.find((entry) => entry.event === "compose-hash")?.event_payload;
  if (named !== composeHash) throw new Error("The app description does not match the event log");

  return { quote, verified, td, composeText, composeHash, signingAddress: node.signing_address, osImageHash: node.info?.os_image_hash ?? null };
}

async function checkNode(node: ReportedNode, nonce: string): Promise<TrustedNode> {
  const { quote, verified, td, composeText, composeHash, signingAddress, osImageHash } = await checkHardware(node, nonce);

  const pinned = process.env.JUDGE_TRUSTED_COMPOSE_HASHES?.split(",").map((h) => h.trim()).filter(Boolean);
  if (pinned?.length) {
    if (!pinned.includes(composeHash)) throw new Error(`App hash ${composeHash} is not pinned`);
  } else if (!composeText.includes(NEAR_AI_IMAGE)) {
    throw new Error("The app is not NEAR AI's model software");
  }

  const gpuToken = await checkGpu(node.nvidia_payload, nonce);

  return {
    signingAddress,
    tcbStatus: verified.status,
    advisories: verified.advisory_ids ?? [],
    quoteSha256: sha256(quote),
    mrTd: hexOf(td.mrTd),
    composeHash,
    osImageHash,
    gpuVerified: true,
    intelQuote: quote.toString("base64"),
    gpuToken,
  };
}

let nvidiaKeys: Promise<Record<string, JsonWebKey>> | null = null;
function nvidiaKey(kid: string) {
  nvidiaKeys ??= fetch(NRAS_KEYS, { signal: AbortSignal.timeout(15_000) })
    .then((r) => r.json())
    .then((j: { keys: (JsonWebKey & { kid: string })[] }) => Object.fromEntries(j.keys.map((k) => [k.kid, k])))
    .catch((e) => {
      nvidiaKeys = null;
      throw e;
    });
  return nvidiaKeys.then((keys) => keys[kid]);
}

// Verifies NVIDIA's signed token. Exported so the same check can re-verify a stored proof.
export async function checkGpuToken(token: string, nonce: string, { ignoreExpiry = false } = {}) {
  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) throw new Error("NVIDIA's verdict is not a signed token");
  const { kid, alg } = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
  if (alg !== "ES384") throw new Error(`NVIDIA's token uses ${alg}, not ES384`);
  const jwk = await nvidiaKey(kid);
  if (!jwk) throw new Error("NVIDIA's token names an unknown key");
  const valid = verify(
    "sha384",
    Buffer.from(`${header}.${payload}`),
    { key: createPublicKey({ key: jwk, format: "jwk" }), dsaEncoding: "ieee-p1363" },
    Buffer.from(signature, "base64url"),
  );
  if (!valid) throw new Error("NVIDIA's signature does not verify");

  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (claims.iss !== NRAS_ISSUER) throw new Error("NVIDIA's token has the wrong issuer");
  if (!ignoreExpiry && claims.exp * 1000 < Date.now()) throw new Error("NVIDIA's token has expired");
  // The nonce inside the signed token: the one outside it is only what the node chose to send.
  if (String(claims.eat_nonce).toLowerCase() !== nonce) throw new Error("NVIDIA's token does not carry our nonce");
  if (claims["x-nvidia-overall-att-result"] !== true) throw new Error("NVIDIA did not pass the GPUs");
}

async function checkGpu(payload: ReportedNode["nvidia_payload"], nonce: string) {
  if (!payload) throw new Error("Report has no GPU evidence");
  const evidence = parseMaybe<{ nonce?: unknown }>(payload as string | { nonce?: unknown });
  const res = await fetch(NRAS, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(evidence),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`NVIDIA attestation failed: ${res.status}`);
  const verdict: unknown[] = JSON.parse(await readCapped(res));
  const overall = verdict.find((item): item is [string, string] => Array.isArray(item) && item[0] === "JWT");
  if (!overall) throw new Error("NVIDIA returned no overall verdict");
  await checkGpuToken(overall[1], nonce);
  return overall[1];
}
