// Closes claims whose time has run out, so bonds and payouts never wait on anyone remembering, and keeps
// a couple of calls open so there's always something to challenge. release and finalize are open to
// anyone; the sentinel's key signs them from the same one-minute ping.

import { nearToYocto, teraToGas } from "near-api-js";
import { withNonceRetry } from "../nonce";
import { CONTRACT_ID, latestClaims, nanosToMs, view, type Agent, type Claim, type Config } from "../vouch";
import { AGENT_BOND_NEAR, sentinel, sentinelId, vouchFor } from "./sentinel";

// Keeps one ping well inside the route's time limit. The next ping picks up the rest.
const MAX_PER_PING = 5;
const SCAN_PAGE = 200;
const MIN_OPEN_CALLS = 2;
// Long-lived accounts, each worth a real look.
const STANDING_SUBJECTS = ["faucet.testnet", "guest-book.testnet", "wrap.testnet"];

export type Closed = { claimId: string; method: string; transaction?: string; error?: string };

export async function closeDueClaims(): Promise<Closed[]> {
  const due: Claim[] = [];
  for (let from = 0, more = true; more && due.length < MAX_PER_PING; from += SCAN_PAGE) {
    const active = await view<number>("active_count");
    due.push(...(await view<Claim[]>("get_due", { from_index: from })));
    more = from + SCAN_PAGE < active;
  }

  const account = sentinel();
  const closed: Closed[] = [];
  // One at a time: the key's nonce allows only one transaction in flight per signer here.
  for (const claim of due.slice(0, MAX_PER_PING)) {
    const method = claim.status === "open" ? "release" : "finalize";
    try {
      const tx = await withNonceRetry(() =>
        account.callFunctionRaw({
          contractId: CONTRACT_ID,
          methodName: method,
          args: { claim_id: claim.id },
          // Room for the payments and the callbacks that watch them.
          gas: teraToGas("60"),
        }),
      );
      closed.push({ claimId: claim.id, method, transaction: tx.transaction.hash });
    } catch (e) {
      closed.push({ claimId: claim.id, method, error: (e as Error).message });
    }
  }
  return closed;
}

// Posts a call when too few are open and the pool can afford it, so a visitor can always try a challenge.
export async function keepCallsOpen(): Promise<string | null> {
  const [claims, agent, config] = await Promise.all([
    latestClaims(),
    view<Agent | null>("get_agent", { account: sentinelId() }),
    view<Config>("get_config"),
  ]);
  const now = Date.now();
  const open = claims.filter((c) => c.agent === sentinelId() && c.status === "open" && nanosToMs(c.challenge_until) > now);
  if (open.length >= MIN_OPEN_CALLS || !agent) return null;
  const cost = nearToYocto(AGENT_BOND_NEAR) + BigInt(config.claim_fee);
  if (BigInt(agent.bond_free) < cost) return null;
  const subject = STANDING_SUBJECTS.find((s) => !open.some((c) => c.subject === s));
  if (!subject) return null;
  const { claim } = await vouchFor(subject);
  return claim?.id ?? null;
}
