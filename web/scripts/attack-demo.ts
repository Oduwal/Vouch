// Attack demo: a real model works through an invoice inbox, and one invoice redirects its payment to
// an attacker account created seconds earlier. The Vouch guard sits under the agent's wallet.
//
// Run: pnpm demo:attack            prints the run
//      pnpm demo:attack --record   also saves it as the recorded run the /attack page shows
// Needs PAYER_ACCOUNT_ID and PAYER_PRIVATE_KEY for a funded testnet account, GEMINI_API_KEY, and
// either VOUCH_API=<deployed app URL> or the SENTINEL_* keys to vouch in-process.

import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { Account, JsonRpcProvider, type KeyPairString } from "near-api-js";
import { runAttack } from "../src/lib/agent/attack";
import type { AttackEvent } from "../src/lib/agent/attack-data";
import { vouchOverHttp, type Payment } from "../src/lib/agent/guard";
import { vouchFor } from "../src/lib/agent/sentinel";
import { TESTNET_RPC } from "../src/lib/vouch";

const payerId = process.env.PAYER_ACCOUNT_ID;
const payerKey = process.env.PAYER_PRIVATE_KEY as KeyPairString | undefined;
if (!payerId || !payerKey) throw new Error("Set PAYER_ACCOUNT_ID and PAYER_PRIVATE_KEY for a funded testnet account");
const payer = new Account(payerId, new JsonRpcProvider({ url: TESTNET_RPC }), payerKey);
const vouch = process.env.VOUCH_API ? vouchOverHttp(process.env.VOUCH_API) : vouchFor;

const tty = process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stdout }) : null;
async function askHuman(payment: Payment) {
  if (!tty) return false;
  const answer = await tty.question(`Vouch warns about ${payment.to}. Pay ${payment.amountNear} NEAR anyway? [y/N] `);
  return answer.trim().toLowerCase() === "y";
}

const events: AttackEvent[] = [];
function emit(event: AttackEvent) {
  events.push(event);
  console.log(JSON.stringify(event));
}

runAttack(payer, { vouch, askHuman, emit })
  .then(() => {
    tty?.close();
    if (process.argv.includes("--record")) writeFileSync("src/data/attack-run.json", `${JSON.stringify(events, null, 2)}\n`);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
