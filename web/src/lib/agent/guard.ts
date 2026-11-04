// The guard a paying agent wraps around its wallet. Before any NEAR moves, the recipient gets a bonded
// Vouch call: "block" refuses, "warn" asks a human and pays only on a yes, "allow" pays. It sits below the
// model, so a prompt-injected agent can choose the wrong recipient but cannot talk its way past the guard.
// A disputed call, a report nobody challenged, or a first payment also asks a human.
//
// The agent's key is a function-call key that can only call the wallet contract, and that key can't send
// NEAR by itself. This guard gives the better reasons and the human's yes. The wallet contract repeats the
// verdict, report and first-payment checks on-chain, so an agent that skips this code gets no further.

import { Account, JsonRpcProvider, nearToYocto, teraToGas, yoctoToNear, type KeyPairString } from "near-api-js";
import { withNonceRetry } from "../nonce";
import { isAccountId, networkOf } from "../signals";
import { TESTNET_RPC, isDisputed, isLive, parseNear, type Claim } from "../vouch";
import type { Vouched } from "./sentinel";

export const AGENT_WALLET = process.env.AGENT_WALLET_ID ?? "vouch-agent-wallet.testnet";
const AGENT_ID = process.env.AGENT_ACCOUNT_ID ?? "vouch-pay-agent.testnet";
const PAY_TGAS = "150";
const VERDICTS = new Set(["allow", "warn", "block"]);

// The paying agent. Its key can only call the wallet contract's `pay` and `call`.
export function payingAgent() {
  const key = process.env.AGENT_PRIVATE_KEY as KeyPairString | undefined;
  if (!key) throw new Error("AGENT_PRIVATE_KEY must be set");
  return new Account(AGENT_ID, new JsonRpcProvider({ url: TESTNET_RPC }), key);
}

export type WalletOutcome =
  | { status: "paid"; to: string; amount: string }
  | { status: "pending"; id: string; reason: string }
  | { status: "refused"; reason: string }
  | { status: "failed"; reason: string };

function outcomeOf(tx: { status: unknown }): WalletOutcome {
  const status = tx.status as { SuccessValue?: string; Failure?: unknown };
  if (status.SuccessValue === undefined) throw new Error(`The wallet refused the call: ${JSON.stringify(status.Failure)}`);
  return JSON.parse(Buffer.from(status.SuccessValue, "base64").toString("utf8"));
}

// Asks the wallet contract to pay, and returns what it decided along with the transaction.
export async function walletPay(agent: Account, to: string, amountNear: string) {
  const tx = await withNonceRetry(() =>
    agent.callFunctionRaw({
      contractId: AGENT_WALLET,
      methodName: "pay",
      args: { to, amount: nearToYocto(amountNear as `${number}`).toString() },
      gas: teraToGas(PAY_TGAS),
    }),
  );
  return { outcome: outcomeOf(tx), transaction: tx.transaction.hash };
}

// The prior-interaction signal: how many times this wallet has really paid an account, by its own on-chain
// record. Nobody can add to it by sending the wallet a transaction. Null when the chain doesn't answer.
export async function priorPayments(to: string): Promise<number | null> {
  try {
    const res = await fetch(TESTNET_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "vouch",
        method: "query",
        params: {
          request_type: "call_function",
          finality: "final",
          account_id: AGENT_WALLET,
          method_name: "payments_to",
          args_base64: Buffer.from(JSON.stringify({ account: to })).toString("base64"),
        },
      }),
      signal: AbortSignal.timeout(6000),
    });
    const bytes = (await res.json()).result?.result;
    return bytes ? Number(JSON.parse(Buffer.from(bytes).toString("utf8"))) : null;
  } catch {
    return null;
  }
}

export type Payment = { to: string; amountNear: string; memo?: string };

export type Decision =
  | { action: "paid"; payment: Payment; claim: Claim; transaction: string; prior: string | null }
  | { action: "refused" | "declined"; payment: Payment; claim: Claim | null; reason: string; prior: string | null };

export type GuardOptions = {
  // Gets the bonded call: the in-process sentinel, or the public /api/vouch endpoint.
  vouch: (account: string) => Promise<Vouched>;
  // Asked on a warning. Anything but an explicit yes declines.
  askHuman: (payment: Payment, claim: Claim, why: string) => Promise<boolean>;
  // Signs the owner's yes on-chain, after a human said yes. Only the owner's own key can do it.
  approve?: (id: string) => Promise<{ outcome: WalletOutcome; transaction: string }>;
  // The most one payment may send, whatever the model asks for.
  limitNear?: string;
  log?: (line: string) => void;
};

