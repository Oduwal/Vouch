// The judge: rules on every challenge the contract is waiting on. If any check fails it does not rule,
// and the next ping tries again until the late window ends. After that, both sides are refunded.

import { TEE_MODEL } from "../llm";
import { checkAccount } from "../signals";
import { view, type Claim } from "../vouch";
import { attestModel, sha256 } from "./attestation";
import { askJudge, caseRef, verifyAnswer } from "./ruling";
import { submitRuling, type Outcome } from "./submit";

// The contract's limit on a proof.
const MAX_PROOF_BYTES = 32 * 1024;

export const JUDGE_MODEL = TEE_MODEL;

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
  let proof = buildProof(signer);
  // A long answer could leave no room for the raw evidence. The signed answer matters most, so the
  // evidence goes first, leaving its hash and the checks' results.
  if (Buffer.byteLength(proof, "utf8") > MAX_PROOF_BYTES) {
    proof = buildProof({ ...signer, intelQuote: undefined, gpuToken: undefined });
  }

  return submitRuling(
    claim.id,
    { winner: answer.winner, summary: answer.summary, model: JUDGE_MODEL, attestation: `sha256:${sha256(proof)}` },
    proof,
  );
}
