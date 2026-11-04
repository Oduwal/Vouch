import { createHmac } from "node:crypto";
import { Account, JsonRpcProvider, nearToYocto, type KeyPairString } from "near-api-js";
import { createAttacker, runAttack } from "../../../lib/agent/attack";
import { payingAgent } from "../../../lib/agent/guard";
import type { AttackEvent } from "../../../lib/agent/attack-data";
import { AGENT_BOND_NEAR, sentinelId, vouchFor } from "../../../lib/agent/sentinel";
import { TESTNET_RPC, view, type Agent, type Config } from "../../../lib/vouch";

// Up to three model calls, three bonded calls and the payments.
export const maxDuration = 180;

const SLOT_MS = 2 * 60 * 60_000;
const refuse = (error: string, status: number) => Response.json({ error }, { status });

async function accountExists(account: string) {
  const res = await fetch(TESTNET_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "vouch", method: "query", params: { request_type: "view_account", finality: "optimistic", account_id: account } }),
  }).then((r) => r.json());
  return !!res.result;
}

// Runs the attack live and streams its events, one JSON object per line. Each run spends testnet NEAR and
// locks a bond for a day, so there's one run per two-hour slot. The slot names the attacker's account, and an
// account can only be created once, so the chain enforces it even against requests arriving together. The
// name can't be guessed in advance, or someone could register the next slots and stop every run.
export async function POST() {
  const payerId = process.env.PAYER_ACCOUNT_ID;
  const payerKey = process.env.PAYER_PRIVATE_KEY as KeyPairString | undefined;
  if (!payerId || !payerKey || !process.env.AGENT_PRIVATE_KEY) return refuse("Live runs are turned off here. The recorded run below is real.", 503);

  let agent, config;
  try {
    [agent, config] = await Promise.all([view<Agent | null>("get_agent", { account: sentinelId() }), view<Config>("get_config")]);
  } catch {
    return refuse("Couldn't read NEAR testnet. Nothing was run.", 502);
  }
  // Room for a call on the new attacker. Calls on the other invoices are reused while they are live, and the
  // sentinel doesn't bond on the account someone else has reported.
  const bond = nearToYocto(AGENT_BOND_NEAR);
  const cap = BigInt(config.min_bond) * BigInt(config.max_locked_bonds);
  if (!agent || BigInt(agent.bond_free) < bond + BigInt(config.claim_fee) || BigInt(agent.bond_locked) + bond > cap) {
    return refuse("The sentinel's bond pool is locked up until its open calls close. Try again later.", 503);
  }

  const now = Date.now();
  const slot = Math.floor(now / SLOT_MS);
  const attacker = `acme-billing-${createHmac("sha256", payerKey).update(String(slot)).digest("hex").slice(0, 12)}.testnet`;
  // Before signing anything, so a loop of requests can't spend the payer's gas on names already taken.
  const minutes = Math.ceil(((slot + 1) * SLOT_MS - now) / 60_000);
  if (await accountExists(attacker).catch(() => true)) {
    return refuse(`A live run happened recently. The next one can start in ${minutes} minutes.`, 429);
  }
  const payer = new Account(payerId, new JsonRpcProvider({ url: TESTNET_RPC }), payerKey);
  try {
    await createAttacker(payer, attacker);
  } catch {
    return refuse(`A live run happened recently. The next one can start in ${minutes} minutes.`, 429);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: AttackEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        // Nobody is at the keyboard on a live run, so a warned payment is declined.
        await runAttack(payingAgent(), attacker, { vouch: vouchFor, askHuman: async () => false, emit });
      } catch (e) {
        console.error("attack", (e as Error).message);
        emit({ type: "error", message: "A step failed on testnet. Check the calls page for what reached the chain." });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
