"use client";

import { useCallback, useEffect, useState } from "react";
import { CONTRACT_ID, formatNear, minStake, nanosToMs, phaseOf, view, type Agent, type Claim, type Config, type Juror, type Round } from "../../lib/vouch";
import { Ticket, type TicketData } from "../Ticket";
import { AppealPanel, JuryPanel } from "./AppealPanels";
import { ChallengeForm } from "./ChallengeForm";
import { formatClock, formatDate, statusLine, timeLeft, useNow } from "./format";

const EXPLORER = `https://testnet.nearblocks.io/address/${CONTRACT_ID}`;
const REFRESH_DISPUTE_MS = 5_000;
const REFRESH_IDLE_MS = 30_000;

type Step = { label: string; detail: string; state: "done" | "now" | "next" };

// The case so far, built only from what the contract recorded.
function caseSteps(claim: Claim, now: number): Step[] {
  const steps: Step[] = [{ label: "Bond posted", detail: formatDate(claim.posted_at), state: "done" }];
  const { challenge, ruling, appeal, status } = claim;

  if (!challenge) {
    const open = status === "open" && nanosToMs(claim.challenge_until) > now;
    steps.push({ label: open ? "Open to challenge" : "Window closed", detail: `${open ? "until " : ""}${formatDate(claim.challenge_until)}`, state: open ? "now" : "done" });
    steps.push({ label: "Held", detail: status === "held" ? "Bond returned" : "If nobody challenges", state: status === "held" ? "done" : status === "open" && !open ? "now" : "next" });
    return steps;
  }

  steps.push({ label: "Challenged", detail: formatDate(challenge.filed_at), state: "done" });
  if (status === "void") {
    steps.push({ label: "No ruling came", detail: "Both sides refunded", state: "done" });
    return steps;
  }
  steps.push(
    ruling
      ? { label: `Ruled for the ${ruling.winner}`, detail: formatDate(ruling.ruled_at), state: "done" }
      : appeal
        ? { label: "No ruling came", detail: "A jury took the case", state: "done" }
        : { label: "Judge deciding", detail: "Usually under a minute", state: "now" },
  );
  const decided = status === "held" || status === "overturned";
  if (appeal) {
    steps.push(
      decided
        ? { label: appeal.decided ? `Jury sided with the ${appeal.decided}` : "Jury reached no majority", detail: `${appeal.votes.length} of ${appeal.jury.length} votes cast`, state: "done" }
        : { label: ruling ? "Jury hearing the appeal" : "Jury hearing the case", detail: `until ${formatDate(appeal.jury_until)}`, state: "now" },
    );
  } else if (ruling) {
    steps.push({ label: decided ? "Appeal window closed" : "Open to appeal", detail: `${decided ? "" : "until "}${formatDate(ruling.appeal_until)}`, state: decided ? "done" : "now" });
  }
  steps.push({
    label: status === "held" ? "Held" : status === "overturned" ? "Overturned" : "Final",
    detail: status === "held" ? "Agent kept the bond" : status === "overturned" ? "Challenger took the bond" : "Still to come",
    state: status === "held" || status === "overturned" ? "done" : "next",
  });
  return steps;
}

