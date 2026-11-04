// Re-checks a judge's ruling from what's on-chain, without Vouch's servers. The contract keeps only a hash of
// each proof, and the proof itself sits in the judge's transaction.
//
// It rebuilds the exact request the model was asked from the claim on-chain, then checks the signature, and
// Intel's and NVIDIA's verdicts on the raw evidence. Exit 0 means every check passed, 1 means one failed, and
// 2 means the ruling can't be fully checked. What it can't catch: a stolen judge key could still get a real TEE
// answer to a case file with false chain facts, or ask until it likes the answer. It prints the facts to compare.
//
// Run: pnpm verify:ruling <claim id> [transaction hash]
// Needs no keys. Without a hash, it looks through what the judge has signed for the ruling.

import { getCollateralAndVerify } from "@phala/dcap-qvl";
import { verifyMessage } from "ethers";
import { checkGpuToken, sha256 } from "../src/lib/judge/attestation";
import { buildRequest, caseRef } from "../src/lib/judge/ruling";
import { firstJsonObject, truncateBytes } from "../src/lib/llm";
import { CONTRACT_ID, nanosToMs, view, type Claim, type Config, type Round } from "../src/lib/vouch";

// Ordinary RPC nodes forget transactions after a few days.
const ARCHIVAL_RPC = "https://archival-rpc.testnet.fastnear.com";
const MAX_SUMMARY_BYTES = 1000;
const CLOCK_SKEW_MS = 120_000;
const MAX_RATE_LIMIT_WAITS = 6;
const RATE_LIMIT_WAIT_MS = 3000;
const UNVERIFIED = 2;

const [claimId, givenHash] = process.argv.slice(2);
if (!claimId) throw new Error("Usage: pnpm verify:ruling <claim id> [transaction hash]");

// Looks through what the judge has signed for the newest call that ruled on this claim. A second ping can
// race the first, and the contract refuses the loser, so only a call that succeeded counts.
async function findRulingTx(judge: string): Promise<string> {
  const listed = await fetch("https://tx.test.fastnear.com/v0/account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account_id: judge, is_signer: true, limit: 200 }),
  }).then((r) => r.json());
  const hashes: string[] = (listed.account_txs ?? []).map((t: { transaction_hash: string }) => t.transaction_hash);
  for (const hash of hashes) {
    const res = await readTx(hash, judge);
    const call = res.result?.transaction?.actions?.[0]?.FunctionCall;
    if (call?.method_name !== "submit_ruling" || res.result.status?.Failure) continue;
    const args = JSON.parse(Buffer.from(call.args, "base64").toString("utf8"));
    if (String(args.claim_id) === claimId) return hash;
  }
  throw new Error("Couldn't find the ruling's transaction. Pass its hash.");
}

// The public archival node limits how fast it answers, so this waits and tries again.
async function readTx(hash: string, sender: string) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(ARCHIVAL_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tx", params: { tx_hash: hash, sender_account_id: sender, wait_until: "FINAL" } }),
    }).then((r) => r.json());
    if (res.error?.code !== -429 || attempt >= MAX_RATE_LIMIT_WAITS) return res;
    await new Promise((r) => setTimeout(r, RATE_LIMIT_WAIT_MS * (attempt + 1)));
  }
}

