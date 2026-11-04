// Re-checks a judge's ruling from the chain alone, trusting nothing Vouch's servers say. The contract
// keeps only a hash of each proof, and the proof itself sits in the judge's transaction.
//
// Run: pnpm verify:ruling <claim id> [transaction hash]
// Needs no keys. Without a hash, it looks through what the judge has signed for the ruling.

import { getCollateralAndVerify } from "@phala/dcap-qvl";
import { verifyMessage } from "ethers";
import { checkGpuToken, sha256 } from "../src/lib/judge/attestation";
import { caseRef } from "../src/lib/judge/ruling";
import { firstJsonObject } from "../src/lib/llm";
import { CONTRACT_ID, TESTNET_RPC, view, type Claim, type Config, type Round } from "../src/lib/vouch";

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

function readTx(hash: string, sender: string) {
  return fetch(TESTNET_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tx", params: { tx_hash: hash, sender_account_id: sender, wait_until: "FINAL" } }),
  }).then((r) => r.json());
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
    console.log(`\nThis ruling came from the stand-in judge outside a TEE, and carries no attestation.`);
    check(`unverified:sha256:${sha256(args.proof)}` === ruling.attestation, "its record matches the hash on the claim");
    process.exit(failed ? 1 : 0);
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
  check(ruling.summary.startsWith(String(answer.summary).trim().slice(0, 200)), "the answer's summary is the ruling's summary");

  if (proof.version < 2) {
    console.log("\nThis is a version 1 proof. It records the attestation's results and a hash of the quote, not the raw evidence, so the hardware can't be re-checked from it.");
    const trusted = (proof.trusted_nodes ?? []).some((n: { signingAddress: string }) => n.signingAddress.toLowerCase() === signer);
    check(trusted, "the signer is among the nodes it says passed attestation");
    process.exit(failed ? 1 : 0);
  }

  check(proof.case === caseRef(claimId) && proof.request.includes(caseRef(claimId)), "the signed request names this exact case");

  const node = proof.signer_node;
  check(node.signingAddress.toLowerCase() === signer, "the proof's node is the signer");
  if (!node.intelQuote) {
    console.log("\nThe raw evidence was left out to fit the size limit. The hashes above still bind the answer.");
    process.exit(failed ? 1 : 0);
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
    .then(() => check(true, "NVIDIA signed a passing GPU verdict with the same nonce"))
    .catch((e: Error) => check(false, `NVIDIA's verdict: ${e.message}`));

  console.log(failed ? `\n${failed} check(s) failed.` : "\nEvery check passed.");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
