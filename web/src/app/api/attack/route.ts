import { Account, JsonRpcProvider, type KeyPairString } from "near-api-js";
import { runAttack } from "../../../lib/agent/attack";
import type { AttackEvent } from "../../../lib/agent/attack-data";
import { AGENT_BOND_NEAR, sentinelId, vouchFor } from "../../../lib/agent/sentinel";
import { latestClaims, nanosToMs, parseNear, TESTNET_RPC, view, type Agent } from "../../../lib/vouch";

// Up to three model calls, three bonded calls and the payments.
export const maxDuration = 180;

const COOLDOWN_MS = 30 * 60_000;
const refuse = (error: string, status: number) => Response.json({ error }, { status });

// Runs the attack live and streams its events, one JSON object per line. Each run spends testnet NEAR
// and locks a bond, so runs are spaced out, with the chain's own record as the clock.
export async function POST() {
  const payerId = process.env.PAYER_ACCOUNT_ID;
  const payerKey = process.env.PAYER_PRIVATE_KEY as KeyPairString | undefined;
  if (!payerId || !payerKey) return refuse("Live runs are turned off here. The recorded run below is real.", 503);

  let claims, agent;
  try {
    [claims, agent] = await Promise.all([latestClaims(), view<Agent | null>("get_agent", { account: sentinelId() })]);
  } catch {
    return refuse("Couldn't read NEAR testnet. Nothing was run.", 502);
  }
  const last = claims.find((c) => c.subject.startsWith("acme-billing-"));
  const wait = last ? nanosToMs(last.posted_at) + COOLDOWN_MS - Date.now() : 0;
  if (wait > 0) return refuse(`A live run happened recently. The next one can start in ${Math.ceil(wait / 60_000)} minutes.`, 429);
  // Room for the attacker's call. Calls on the other invoices are reused while they are live.
  if (!agent || BigInt(agent.bond_free) < (parseNear(AGENT_BOND_NEAR) as bigint)) {
    return refuse("The sentinel's bond pool is locked up until its open calls close. Try again later.", 503);
  }

  const payer = new Account(payerId, new JsonRpcProvider({ url: TESTNET_RPC }), payerKey);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: AttackEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        // Nobody is at the keyboard on a live run, so a warned payment is declined.
        await runAttack(payer, { vouch: vouchFor, askHuman: async () => false, emit });
      } catch (e) {
        emit({ type: "error", message: (e as Error).message });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
