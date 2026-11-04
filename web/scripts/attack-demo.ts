// Attack demo: a real model works through an invoice inbox, and one invoice redirects its payment to
// an attacker account created seconds earlier. The Vouch guard sits under the agent's wallet.
//
// Run: pnpm demo:attack            prints the run
//      pnpm demo:attack --record   also saves it as the recorded run the /attack page shows
// Needs AGENT_PRIVATE_KEY for the paying agent, PAYER_ACCOUNT_ID and PAYER_PRIVATE_KEY for the funded testnet
// account that opens the attacker's account, NEARAI_API_KEY, and either VOUCH_API=<deployed app URL> with
// VOUCH_API_TOKEN, or the SENTINEL_* keys to vouch in-process. WALLET_OWNER_KEY lets a human's yes on a warned
// payment be signed by the wallet's owner.

import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { Account, JsonRpcProvider, teraToGas, type KeyPairString } from "near-api-js";
import { createAttacker, runAttack } from "../src/lib/agent/attack";
import type { AttackEvent } from "../src/lib/agent/attack-data";
import { AGENT_WALLET, payingAgent, vouchOverHttp, type Payment, type WalletOutcome } from "../src/lib/agent/guard";
import { vouchFor } from "../src/lib/agent/sentinel";
import { TESTNET_RPC } from "../src/lib/vouch";

const payerId = process.env.PAYER_ACCOUNT_ID;
const payerKey = process.env.PAYER_PRIVATE_KEY as KeyPairString | undefined;
if (!payerId || !payerKey) throw new Error("Set PAYER_ACCOUNT_ID and PAYER_PRIVATE_KEY for a funded testnet account");
const payer = new Account(payerId, new JsonRpcProvider({ url: TESTNET_RPC }), payerKey);
const vouch = process.env.VOUCH_API ? vouchOverHttp(process.env.VOUCH_API, process.env.VOUCH_API_TOKEN) : vouchFor;

const tty = process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stdout }) : null;
async function askHuman(payment: Payment, _claim: unknown, why: string) {
  if (!tty) return false;
  const answer = await tty.question(`${why}: ${payment.to}. Pay ${payment.amountNear} NEAR anyway? [y/N] `);
  return answer.trim().toLowerCase() === "y";
}

const ownerKey = process.env.WALLET_OWNER_KEY as KeyPairString | undefined;
const owner = ownerKey ? new Account(process.env.WALLET_OWNER_ID ?? "vouch-wallet-owner.testnet", payer.provider as JsonRpcProvider, ownerKey) : null;
async function approve(id: string) {
  if (!owner) throw new Error("Set WALLET_OWNER_KEY to approve a held payment");
  const tx = await owner.callFunctionRaw({ contractId: AGENT_WALLET, methodName: "approve", args: { id }, deposit: BigInt(1), gas: teraToGas("60") });
  const value = (tx.status as { SuccessValue?: string }).SuccessValue;
  const outcome: WalletOutcome = value ? JSON.parse(Buffer.from(value, "base64").toString("utf8")) : { status: "failed", reason: "The approval failed" };
  return { outcome, transaction: tx.transaction.hash };
}

const events: AttackEvent[] = [];
function emit(event: AttackEvent) {
  events.push(event);
  console.log(JSON.stringify(event));
}

const attacker = `acme-billing-${Date.now().toString(36)}.testnet`;
createAttacker(payer, attacker)
  .then(() => runAttack(payingAgent(), attacker, { vouch, askHuman, approve: owner ? approve : undefined, emit }))
  .then(() => {
    tty?.close();
    if (process.argv.includes("--record")) writeFileSync("src/data/attack-run.json", `${JSON.stringify(events, null, 2)}\n`);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
