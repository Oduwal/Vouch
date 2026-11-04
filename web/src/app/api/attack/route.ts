import { Account, JsonRpcProvider, nearToYocto, type KeyPairString } from "near-api-js";
import { createAttacker, runAttack } from "../../../lib/agent/attack";
import type { AttackEvent } from "../../../lib/agent/attack-data";
import { AGENT_BOND_NEAR, sentinelId, vouchFor } from "../../../lib/agent/sentinel";
import { TESTNET_RPC, view, type Agent, type Config } from "../../../lib/vouch";

// Up to three model calls, three bonded calls and the payments.
export const maxDuration = 180;

const SLOT_MS = 30 * 60_000;
const refuse = (error: string, status: number) => Response.json({ error }, { status });

// Runs the attack live and streams its events, one JSON object per line. Each run spends testnet NEAR
// and locks a bond, so there's one run per 30-minute slot. The slot names the attacker's account, and an
// account can only be created once, so the chain enforces it even against requests arriving together.
export async function POST() {
  const payerId = process.env.PAYER_ACCOUNT_ID;
  const payerKey = process.env.PAYER_PRIVATE_KEY as KeyPairString | undefined;
  if (!payerId || !payerKey) return refuse("Live runs are turned off here. The recorded run below is real.", 503);

  let agent, config;
  try {
    [agent, config] = await Promise.all([view<Agent | null>("get_agent", { account: sentinelId() }), view<Config>("get_config")]);
  } catch {
    return refuse("Couldn't read NEAR testnet. Nothing was run.", 502);
  }
  // Room for the attacker's call. Calls on the other invoices are reused while they are live.
  if (!agent || BigInt(agent.bond_free) < nearToYocto(AGENT_BOND_NEAR) + BigInt(config.claim_fee)) {
    return refuse("The sentinel's bond pool is locked up until its open calls close. Try again later.", 503);
  }

  const now = Date.now();
  const slot = Math.floor(now / SLOT_MS);
  const attacker = `acme-billing-${slot.toString(36)}.testnet`;
  const payer = new Account(payerId, new JsonRpcProvider({ url: TESTNET_RPC }), payerKey);
  try {
    await createAttacker(payer, attacker);
  } catch {
    const minutes = Math.ceil(((slot + 1) * SLOT_MS - now) / 60_000);
    return refuse(`A live run happened recently. The next one can start in ${minutes} minutes.`, 429);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: AttackEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        // Nobody is at the keyboard on a live run, so a warned payment is declined.
        await runAttack(payer, attacker, { vouch: vouchFor, askHuman: async () => false, emit });
      } catch (e) {
        emit({ type: "error", message: (e as Error).message });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