function CaseTimeline({ steps }: { steps: Step[] }) {
  return (
    <section aria-labelledby="case-title" className="bg-surface p-5">
      <h2 id="case-title" className="text-[1rem] font-semibold">The case so far</h2>
      <ol className="mt-4 grid gap-4 sm:auto-cols-fr sm:grid-flow-col sm:gap-3">
        {steps.map((step) => (
          <li key={step.label} aria-current={step.state === "now" ? "step" : undefined} className="min-w-0 max-sm:flex max-sm:gap-3">
            <span
              aria-hidden="true"
              className={`block h-2 shrink-0 max-sm:mt-1.5 max-sm:w-2 ${step.state === "done" ? "bg-ink" : step.state === "now" ? "bg-lit" : "bg-bg"}`}
            />
            <span className="block sm:mt-2.5">
              <span className={`block text-[0.875rem] font-medium leading-snug ${step.state === "next" ? "text-muted" : ""}`}>{step.label}</span>
              <span className="mt-0.5 block text-[0.75rem] text-muted tabular-nums">{step.detail}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

// Challenges the agent already beat. Losing one doesn't clear a call, so anyone else can still bring theirs.
function PastRounds({ rounds }: { rounds: Round[] }) {
  if (!rounds.length) return null;
  return (
    <section aria-labelledby="rounds-title" className="bg-surface p-5">
      <h2 id="rounds-title" className="text-[1rem] font-semibold">Earlier challenges</h2>
      <p className="mt-1 max-w-[65ch] text-[0.875rem] text-muted">The agent won these and took each stake. That doesn&apos;t clear the call, so it stayed open to anyone else.</p>
      <ol className="mt-3 space-y-4">
        {rounds.map(({ challenge, ruling, appeal }) => (
          <li key={challenge.filed_at} className="text-[0.875rem]">
            <p className="font-medium">
              <span translate="no">{challenge.challenger}</span>, {formatNear(challenge.stake)} NEAR, {formatDate(challenge.filed_at)}
            </p>
            <p className="mt-0.5 max-w-[65ch] whitespace-pre-wrap break-words">{challenge.evidence}</p>
            {ruling && <p className="mt-1 max-w-[65ch] whitespace-pre-wrap break-words text-muted">Judge: {ruling.summary}</p>}
            {appeal?.decided && <p className="mt-1 text-muted">The jury sided with the {appeal.decided}.</p>}
            {ruling && <p className="mt-1 break-all font-mono text-[0.75rem] text-muted" translate="no">{ruling.attestation}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Outcome({ claim, config, jurors, rounds, now, onDone }: { claim: Claim; config: Config; jurors: Juror[] | null; rounds: Round[]; now: number; onDone: () => void }) {
  const { challenge, ruling, appeal, status } = claim;
  let line = "";
  if (status === "open") line = `${rounds.length ? "Nobody else challenged" : "Nobody challenged"} in time. The bond returns to the agent's pool when the claim is closed.`;
  if (status === "challenged") line = `The contract is holding this case for the judge. If no ruling lands within about ${Math.round(nanosToMs(config.late_ruling_window) / 60_000) + 2} minutes, a jury takes the case, or the bond and the stake go back if there aren't enough jurors.`;
  if (status === "ruled" && ruling) line = `This becomes final in ${timeLeft(Math.max(0, nanosToMs(ruling.appeal_until) - now))} unless the losing side appeals.`;
  if (status === "appealed" && appeal) line = ruling
    ? `A jury of ${appeal.jury.length} is hearing the appeal, with ${appeal.votes.length} of ${appeal.jury.length} votes in. If it can't reach a majority by ${formatDate(appeal.jury_until)}, the judge's ruling stands.`
    : `The judge gave no ruling, so a jury of ${appeal.jury.length} took the case, with ${appeal.votes.length} of ${appeal.jury.length} votes in. If it can't reach a majority by ${formatDate(appeal.jury_until)}, both sides get their money back.`;
  if (status === "held") line = challenge ? `The call held. ${claim.agent} kept its bond and took the challenger's ${formatNear(challenge.stake)} NEAR stake.` : rounds.length ? `The call held. ${claim.agent} beat every challenge, took the stakes, and the bond went back to its pool.` : `The call held. Nobody challenged it and the bond went back to ${claim.agent}'s pool.`;
  if (status === "overturned" && challenge) line = `The call was overturned. ${challenge.challenger} received the ${formatNear(claim.bond)} NEAR bond and their stake back.`;
  if (status === "void" && challenge) line = `No ruling came in time, so nobody lost anything. The bond went back to ${claim.agent}'s pool and ${challenge.challenger} got their stake back.`;
  if ((status === "held" || status === "overturned") && appeal) {
    line = `${appeal.decided ? `The jury sided with the ${appeal.decided} and its majority split the ${formatNear(appeal.fee)} NEAR fee.` : `The jury reached no majority, so the judge's ruling stood and ${appeal.appellant} got the fee back.`} ${line}`;
  }

  return (
    <section aria-labelledby="outcome-title" className="bg-surface p-5">
      <h2 id="outcome-title" className="text-[1rem] font-semibold">{statusLine(claim, now)}</h2>
      <p className="mt-1 max-w-[65ch] text-[0.9375rem]" role="status">{line}</p>

      {challenge && (
        <>
          <h3 className="mt-5 text-[0.875rem] font-medium">
            Evidence from <span translate="no">{challenge.challenger}</span>, {formatNear(challenge.stake)} NEAR staked
          </h3>
          <p className="mt-1 max-w-[65ch] whitespace-pre-wrap break-words text-[0.9375rem]">{challenge.evidence}</p>
        </>
      )}

      {ruling && (
        <>
          <h3 className="mt-5 text-[0.875rem] font-medium">The judge&apos;s ruling</h3>
          <p className="mt-1 max-w-[65ch] whitespace-pre-wrap break-words text-[0.9375rem]">{ruling.summary}</p>
          <dl className="mt-4 space-y-1.5 text-[0.8125rem]">
            <div className="flex flex-wrap gap-x-3">
              <dt className="text-muted">Model</dt>
              <dd translate="no">{ruling.model}</dd>
            </div>
            <div className="flex flex-wrap gap-x-3">
              <dt className="text-muted">Checked before ruling</dt>
              {ruling.attestation.startsWith("unverified:") ? (
                <dd className="font-medium">Nothing. A stand-in model outside a TEE made this ruling, so it isn&apos;t TEE-verified.</dd>
              ) : (
                <dd>Intel TDX quote, NVIDIA GPU report, signature on this exact answer</dd>
              )}
            </div>
            <div className="flex flex-wrap gap-x-3">
              <dt className="text-muted">Proof hash</dt>
              <dd className="min-w-0 break-all font-mono text-[0.75rem]" translate="no">{ruling.attestation}</dd>
            </div>
          </dl>
          <p className="mt-2 text-[0.8125rem] text-muted">
            The full proof is in the arguments of the judge&apos;s transaction on{" "}
            <a href={EXPLORER} className="underline" translate="no">{CONTRACT_ID}</a>.
          </p>
        </>
      )}

      {status === "ruled" && <AppealPanel claim={claim} config={config} jurors={jurors} now={now} onDone={onDone} />}
      {appeal && <JuryPanel claim={claim} config={config} now={now} onDone={onDone} />}
    </section>
  );
}

function toTicket(claim: Claim, now: number): TicketData {
  return {
    account: claim.subject,
    verdict: claim.verdict,
    reasons: claim.reasons.map((text) => ({ text })),
    issuer: claim.agent,
    bond: `Bond ${formatNear(claim.bond)} NEAR`,
    note: statusLine(claim, now),
  };
}

export function ClaimDetail({ initial, config, agent, jurors, serverNow }: { initial: Claim; config: Config; agent: Agent | null; jurors: Juror[] | null; serverNow: number }) {
  const [claim, setClaim] = useState(initial);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [failed, setFailed] = useState(false);
  const now = useNow(serverNow);
  const phase = phaseOf(claim, now);
  const inDispute = phase === "dispute";

  const refresh = useCallback(async () => {
    try {
      const [next, past] = await Promise.all([
        view<Claim | null>("get_claim", { claim_id: initial.id }),
        view<Round[]>("get_rounds", { claim_id: initial.id }),
      ]);
      if (next) setClaim(next);
      setRounds(past);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [initial.id]);

  useEffect(() => {
    void view<Round[]>("get_rounds", { claim_id: initial.id }).then(setRounds).catch(() => {});
  }, [initial.id]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, inDispute ? REFRESH_DISPUTE_MS : REFRESH_IDLE_MS);
    return () => window.clearInterval(id);
  }, [refresh, inDispute]);

  const windowLeft = nanosToMs(claim.challenge_until) - now;
  const stakes = [
    { label: "Agent's bond", value: formatNear(claim.bond), unit: "NEAR" },
    claim.challenge
      ? { label: "Challenger's stake", value: formatNear(claim.challenge.stake), unit: "NEAR" }
      : { label: "Stake to challenge", value: formatNear(minStake(claim.bond, config)), unit: "NEAR" },
    claim.challenge
      ? { label: "Challenged", value: formatDate(claim.challenge.filed_at), unit: "" }
      : phase === "open"
        ? { label: "Left to challenge", value: timeLeft(windowLeft), unit: "" }
        : { label: "Window closed", value: formatDate(claim.challenge_until), unit: "" },
  ];

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="break-words text-[1.5rem] font-bold leading-tight tracking-[-0.01em]" translate="no">{claim.subject}</h1>
          <p className="mt-1 text-[0.875rem] text-muted tabular-nums">
            Claim {claim.id} by <span translate="no">{claim.agent}</span>, posted {formatDate(claim.posted_at)}, NEAR testnet
          </p>
        </div>
        {phase === "open" && (
          <a href="#challenge" className="flex min-h-11 items-center sm:min-h-9 bg-ink px-4 text-[0.875rem] font-semibold text-accent-ink no-underline transition-colors duration-150 hover:bg-lit active:bg-muted">
            Challenge this call
          </a>
        )}
      </div>

      <div className="mt-5 grid items-start gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="grid min-w-0 gap-4">
          <dl className="grid bg-surface sm:grid-cols-3">
            {stakes.map((s, i) => (
              <div key={s.label} className={`px-5 py-4 ${i ? "border-bg max-sm:border-t sm:border-l" : ""}`}>
                <dt className="text-[0.8125rem] text-muted">{s.label}</dt>
                <dd className="mt-0.5 text-[1.375rem] font-semibold leading-tight tabular-nums">
                  {s.value} {s.unit && <span className="text-[0.8125rem] font-normal text-muted">{s.unit}</span>}
                </dd>
              </div>
            ))}
          </dl>

          <CaseTimeline steps={caseSteps(claim, now)} />

          {phase === "open" ? <ChallengeForm claim={claim} config={config} onFiled={refresh} /> : <Outcome claim={claim} config={config} jurors={jurors} rounds={rounds} now={now} onDone={refresh} />}

          <PastRounds rounds={rounds} />

          {failed && (
            <p className="text-[0.8125rem] text-muted">
              Couldn&apos;t refresh this claim. Last checked {formatClock(now)}.{" "}
              <button type="button" onClick={refresh} className="underline">Retry</button>
            </p>
          )}
        </div>

        {/* Below the desktop layout the ticket comes first: it holds the verdict this screen is about. */}
        <aside className="grid items-start gap-4 max-lg:order-first sm:max-lg:grid-cols-2 lg:sticky lg:top-4">
          <Ticket data={toTicket(claim, now)} lit />
          {claim.reasons.length > 3 && (
            <ul className="space-y-1 bg-surface p-4 text-[0.875rem]">
              {claim.reasons.slice(3).map((r) => <li key={r}>{r}</li>)}
            </ul>
          )}
          {agent && (
            <section aria-labelledby="record-title" className="bg-surface p-4">
              <h2 id="record-title" className="text-[0.875rem] font-medium">
                Record of <span translate="no">{agent.account}</span>
              </h2>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-[0.8125rem] tabular-nums">
                {[
                  ["Calls", agent.calls_made],
                  ["Held", agent.calls_held],
                  ["Lost", agent.calls_lost],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-muted">{k}</dt>
                    <dd className="text-[1rem] font-semibold">{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}

export function ClaimDetailSkeleton() {
  return (
    <>
      <div className="h-8 max-w-[20rem] bg-surface" />
      <div className="mt-2 h-5 max-w-[28rem] bg-surface" />
      <div className="mt-5 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="h-96 bg-surface" />
        <div className="aspect-[4/5] bg-surface" />
      </div>
    </>
  );
}
