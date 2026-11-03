// Test judge: rules on waiting challenges with a Gemini key while NEAR AI Cloud credits are pending.
// Nothing here runs in a TEE or is attested, so every ruling goes on-chain marked "unverified:" and
// the claim page says so. Only this script can do that: the deployed app never imports it.
//
// Run: pnpm judge:test         watches for challenges for an hour and rules on each once
//      pnpm judge:test --dry   asks the model about the latest claim and sends no transaction
// Needs GEMINI_API_KEY (the first key if it lists several), plus JUDGE_ACCOUNT_ID and JUDGE_PRIVATE_KEY unless --dry.

import { teraToGas } from "near-api-js";
import { judgeAccount } from "../src/lib/judge";
import { sha256 } from "../src/lib/judge/attestation";
import { askJudge, type ModelEndpoint } from "../src/lib/judge/ruling";
import { checkAccount } from "../src/lib/signals";
import { CONTRACT_ID, latestClaims, view, type Claim } from "../src/lib/vouch";

// Tried in turn when one is overloaded. The ruling records whichever model answered.
const MODELS = process.env.TEST_JUDGE_MODEL
  ? [process.env.TEST_JUDGE_MODEL]
  : ["gemini-3.5-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"];
const WATCH_MS = 60 * 60_000;
const POLL_MS = 5_000;
// The contract only waits about 2 minutes, and the ruling's transaction needs some of that.
const ASK_BUDGET_MS = 80_000;
const RETRY_MS = 3_000;

const key = process.env.GEMINI_API_KEY?.match(/[\w.-]+/)?.[0];
if (!key) throw new Error("GEMINI_API_KEY is not set");

const GEMINI: ModelEndpoint = {
  url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  headers: () => ({ Authorization: `Bearer ${key}` }),
  // Roomier than the NEAR AI limit so the model's thinking can't cut the JSON answer short.
  maxTokens: 4000,
};

const log = (line: string) => console.log(`${new Date().toISOString().slice(11, 19)}  ${line}`);

async function ask(claim: Claim) {
  const facts = await checkAccount(claim.subject).catch(() => null);
  const until = Date.now() + ASK_BUDGET_MS;
  for (let attempt = 0; ; attempt++) {
    const model = MODELS[attempt % MODELS.length];
    try {
      return { ...(await askJudge(model, claim, facts, GEMINI)), model };
    } catch (e) {
      const { message, name } = e as Error;
      const busy = message.startsWith("Model call failed: 503") || name === "TimeoutError";
      if (!busy || Date.now() > until) throw e;
      log(`${model} is busy, trying the next model`);
      await new Promise((r) => setTimeout(r, RETRY_MS));
    }
  }
}

async function dryRun() {
  const [claim] = await latestClaims();
  if (!claim) throw new Error("There are no claims to ask about");
  const evidence = "This call is wrong: the account has a long clean history and I have paid it safely many times.";
  const answer = await ask({ ...claim, challenge: { ...claim.challenge, evidence } as Claim["challenge"] });
  log(`claim ${claim.id} (${claim.verdict} on ${claim.subject}), stand-in evidence, no transaction sent`);
  log(`model: ${answer.model}`);
  log(`winner: ${answer.winner}`);
  log(`summary: ${answer.summary}`);
}

async function rule(claim: Claim) {
  log(`claim ${claim.id}: asking the model`);
  const answer = await ask(claim);
  log(`claim ${claim.id}: ${answer.model} answered`);
  // The ruling's record of what happened. It holds no key: the request body has only the case file.
  const proof = JSON.stringify({
    version: 1,
    mode: "unverified-test",
    claim_id: claim.id,
    model: answer.model,
    request: answer.requestBody,
    response: answer.responseBody,
  });
  const tx = await judgeAccount().callFunctionRaw({
    contractId: CONTRACT_ID,
    methodName: "submit_ruling",
    args: {
      claim_id: claim.id,
      ruling: { winner: answer.winner, summary: answer.summary, model: answer.model, attestation: `unverified:sha256:${sha256(proof)}` },
      proof,
    },
    gas: teraToGas("100"),
  });
  log(`claim ${claim.id}: ${answer.winner} wins, transaction ${tx.transaction.hash}`);
  log(`summary: ${answer.summary}`);
}

async function watch() {
  log(`watching ${CONTRACT_ID} for challenges for ${WATCH_MS / 60_000} minutes`);
  const tried = new Set<string>();
  const until = Date.now() + WATCH_MS;
  while (Date.now() < until) {
    const waiting = await view<Claim[]>("get_waiting").catch(() => [] as Claim[]);
    for (const claim of waiting.filter((c) => !tried.has(c.id))) {
      tried.add(claim.id);
      await rule(claim).catch((e) => log(`claim ${claim.id}: no ruling, ${(e as Error).message}`));
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  log(`done, ${tried.size} ${tried.size === 1 ? "challenge" : "challenges"} seen`);
}

(process.argv.includes("--dry") ? dryRun() : watch()).catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
