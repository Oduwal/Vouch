"use client";

import { useId, useState, type FormEvent } from "react";
import { formatNear, minStake, parseNear, type Claim, type Config } from "../../lib/vouch";
import { useWallet } from "../../lib/wallet";

const MAX_EVIDENCE_BYTES = 1000;
// Covers the challenge itself and the 20 Tgas the contract reserves for the ruling.
const CHALLENGE_TGAS = 100;

export function ChallengeForm({ claim, config, onFiled }: { claim: Claim; config: Config; onFiled: () => void }) {
  const { accountId, connect, call } = useWallet();
  const required = minStake(claim.bond, config);
  const [evidence, setEvidence] = useState("");
  const [stake, setStake] = useState(() => formatNear(required));
  const [state, setState] = useState<"idle" | "signing">("idle");
  const [error, setError] = useState("");
  const id = useId();

  const evidenceBytes = new TextEncoder().encode(evidence).length;
  const isAgent = accountId === claim.agent;
  const stakeYocto = parseNear(stake);
  const payout = stakeYocto === null ? null : stakeYocto + BigInt(claim.bond);

  function problem() {
    if (!evidence.trim()) return "Write down what the call got wrong, with something the judge can check.";
    if (evidenceBytes > MAX_EVIDENCE_BYTES) return `Evidence is ${evidenceBytes - MAX_EVIDENCE_BYTES} characters over the limit.`;
    if (stakeYocto === null) return "Enter the stake as a NEAR amount, like 0.25.";
    if (stakeYocto < required) return `The stake must be at least ${formatNear(required)} NEAR.`;
    return "";
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const issue = problem();
    if (issue) {
      setError(issue);
      return;
    }
    setState("signing");
    try {
      if (!accountId) await connect();
      await call("challenge", { claim_id: claim.id, evidence: evidence.trim() }, stakeYocto as bigint, CHALLENGE_TGAS);
      // The judge rules as soon as it hears; the one-minute ping is the backstop.
      void fetch("/api/judge", { method: "POST" }).catch(() => {});
      onFiled();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "The wallet did not send the transaction. Nothing was staked.");
    } finally {
      setState("idle");
    }
  }

  return (
    <form id="challenge" onSubmit={submit} className="scroll-mt-6 bg-surface p-5" noValidate>
      <h2 className="text-[1rem] font-semibold">Challenge this call</h2>
      <p className="mt-1 max-w-[65ch] text-[0.875rem]">
        {payout !== null && stakeYocto !== null && stakeYocto >= required
          ? `If the judge rules for you, you receive ${formatNear(payout)} NEAR: your stake and the agent's bond. If it rules for the agent, the agent keeps your ${formatNear(stakeYocto)} NEAR. If no ruling comes, you get your stake back.`
          : "If the judge rules for you, you receive your stake and the agent's bond. If it rules for the agent, the agent keeps your stake. If no ruling comes, you get your stake back."}
      </p>

      <label htmlFor={`${id}-evidence`} className="mt-5 block text-[0.875rem] font-medium">
        Your evidence
      </label>
      <textarea
        id={`${id}-evidence`}
        value={evidence}
        onChange={(e) => setEvidence(e.target.value)}
        rows={5}
        aria-describedby={`${id}-count`}
        placeholder={`What did the agent get wrong about ${claim.subject}?`}
        className="mt-2 block w-full resize-y bg-bg px-3 py-2.5 text-[0.9375rem] text-ink outline outline-1 -outline-offset-1 outline-muted placeholder:text-muted focus:outline-2 focus:-outline-offset-2 focus:outline-ink"
      />
      <p id={`${id}-count`} className={`mt-1 text-right text-[0.75rem] tabular-nums ${evidenceBytes > MAX_EVIDENCE_BYTES ? "font-semibold" : "text-muted"}`}>
        {evidenceBytes} of {MAX_EVIDENCE_BYTES}
      </p>

      <div className="mt-2 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor={`${id}-stake`} className="block text-[0.875rem] font-medium">
            Your stake
          </label>
          <div className="mt-2 flex items-center bg-bg outline outline-1 -outline-offset-1 outline-muted focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-ink">
            <input
              id={`${id}-stake`}
              value={stake}
              onChange={(e) => setStake(e.target.value)}
              inputMode="decimal"
              autoComplete="off"
              aria-describedby={`${id}-minimum`}
              className="w-24 bg-transparent px-3 py-2 text-[0.9375rem] tabular-nums text-ink focus:outline-none"
            />
            <span className="pr-3 text-[0.8125rem] text-muted">NEAR</span>
          </div>
        </div>
        <button
          type="submit"
          disabled={state === "signing" || isAgent}
          className="min-h-[2.625rem] bg-ink px-5 font-semibold text-accent-ink transition-colors duration-150 hover:bg-lit active:bg-muted disabled:cursor-not-allowed disabled:bg-muted"
        >
          {state === "signing" ? "Waiting for your wallet…" : accountId ? "Stake and challenge" : "Connect wallet and challenge"}
        </button>
      </div>
      <p id={`${id}-minimum`} className="mt-2 text-[0.8125rem] text-muted">
        At least {formatNear(required)} NEAR. Your wallet needs to be on NEAR testnet; test NEAR is free at{" "}
        <a href="https://near-faucet.io/" className="underline">near-faucet.io</a>.
      </p>
      <p role="alert" className="mt-2 min-h-[1.25rem] text-[0.875rem] font-medium">
        {isAgent ? "This is your own call, so you can't challenge it." : error}
      </p>
    </form>
  );
}
