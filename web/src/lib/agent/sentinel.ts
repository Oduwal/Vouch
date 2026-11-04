// The sentinel agent: checks an account and posts a bonded call on it. It signs with a function-call
// key that can only call post_claim, release and finalize on the Vouch contract, so a leaked key
// cannot move its NEAR.

import { Account, JsonRpcProvider, nearToYocto, teraToGas, type KeyPairString } from "near-api-js";
import { withNonceRetry } from "../nonce";
import { chainOnly, checkAccount, networkOf, type Check, type Level } from "../signals";
import { CONTRACT_ID, TESTNET_RPC, isLive, view, type Claim } from "../vouch";
import { assess } from "./assess";

export const AGENT_BOND_NEAR = (process.env.AGENT_BOND_NEAR ?? "0.5") as `${number}`;

const STRICTNESS: Record<Level, number> = { allow: 0, warn: 1, block: 2 };
const READ_BACK_TRIES = 6;
const READ_BACK_WAIT_MS = 1000;

export type Vouched = {
  // The bonded call, or null when none is live and this caller can't lock a new bond.
  claim: Claim | null;
  // What the chain says right now.
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

// Reuses this agent's live claim on the subject instead of locking a second bond, unless the chain has
// since turned against it: an account can deploy bad code minutes after an allow. Only a trusted caller
// can lock a new bond, so anyone else can't drain the pool by asking about many accounts.
export async function vouchFor(subject: string, { mayPost = true } = {}): Promise<Vouched> {
  const [existing, check] = await Promise.all([
    view<Claim | null>("get_agent_verdict", { agent: sentinelId(), subject }),
    checkAccount(subject, { ignoreReportsBy: sentinelId() }),
  ]);
  // It bonds only what it could defend to a judge, who doesn't read reports. And while another agent's report
  // has its bond at risk, it stays out: that fight is between the reporter and whoever challenges them.
  const facts = chainOnly(check);
  const reported = check.facts.reports.some((r) => r.live);
  const standing = existing && isLive(existing) && STRICTNESS[facts.verdict] <= STRICTNESS[existing.verdict];
  if (standing) return { claim: existing, check, posted: false, transaction: null, decidedBy: null };
  if (!mayPost || reported || networkOf(subject) !== "testnet") return { claim: null, check, posted: false, transaction: null, decidedBy: null };

  const { verdict, reasons, decidedBy } = await assess(facts);
  const account = sentinel();
  const tx = await withNonceRetry(() =>
    account.callFunctionRaw({
      contractId: CONTRACT_ID,
      methodName: "post_claim",
      args: { subject, verdict, reasons, bond: nearToYocto(AGENT_BOND_NEAR).toString() },
      gas: teraToGas("30"),
    }),
  );
  const status = tx.status as { SuccessValue?: string; Failure?: unknown };
  if (status.SuccessValue === undefined) throw new Error(`post_claim failed: ${JSON.stringify(status.Failure)}`);
  const claimId: string = JSON.parse(Buffer.from(status.SuccessValue, "base64").toString("utf8"));

  // Just posted, so it isn't final yet, and the node that answers can still be a block behind.
  let claim: Claim | null = null;
  for (let attempt = 0; attempt < READ_BACK_TRIES && !claim; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, READ_BACK_WAIT_MS));
    claim = await view<Claim | null>("get_claim", { claim_id: claimId }, "optimistic");
  }
  if (!claim) throw new Error(`Claim ${claimId} was posted but cannot be read back`);
  return { claim, check, posted: true, transaction: tx.transaction.hash, decidedBy };
}
