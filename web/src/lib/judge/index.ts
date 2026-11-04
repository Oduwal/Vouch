// The judge: rules on every challenge the contract is waiting on. If any check fails it does not rule,
// and the next ping tries again until the late window ends. After that, a jury takes the case.

import { TEE_MODEL } from "../llm";
import { checkAccount } from "../signals";
import { view, type Claim } from "../vouch";
import { attestModel, sha256 } from "./attestation";
import { askJudge, caseRef, verifyAnswer } from "./ruling";
import { submitRuling, type Outcome } from "./submit";

// The contract's limit on a proof.
const MAX_PROOF_BYTES = 32 * 1024;

export const JUDGE_MODEL = TEE_MODEL;

// Rules on the oldest challenges first, since their time runs out first. No new case starts after
// `startBefore`, so a crowd can't use up the ping before the jurors and closing get a turn.
export async function judgeWaiting(startBefore = Infinity): Promise<Outcome[]> {
  const waiting = await view<Claim[]>("get_waiting");
  waiting.sort((a, b) => Number(BigInt(a.challenge?.filed_at ?? "0") - BigInt(b.challenge?.filed_at ?? "0")));
  const outcomes: Outcome[] = [];
  for (const claim of waiting) {
    if (Date.now() >= startBefore) break;
    try {
      outcomes.push(await judgeClaim(claim));
    } catch (e) {
      outcomes.push({ claimId: claim.id, ruled: false, error: (e as Error).message });
    }
  }
  return outcomes;
}

async function judgeClaim(claim: Claim): Promise<Outcome> {
  // If the account can't be read at all, this waits for the next ping. A fact an indexer won't give shows as
  // null. Reports stay out: the call being ruled on may be one, and they're someone's say-so, not chain facts.
  const [attestation, facts] = await Promise.all([attestModel(JUDGE_MODEL), checkAccount(claim.subject, { reports: false })]);
  if (!attestation.trusted.length) {
    const why = attestation.rejected.map((r) => r.reason).join("; ") || "no nodes reported";
    throw new Error(`No model node passed attestation: ${why}`);
  }

  const answer = await askJudge(JUDGE_MODEL, claim, facts);
  const signature = await verifyAnswer(answer, attestation);
  const signer = attestation.trusted.find((n) => n.signingAddress.toLowerCase() === signature.signingAddress.toLowerCase());
  if (!signer) throw new Error("The signer is not a trusted node");

  // Everything needed to re-check this ruling. It travels in the transaction's arguments.
  const buildProof = (node: Partial<typeof signer>) =>
    JSON.stringify({
      version: 2,
      claim_id: claim.id,
      case: caseRef(claim.id),
      model: JUDGE_MODEL,
      nonce: attestation.nonce,
      signer_node: node,
      signature,
      request: answer.requestBody,
      response: answer.responseBody,
    });
  const proof = buildProof(signer);
  // Never rule without the evidence. The next ping asks again, and after that a jury takes the case.
  if (Buffer.byteLength(proof, "utf8") > MAX_PROOF_BYTES) throw new Error("This answer is too long to prove on-chain");

  return submitRuling(
    claim.id,
    { winner: answer.winner, summary: answer.summary, model: JUDGE_MODEL, attestation: `sha256:${sha256(proof)}` },
    proof,
  );
}
