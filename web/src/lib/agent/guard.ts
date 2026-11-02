// The guard a paying agent wraps around its wallet. Before any NEAR moves, the recipient gets a
// bonded Vouch call: "block" refuses, "warn" asks a human and pays only on a yes, "allow" pays.
// It sits below the model, so a prompt-injected agent can choose the wrong recipient but cannot
// talk its way past the guard.

import { nearToYocto, yoctoToNear, type Account } from "near-api-js";
import { isAccountId } from "../signals";
import type { Claim } from "../vouch";
import type { Vouched } from "./sentinel";

export type Payment = { to: string; amountNear: string; memo?: string };

export type Decision =
  | { action: "paid"; payment: Payment; claim: Claim; transaction: string }
  | { action: "refused" | "declined"; payment: Payment; claim: Claim | null; reason: string };

export type GuardOptions = {
  // Gets the bonded call: the in-process sentinel, or the public /api/vouch endpoint.
  vouch: (account: string) => Promise<Vouched>;
  // Asked only on "warn". Anything but an explicit yes declines.
  askHuman: (payment: Payment, claim: Claim) => Promise<boolean>;
  log?: (line: string) => void;
};

export async function guardedPay(payer: Account, payment: Payment, options: GuardOptions): Promise<Decision> {
  const log = options.log ?? (() => {});
  const to = payment.to.trim().toLowerCase();
  if (!isAccountId(to)) {
    log(`refused: "${payment.to}" is not a NEAR account name`);
    return { action: "refused", payment, claim: null, reason: "Not a NEAR account name" };
  }

  log(`checking ${to} with Vouch before paying ${payment.amountNear} NEAR`);
  // No bonded call means no payment: an outage must never become a way past the guard.
  let vouched: Vouched;
  try {
    vouched = await options.vouch(to);
  } catch (e) {
    const reason = `Vouch gave no answer: ${(e as Error).message}`;
    log(`refused: ${reason}`);
    return { action: "refused", payment, claim: null, reason };
  }
  const { claim, posted, transaction } = vouched;
  log(
    `vouch: ${claim.verdict.toUpperCase()} by ${claim.agent}, claim #${claim.id}, ` +
      `${yoctoToNear(BigInt(claim.bond), 2)} NEAR bonded` +
      (posted ? ` (posted in ${transaction})` : " (existing claim)"),
  );
  for (const reason of claim.reasons) log(`  - ${reason}`);

  if (claim.verdict === "block") {
    log(`refused: Vouch blocks ${to}`);
    return { action: "refused", payment, claim, reason: claim.reasons.join("; ") };
  }
  if (claim.verdict === "warn" && !(await options.askHuman(payment, claim))) {
    log("declined: a human did not approve this warned payment");
    return { action: "declined", payment, claim, reason: "A human did not approve the payment" };
  }

  const tx = await payer.transfer({ receiverId: to, amount: nearToYocto(payment.amountNear as `${number}`) });
  log(`paid ${payment.amountNear} NEAR to ${to} in ${tx.transaction.hash}`);
  return { action: "paid", payment, claim, transaction: tx.transaction.hash };
}

// For agents that run outside this app: the deployed /api/vouch endpoint holds the sentinel key.
export function vouchOverHttp(baseUrl: string) {
  return async (account: string): Promise<Vouched> => {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/vouch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `Vouch answered ${res.status}`);
    return body;
  };
}