let failed = 0;
function check(ok: boolean, what: string) {
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}`);
}

async function main() {
  const [claim, config, rounds] = await Promise.all([
    view<Claim | null>("get_claim", { claim_id: claimId }),
    view<Config>("get_config"),
    view<Round[]>("get_rounds", { claim_id: claimId }),
  ]);
  // A call the agent defended reopens, and its earlier rulings move to its rounds.
  const rulings = [claim?.ruling, ...rounds.map((r) => r.ruling)].filter((r) => !!r);
  if (!rulings.length) throw new Error(`Claim ${claimId} has no ruling`);

  const txHash = givenHash ?? (await findRulingTx(config.judge));
  const res = await readTx(txHash, config.judge);
  const tx = res.result?.transaction;
  if (!tx) throw new Error(`Couldn't read transaction ${txHash}: ${JSON.stringify(res.error).slice(0, 200)}`);
  const call = tx.actions?.[0]?.FunctionCall;
  const args = JSON.parse(Buffer.from(call.args, "base64").toString("utf8"));
  const ruling = rulings.find((r) => r.attestation.endsWith(sha256(args.proof))) ?? rulings[0];

  console.log(`Claim ${claimId} on ${CONTRACT_ID}, ruled for the ${ruling.winner} by ${ruling.model}\n`);
  console.log("The transaction");
  check(!res.result.status?.Failure, "it succeeded on-chain");
  check(tx.signer_id === config.judge, `signed by the contract's judge, ${config.judge}`);
  check(tx.receiver_id === CONTRACT_ID && call.method_name === "submit_ruling", "a submit_ruling call on this contract");
  check(String(args.claim_id) === claimId, "for this claim");

  if (ruling.attestation.startsWith("unverified:")) {
    console.log(`\nUNVERIFIED: this ruling came from the stand-in judge outside a TEE, and carries no attestation.`);
    check(`unverified:sha256:${sha256(args.proof)}` === ruling.attestation, "its record matches the hash on the claim");
    process.exit(failed ? 1 : UNVERIFIED);
  }

  console.log("\nThe proof");
  check(`sha256:${sha256(args.proof)}` === ruling.attestation, "its hash matches the one stored on the claim");
  const proof = JSON.parse(args.proof);
  check(proof.model === ruling.model, "it names the same model as the ruling");

  console.log("\nThe model's answer");
  const expected = `${proof.model}:${sha256(proof.request)}:${sha256(proof.response)}`;
  check(proof.signature.text === expected, "the signature covers this exact request and response");
  const signer = verifyMessage(proof.signature.text, proof.signature.signature).toLowerCase();
  check(signer === proof.signature.signingAddress.toLowerCase(), `it was signed by ${signer}`);
  check(proof.signature.signatureKind === "provider_tee", "by a key held in the TEE");
  const content = JSON.parse(proof.response).choices[0].message.content;
  const answer = firstJsonObject(content) as { winner: string; summary: string };
  check(answer.winner === ruling.winner, "the answer's winner is the ruling's winner");
  check(ruling.summary === truncateBytes(String(answer.summary).trim(), MAX_SUMMARY_BYTES), "the answer's summary is the ruling's summary");

  // Everything in a proof but the signed request is the judge's own word, including what it says about the
  // TEE, so a proof without raw hardware evidence proves nothing about the hardware.
  if (proof.version !== 2) {
    console.log("\nUNVERIFIED: this is an older proof, without the raw hardware evidence. Nothing above shows that a TEE made it.");
    process.exit(failed ? 1 : UNVERIFIED);
  }

  console.log("\nThe request");
  const target = claim as Claim;
  const challenge = rounds.find((r) => r.ruling?.attestation === ruling.attestation)?.challenge ?? target.challenge;
  const request = JSON.parse(proof.request);
  const boundary = /<untrusted_([0-9a-f]+)>/.exec(request.messages?.[0]?.content ?? "")?.[1] ?? "";
  const user: string = request.messages?.[1]?.content ?? "";
  const requestId = /^request_id: (.*)$/m.exec(user)?.[1] ?? "";
  const chainFacts = /^chain_facts: (.*)$/m.exec(user)?.[1] ?? "{}";
  const rebuilt = buildRequest(proof.model, target, challenge?.evidence ?? "", { boundary, requestId, chainFacts });
  check(rebuilt === proof.request, `the signed request is exactly ${caseRef(claimId)}: the judge's instructions, and the account, call, reasons and evidence on-chain`);
  const facts = JSON.parse(chainFacts);
  const filedAt = challenge ? nanosToMs(challenge.filed_at) : 0;
  const ruledAt = nanosToMs(ruling.ruled_at);
  const readAt = new Date(facts.read_at).getTime();
  check(readAt >= filedAt - CLOCK_SKEW_MS && readAt <= ruledAt + CLOCK_SKEW_MS, "the chain facts were read between the challenge and the ruling");
  console.log(`\n  The chain facts the judge was given, which only a re-read can check:\n  ${chainFacts.slice(0, 600)}`);

  const node = proof.signer_node;
  check(node.signingAddress.toLowerCase() === signer, "the proof's node is the signer");
  if (!node.intelQuote) {
    console.log("\nUNVERIFIED: this proof has no raw hardware evidence, so nothing shows that a TEE made it.");
    process.exit(failed ? 1 : UNVERIFIED);
  }

  console.log("\nThe hardware");
  const quote = Buffer.from(node.intelQuote, "base64");
  const verified = await getCollateralAndVerify(quote);
  check(["UpToDate", "SWHardeningNeeded"].includes(verified.status), `Intel verifies the quote: platform status ${verified.status}`);
  const td = verified.report.asTd10() ?? verified.report.asTd15()?.base;
  if (!td) throw new Error("Not a TDX quote");
  check(!(td.tdAttributes[0] & 1), "it isn't a debug VM");
  const identity = Buffer.from(node.signingAddress.replace(/^0x/, ""), "hex");
  const bound = Buffer.concat([identity, Buffer.alloc(32 - identity.length), Buffer.from(proof.nonce, "hex")]);
  check(Buffer.from(td.reportData).equals(bound), "the quote binds the signing key and the judge's nonce");
  await checkGpuToken(node.gpuToken, proof.nonce, { ignoreExpiry: true })
    .then(() => {
      check(true, "NVIDIA signed a passing GPU verdict with the same nonce");
      const issued = JSON.parse(Buffer.from(node.gpuToken.split(".")[1], "base64url").toString("utf8")).iat * 1000;
      check(issued >= filedAt - CLOCK_SKEW_MS && issued <= ruledAt + CLOCK_SKEW_MS, "and issued it between the challenge and the ruling");
    })
    .catch((e: Error) => check(false, `NVIDIA's verdict: ${e.message}`));

  console.log(failed ? `\n${failed} check(s) failed.` : "\nEvery check passed. This doesn't re-run the event log, app identity or gateway checks, and can't show that the chain facts above were true.");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
