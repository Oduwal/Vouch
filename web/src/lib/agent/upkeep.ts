// Closes claims whose windows have passed, so bonds and payouts never wait on anyone remembering.
// release and finalize are open to anyone; the sentinel's key signs them from the same one-minute ping.

import { teraToGas } from "near-api-js";
import { CONTRACT_ID, view, type Claim } from "../vouch";
import { sentinel } from "./sentinel";

const PAGE = 100;
// Keeps one ping well inside the route's time limit. The next ping picks up the rest.
const MAX_PER_PING = 5;

function dueMethod(claim: Claim, now: bigint) {
  if (claim.status === "open" && BigInt(claim.challenge_until) <= now) return "release";
  if (claim.status === "ruled" && claim.ruling && BigInt(claim.ruling.appeal_until) <= now) return "finalize";
  if (claim.status === "appealed" && claim.appeal && BigInt(claim.appeal.jury_until) <= now) return "finalize";
  return null;
}

export type Closed = { claimId: string; method: string; transaction?: string; error?: string };

export async function closeDueClaims(): Promise<Closed[]> {
  const now = BigInt(Date.now()) * BigInt(1_000_000);
  const due: { claimId: string; method: string }[] = [];
  for (let from = 0; due.length < MAX_PER_PING; from += PAGE) {
    const page = await view<Claim[]>("get_claims", { from_index: String(from), limit: PAGE });
    for (const claim of page) {
      const method = dueMethod(claim, now);
      if (method && due.length < MAX_PER_PING) due.push({ claimId: claim.id, method });
    }
    if (page.length < PAGE) break;
  }

  const account = sentinel();
  const closed: Closed[] = [];
  // One at a time: the key's nonce allows only one transaction in flight per signer here.
  for (const { claimId, method } of due) {
    try {
      const tx = await account.callFunctionRaw({
        contractId: CONTRACT_ID,
        methodName: method,
        args: { claim_id: claimId },
        gas: teraToGas("30"),
      });
      closed.push({ claimId, method, transaction: tx.transaction.hash });
    } catch (e) {
      closed.push({ claimId, method, error: (e as Error).message });
    }
  }
  return closed;
}
