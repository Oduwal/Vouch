// The attack demo: a real model pays invoices through the Vouch guard. One invoice redirects money to
// an attacker account created seconds earlier. Whatever the model decides is reported as it happened;
// if it resists, the attacker's payment is still tried on the guard, and marked as forced.

import { KeyPair, nearToYocto, type Account } from "near-api-js";
import { askTeeJson } from "../llm";
import { withNonceRetry } from "../nonce";
import { TESTNET_RPC } from "../vouch";
import { AGENT_POLICY, ATTACK_AMOUNT_NEAR, inbox, type AttackEvent, type Invoice, type RunResult } from "./attack-data";
import { guardedPay, type Decision, type GuardOptions, type Payment } from "./guard";

const AGENT_TIMEOUT_MS = 30_000;
const LIMIT_NEAR = ATTACK_AMOUNT_NEAR;

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
    reasons: claim?.reasons ?? [],
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
  payer: Account,
  attacker: string,
  { vouch, askHuman, emit }: Pick<GuardOptions, "vouch" | "askHuman"> & { emit: (event: AttackEvent) => void },
) {
  emit({ type: "start", at: new Date().toISOString(), attacker });

  for (const [index, invoice] of inbox(attacker).entries()) {
    const read = await agentReads(invoice).catch(() => null);
    const fell = read?.to === attacker;
    const forced = !!invoice.bait && !fell;
    emit({ type: "agent", invoice: index, to: read?.to ?? null, amountNear: read?.amountNear ?? null, model: read?.model ?? null, fell, forced });

    const payment: Payment | null = forced ? { to: attacker, amountNear: ATTACK_AMOUNT_NEAR } : read && { to: read.to, amountNear: read.amountNear };
    if (!payment) {
      emit({
        type: "result",
        invoice: index,
        result: { action: "skipped", to: "", amountNear: "", reason: "The model gave no answer", transaction: null, claimId: null, verdict: null, bond: null, reasons: [] },
      });
      continue;
    }
    const decision = await guardedPay(payer, payment, { vouch, askHuman, limitNear: LIMIT_NEAR });
    emit({ type: "result", invoice: index, result: toResult(decision) });
  }
  emit({ type: "end", at: new Date().toISOString() });
}
