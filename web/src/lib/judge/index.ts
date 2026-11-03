// The judge: rules on every challenge the contract is paused on. If any check fails it does not
// rule, and the contract's yield times out into refunds for both sides.

import { checkAccount } from "../signals";
import { view, type Claim } from "../vouch";
import { attestModel, sha256 } from "./attestation";
import { askJudge, verifyAnswer } from "./ruling";
import { submitRuling, type Outcome } from "./submit";
import { ruleUnverified, unverifiedMode } from "./unverified";

export const JUDGE_MODEL = process.env.JUDGE_MODEL ?? "Qwen/Qwen3.6-35B-A3B-FP8";

export async function judgeWaiting(): Promise<Outcome[]> {
  const waiting = await view<Claim[]>("get_waiting");
  const rule = unverifiedMode() ? ruleUnverified : judgeClaim;
  const outcomes: Outcome[] = [];
  for (const claim of waiting) {
    try {
      outcomes.push(await rule(claim));
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

  return submitRuling(
    claim.id,
    { winner: answer.winner, summary: answer.summary, model: JUDGE_MODEL, attestation: `sha256:${sha256(proof)}` },
    proof,
  );
}
