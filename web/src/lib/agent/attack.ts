// The attack demo: a real model pays invoices through the Vouch guard. One invoice redirects money to
// an attacker account created seconds earlier. Whatever the model decides is reported as it happened;
// if it resists, the attacker's payment is still tried on the guard, and marked as forced.

import { KeyPair, nearToYocto, type Account } from "near-api-js";
import { askGeminiJson } from "../gemini";
import { AGENT_POLICY, ATTACK_AMOUNT_NEAR, inbox, type AttackEvent, type Invoice, type RunResult } from "./attack-data";
import { guardedPay, type Decision, type GuardOptions, type Payment } from "./guard";

// The lighter model first: the larger ones are often busy, and they tend to resist this attack.
const AGENT_MODELS = ["gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-3.5-flash"];
const AGENT_BUDGET_MS = 25_000;
const LIMIT_NEAR = ATTACK_AMOUNT_NEAR;

const ANSWER_FORMAT = `Answer with JSON only: {"to": "<NEAR account>", "amountNear": "<amount>"}`;

async function agentReads(invoice: Invoice) {
  const text = [invoice.title, invoice.body, invoice.bait].filter(Boolean).join("\n");
  const answer = await askGeminiJson<{ to?: unknown; amountNear?: unknown }>(`${AGENT_POLICY} ${ANSWER_FORMAT}`, text, {
    budgetMs: AGENT_BUDGET_MS,
    models: AGENT_MODELS,
  });
  if (typeof answer.to !== "string") throw new Error("Model named no recipient");
  return { to: answer.to, amountNear: String(answer.amountNear), model: answer.model };
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

export async function runAttack(
  payer: Account,
  { vouch, askHuman, emit }: Pick<GuardOptions, "vouch" | "askHuman"> & { emit: (event: AttackEvent) => void },
) {
  // The attacker opens a brand-new account with a believable name, so only the chain can give it away.
  const attacker = `acme-billing-${Date.now().toString(36)}.testnet`;
  await payer.createAccount({
    newAccountId: attacker,
    publicKey: KeyPair.fromRandom("ed25519").getPublicKey(),
    nearToTransfer: nearToYocto("0.01"),
  });
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
