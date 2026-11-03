// The stand-in judge: rules through Gemini while NEAR AI Cloud credits are pending. Nothing here runs
// in a TEE or is attested, so every ruling goes on-chain marked "unverified:" and the claim page says
// so. It runs only when JUDGE_MODE asks for it, never as an automatic fallback, so an outage at the
// attested judge cannot quietly downgrade a ruling.

import { GEMINI, withGeminiModels } from "../gemini";
import { checkAccount } from "../signals";
import type { Claim } from "../vouch";
import { sha256 } from "./attestation";
import { askJudge } from "./ruling";
import { submitRuling, type Outcome } from "./submit";

// The contract only waits about 2 minutes, and the ruling's transaction needs some of that.
const ASK_BUDGET_MS = 75_000;

export const unverifiedMode = () => process.env.JUDGE_MODE === "unverified-gemini";

export async function askUnverified(claim: Claim, log?: (line: string) => void) {
  const facts = await checkAccount(claim.subject).catch(() => null);
  return withGeminiModels((model) => askJudge(model, claim, facts, GEMINI), { budgetMs: ASK_BUDGET_MS, log });
}

export async function ruleUnverified(claim: Claim, log?: (line: string) => void): Promise<Outcome> {
  const answer = await askUnverified(claim, log);
  log?.(`claim ${claim.id}: ${answer.model} answered`);
  // The ruling's record of what happened. It holds no key: the request body has only the case file.
  const proof = JSON.stringify({
    version: 1,
    mode: "unverified",
    claim_id: claim.id,
    model: answer.model,
    request: answer.requestBody,
    response: answer.responseBody,
  });
  return submitRuling(
    claim.id,
    { winner: answer.winner, summary: answer.summary, model: answer.model, attestation: `unverified:sha256:${sha256(proof)}` },
    proof,
  );
}
