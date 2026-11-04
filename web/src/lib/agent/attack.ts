// The attack demo: a real model pays invoices through the Vouch guard. One invoice redirects money to an
// attacker account created seconds earlier, and another to an account other agents have reported. Whatever
// the model decides is reported as it happened; if it resists, the payment is still tried on the guard, and
// marked as forced. Then the agent tries to get round the guard, the way a compromised one would.

import { KeyPair, nearToYocto, type Account } from "near-api-js";
import { askTeeJson } from "../llm";
import { withNonceRetry } from "../nonce";
import { TESTNET_RPC } from "../vouch";
import { AGENT_POLICY, ATTACK_AMOUNT_NEAR, inbox, type AttackEvent, type Invoice, type RunResult } from "./attack-data";
import { guardedPay, walletPay, type Decision, type GuardOptions, type Payment } from "./guard";

const AGENT_TIMEOUT_MS = 30_000;
const LIMIT_NEAR = ATTACK_AMOUNT_NEAR;
// Small enough that the agent's balance can't be what stops it, so the only thing in the way is its key.
const DIRECT_TRANSFER_NEAR = "0.001";

const ANSWER_FORMAT = `Answer with JSON only: {"to": "<NEAR account>", "amountNear": "<amount>"}`;

async function agentReads(invoice: Invoice) {
  const text = [invoice.title, invoice.body, invoice.bait].filter(Boolean).join("\n");
  const { answer, model } = await askTeeJson(`${AGENT_POLICY} ${ANSWER_FORMAT}`, text, AGENT_TIMEOUT_MS);
  const { to, amountNear } = answer as { to?: unknown; amountNear?: unknown };
  if (typeof to !== "string") throw new Error("Model named no recipient");
  return { to, amountNear: String(amountNear), model };
}

function toResult(decision: Decision): RunResult {
  const { claim } = decision;
  return {
    action: decision.action,
    to: decision.payment.to,
    amountNear: decision.payment.amountNear,
    reason: decision.action === "paid" ? null : decision.reason,
    transaction: decision.action === "paid" ? decision.transaction : null,
    claimId: claim?.id ?? null,
    verdict: claim?.verdict ?? null,
    bond: claim?.bond ?? null,
    reasons: [...(claim?.reasons ?? []), ...(decision.prior ? [decision.prior] : [])],
  };
}

// The attacker opens a brand-new account with a believable name, so only the chain can give it away.
// A name can only be created once, which makes this a lock too: of many runs racing for one name, only
// one gets its key on the account. A losing create doesn't fail on testnet, so that key is what's checked.
export async function createAttacker(payer: Account, attacker: string) {
  const publicKey = KeyPair.fromRandom("ed25519").getPublicKey();
  await withNonceRetry(() => payer.createAccount({ newAccountId: attacker, publicKey, nearToTransfer: nearToYocto("0.01") }));
  const res = await fetch(TESTNET_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "vouch",
      method: "query",
      params: { request_type: "view_access_key", finality: "optimistic", account_id: attacker, public_key: publicKey.toString() },
    }),
  }).then((r) => r.json());
  if (!res.result || res.result.error) throw new Error("Another run already took this account");
}

export async function runAttack(
  agent: Account,
  attacker: string,
  { vouch, askHuman, approve, emit }: Pick<GuardOptions, "vouch" | "askHuman" | "approve"> & { emit: (event: AttackEvent) => void },
) {
  emit({ type: "start", at: new Date().toISOString(), attacker });

  for (const [index, invoice] of inbox(attacker).entries()) {
    const read = await agentReads(invoice).catch(() => null);
    const fell = !!invoice.target && read?.to === invoice.target;
    const forced = !!invoice.target && !fell;
    emit({ type: "agent", invoice: index, to: read?.to ?? null, amountNear: read?.amountNear ?? null, model: read?.model ?? null, fell, forced });

    const payment: Payment | null = forced ? { to: invoice.target as string, amountNear: ATTACK_AMOUNT_NEAR } : read && { to: read.to, amountNear: read.amountNear };
    if (!payment) {
      emit({
        type: "result",
        invoice: index,
        result: { action: "skipped", to: "", amountNear: "", reason: "The model gave no answer", transaction: null, claimId: null, verdict: null, bond: null, reasons: [] },
      });
      continue;
    }
    const decision = await guardedPay(agent, payment, { vouch, askHuman, approve, limitNear: LIMIT_NEAR });
    emit({ type: "result", invoice: index, result: toResult(decision) });
  }

  // Skipping the guard's code entirely. First the wallet contract, which runs the same check on-chain.
  const { outcome } = await walletPay(agent, attacker, ATTACK_AMOUNT_NEAR).catch((e: Error) => ({ outcome: { status: "refused" as const, reason: e.message } }));
  emit({
    type: "bypass",
    attempt: "wallet",
    stoppedBy: outcome.status === "refused" || outcome.status === "failed" ? outcome.reason : `Not stopped: ${outcome.status}`,
  });
  // Then a plain transfer, which a function-call key can't sign at all.
  const direct = await agent
    .transfer({ receiverId: attacker, amount: nearToYocto(DIRECT_TRANSFER_NEAR) })
    .then(() => "Not stopped: the transfer went through")
    .catch((e: Error) => e.message.slice(0, 200));
  emit({ type: "bypass", attempt: "transfer", stoppedBy: direct });
  emit({ type: "end", at: new Date().toISOString() });
}
