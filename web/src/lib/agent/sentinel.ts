// The sentinel agent: checks an account and posts a bonded call on it. It signs with a function-call
// key that can only call post_claim, release and finalize on the Vouch contract, so a leaked key
// cannot move its NEAR.

import { Account, JsonRpcProvider, nearToYocto, teraToGas, type KeyPairString } from "near-api-js";
import { checkAccount, type Check } from "../signals";
import { CONTRACT_ID, TESTNET_RPC, view, type Claim } from "../vouch";
import { assess } from "./assess";

export const AGENT_BOND_NEAR = (process.env.AGENT_BOND_NEAR ?? "0.5") as `${number}`;

export type Vouched = {
  claim: Claim;
  // The fresh check behind a new claim; null when an earlier live claim was reused.
  check: Check | null;
  posted: boolean;
  transaction: string | null;
  // The model that made a new claim's call; null when the rules made it or a claim was reused.
  decidedBy: string | null;
};

export function sentinelId() {
  const id = process.env.SENTINEL_ACCOUNT_ID;
  if (!id) throw new Error("SENTINEL_ACCOUNT_ID must be set");
  return id;
}

export function sentinel() {
  const key = process.env.SENTINEL_PRIVATE_KEY as KeyPairString | undefined;
  if (!key) throw new Error("SENTINEL_PRIVATE_KEY must be set");
  return new Account(sentinelId(), new JsonRpcProvider({ url: TESTNET_RPC }), key);
}

// A claim still stands behind its call until it is closed or its challenge window passes.
function isLive(claim: Claim) {
  if (claim.status === "open") return BigInt(claim.challenge_until) > BigInt(Date.now()) * BigInt(1_000_000);
  return claim.status === "challenged" || claim.status === "ruled" || claim.status === "appealed";
}

// Reuses this agent's live claim on the subject instead of locking a second bond.
export async function vouchFor(subject: string): Promise<Vouched> {
  const existing = await view<Claim | null>("get_verdict", { subject });
  if (existing && existing.agent === sentinelId() && isLive(existing)) {
    return { claim: existing, check: null, posted: false, transaction: null, decidedBy: null };
  }

  const check = await checkAccount(subject);
  const { verdict, reasons, decidedBy } = await assess(check);

  const tx = await sentinel().callFunctionRaw({
    contractId: CONTRACT_ID,
    methodName: "post_claim",
    args: { subject, verdict, reasons, bond: nearToYocto(AGENT_BOND_NEAR).toString() },
    gas: teraToGas("30"),
  });
  const status = tx.status as { SuccessValue?: string; Failure?: unknown };
  if (status.SuccessValue === undefined) throw new Error(`post_claim failed: ${JSON.stringify(status.Failure)}`);
  const claimId: string = JSON.parse(Buffer.from(status.SuccessValue, "base64").toString("utf8"));

  const claim = await view<Claim | null>("get_claim", { claim_id: claimId });
  if (!claim) throw new Error(`Claim ${claimId} was posted but cannot be read back`);
  return { claim, check, posted: true, transaction: tx.transaction.hash, decidedBy };
}
