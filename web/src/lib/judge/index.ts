// The judge: rules on every challenge the contract is paused on. If any check fails it does not
// rule, and the contract's yield times out into refunds for both sides.

import { Account, JsonRpcProvider, teraToGas, type KeyPairString } from "near-api-js";
import { checkAccount } from "../signals";
import { CONTRACT_ID, TESTNET_RPC, view, type Claim, type Side } from "../vouch";
import { attestModel, sha256 } from "./attestation";
import { askJudge, verifyAnswer } from "./ruling";

export const JUDGE_MODEL = process.env.JUDGE_MODEL ?? "Qwen/Qwen3.6-35B-A3B-FP8";

export type Outcome =
  | { claimId: string; ruled: true; winner: Side; summary: string; attestation: string; transaction: string }
  | { claimId: string; ruled: false; error: string };

function judgeAccount() {
  const id = process.env.JUDGE_ACCOUNT_ID;
  const key = process.env.JUDGE_PRIVATE_KEY as KeyPairString | undefined;
  if (!id || !key) throw new Error("JUDGE_ACCOUNT_ID and JUDGE_PRIVATE_KEY must be set");
  return new Account(id, new JsonRpcProvider({ url: TESTNET_RPC }), key);
}

export async function judgeWaiting(): Promise<Outcome[]> {
  const waiting = await view<Claim[]>("get_waiting");
  const outcomes: Outcome[] = [];
  for (const claim of waiting) {
    try {
      outcomes.push(await judgeClaim(claim));
    } catch (e) {
      outcomes.push({ claimId: claim.id, ruled: false, error: (e as Error).message });
    }
  }
  return outcomes;
}

async function judgeClaim(claim: Claim): Promise<Outcome> {
  const [attestation, facts] = await Promise.all([
    attestModel(JUDGE_MODEL),
    checkAccount(claim.subject).catch(() => null),
  ]);
  if (!attestation.trusted.length) {
    const why = attestation.rejected.map((r) => r.reason).join("; ") || "no nodes reported";
    throw new Error(`No model node passed attestation: ${why}`);
  }

  const answer = await askJudge(JUDGE_MODEL, claim, facts);
  const signature = await verifyAnswer(answer, attestation);

  // Everything needed to re-check this ruling. It travels in the transaction's arguments.
  const proof = JSON.stringify({
    version: 1,
    claim_id: claim.id,
    model: JUDGE_MODEL,
    nonce: attestation.nonce,
    trusted_nodes: attestation.trusted,
    signature,
    request: answer.requestBody,
    response: answer.responseBody,
  });
  const attestationHash = `sha256:${sha256(proof)}`;

  const tx = await judgeAccount().callFunctionRaw({
    contractId: CONTRACT_ID,
    methodName: "submit_ruling",
    args: {
      claim_id: claim.id,
      ruling: { winner: answer.winner, summary: answer.summary, model: JUDGE_MODEL, attestation: attestationHash },
      proof,
    },
    gas: teraToGas("100"),
  });

  return {
    claimId: claim.id,
    ruled: true,
    winner: answer.winner,
    summary: answer.summary,
    attestation: attestationHash,
    transaction: tx.transaction.hash,
  };
}