export async function guardedPay(agent: Account, payment: Payment, options: GuardOptions): Promise<Decision> {
  const log = options.log ?? (() => {});
  const refuse = (reason: string, claim: Claim | null = null, prior: string | null = null): Decision => {
    log(`refused: ${reason}`);
    return { action: "refused", payment, claim, reason, prior };
  };

  const to = payment.to.trim().toLowerCase();
  if (!isAccountId(to)) return refuse("Not a NEAR account name");
  // The wallet pays on testnet, so facts about the same name on mainnet would say nothing about who gets paid.
  if (networkOf(to) !== "testnet") return refuse("This wallet only pays testnet accounts");
  const amount = parseNear(payment.amountNear);
  if (!amount) return refuse("Not an amount to pay");
  if (options.limitNear !== undefined) {
    const limit = parseNear(options.limitNear);
    if (limit === null || amount > limit) return refuse(`Over the ${options.limitNear} NEAR limit on one payment`);
  }

  log(`checking ${to} with Vouch before paying ${payment.amountNear} NEAR`);
  // No bonded call means no payment: an outage must never become a way past the guard.
  let vouched: Vouched;
  try {
    vouched = await options.vouch(to);
  } catch (e) {
    return refuse(`Vouch gave no answer: ${(e as Error).message}`);
  }
  const { claim, posted, transaction: postedIn, check } = vouched;
  const live = check?.facts.reports.find((r) => r.live);
  if (live) return refuse(`${live.agent} reported this account, with a bond at risk, in claim ${live.claimId}`);
  if (!claim) return refuse("No bonded call on this account");
  // Checked here too, since the call can come from an endpoint over HTTP.
  if (claim.subject !== to || !isLive(claim) || !VERDICTS.has(claim.verdict)) return refuse("No live bonded call on this account");
  log(
    `vouch: ${claim.verdict.toUpperCase()} by ${claim.agent}, claim #${claim.id}, ` +
      `${yoctoToNear(BigInt(claim.bond), 2)} NEAR bonded` +
      (posted ? ` (posted in ${postedIn})` : " (existing claim)"),
  );
  for (const reason of claim.reasons) log(`  - ${reason}`);
  if (claim.verdict === "block") return refuse(claim.reasons.join("; "), claim);

  const paidBefore = await priorPayments(to);
  const prior = paidBefore === null ? "Couldn't read this wallet's record with the account" : paidBefore ? `This wallet has paid this account ${paidBefore} time${paidBefore === 1 ? "" : "s"} before` : "This wallet has never paid this account";
  log(prior);

  const closedReport = check?.facts.reports[0];
  const why =
    claim.verdict === "warn"
      ? "Vouch warns about this account"
      : isDisputed(claim)
        ? "Someone is disputing this call"
        : closedReport
          ? `${closedReport.agent} reported this account, and nobody challenged it`
          : !paidBefore
            ? "This would be the first payment to this account"
            : null;
  if (why && !(await options.askHuman(payment, claim, why))) {
    log("declined: a human did not approve this payment");
    return { action: "declined", payment, claim, reason: "A human did not approve the payment", prior };
  }

  let { outcome, transaction } = await walletPay(agent, to, payment.amountNear);
  // The wallet holds what its own read says needs the owner. Only a human's yes above can release it.
  if (outcome.status === "pending" && why && options.approve) {
    ({ outcome, transaction } = await options.approve(outcome.id));
  }
  if (outcome.status === "paid") {
    log(`paid ${payment.amountNear} NEAR to ${to} in ${transaction}`);
    return { action: "paid", payment, claim, transaction, prior };
  }
  if (outcome.status === "pending") {
    log(`waiting: the wallet is holding this payment for its owner, as payment ${outcome.id}`);
    return { action: "declined", payment, claim, reason: `The wallet is holding this payment for its owner: ${outcome.reason}`, prior };
  }
  return refuse(`The wallet contract refused: ${outcome.reason}`, claim, prior);
}

// For agents that run outside this app: the deployed /api/vouch endpoint holds the sentinel key.
export function vouchOverHttp(baseUrl: string, token?: string) {
  return async (account: string): Promise<Vouched> => {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/vouch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ account }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `Vouch answered ${res.status}`);
    return body;
  };
}
