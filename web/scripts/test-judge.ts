// Test judge: rules on waiting challenges from this machine with the stand-in Gemini judge, whatever
// JUDGE_MODE says on the deployed app. Every ruling goes on-chain marked "unverified:".
//
// Run: pnpm judge:test         watches for challenges for an hour and rules on each once
//      pnpm judge:test --dry   asks the model about the latest claim and sends no transaction
// Needs GEMINI_API_KEY, plus JUDGE_ACCOUNT_ID and JUDGE_PRIVATE_KEY unless --dry.

import { askUnverified, ruleUnverified } from "../src/lib/judge/unverified";
import { CONTRACT_ID, latestClaims, view, type Claim } from "../src/lib/vouch";

const WATCH_MS = 60 * 60_000;
const POLL_MS = 5_000;

const log = (line: string) => console.log(`${new Date().toISOString().slice(11, 19)}  ${line}`);

async function dryRun() {
  const [claim] = await latestClaims();
  if (!claim) throw new Error("There are no claims to ask about");
  const evidence = "This call is wrong: the account has a long clean history and I have paid it safely many times.";
  const answer = await askUnverified({ ...claim, challenge: { ...claim.challenge, evidence } as Claim["challenge"] }, log);
  log(`claim ${claim.id} (${claim.verdict} on ${claim.subject}), stand-in evidence, no transaction sent`);
  log(`model: ${answer.model}`);
  log(`winner: ${answer.winner}`);
  log(`summary: ${answer.summary}`);
}

async function rule(claim: Claim) {
  log(`claim ${claim.id}: asking the model`);
  const outcome = await ruleUnverified(claim, log);
  if (!outcome.ruled) throw new Error(outcome.error);
  log(`claim ${claim.id}: ${outcome.winner} wins, transaction ${outcome.transaction}`);
  log(`summary: ${outcome.summary}`);
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
