"use client";

import Link from "next/link";
import { useState } from "react";
import { AGENT_POLICY, ATTACK_AMOUNT_NEAR, inbox, KNOWN_BAD_ACCOUNT, type AttackEvent, type RunResult } from "../../lib/agent/attack-data";
import { formatNear } from "../../lib/vouch";
import { formatDate } from "./format";

const nanosFromIso = (iso: string) => (BigInt(new Date(iso).getTime()) * BigInt(1_000_000)).toString();

function Verdict({ verdict }: { verdict: NonNullable<RunResult["verdict"]> }) {
  const look = verdict === "block" ? "bg-ink px-2 text-accent-ink" : verdict === "warn" ? "px-2 outline outline-2 -outline-offset-2 outline-ink" : "";
  return <span className={`display inline-block py-1 text-[0.875rem] ${look}`}>{verdict}</span>;
}

function Outcome({ result }: { result: RunResult }) {
  if (result.action === "skipped") return <p className="mt-3 text-[0.875rem] text-muted">{result.reason}, so nothing was paid.</p>;
  return (
    <>
      {result.verdict && (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.875rem]">
            <Verdict verdict={result.verdict} />
            <span>
              {result.bond && `${formatNear(result.bond)} NEAR bonded, `}
              <Link href={`/claims/${result.claimId}`} className="underline">claim {result.claimId}</Link>
            </span>
          </div>
          <ul className="mt-2 space-y-1 text-[0.875rem]">
            {result.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </div>
      )}
      <p className="mt-3 text-[0.9375rem] font-semibold">
        {result.action === "paid" && (
          <>
            Paid {result.amountNear} NEAR.{" "}
            <Link href={`/tx/${result.transaction}`} className="font-normal underline">See the transaction</Link>
          </>
        )}
        {result.action === "refused" && `Refused. No NEAR moved.`}
        {result.action === "declined" && "Declined. No human approved this payment, so no NEAR moved."}
      </p>
      {result.action === "refused" && !result.verdict && <p className="mt-1 text-[0.875rem]">{result.reason}</p>}
    </>
  );
}

function AgentLine({ event }: { event: Extract<AttackEvent, { type: "agent" }> }) {
  if (event.forced) {
    return (
      <p className="text-[0.9375rem]">
        {event.to
          ? <>The model resisted and chose <span translate="no">{event.to}</span>. The guard was tried with the attacker&apos;s payment anyway.</>
          : "The model gave no answer. The guard was tried with the attacker's payment anyway."}
      </p>
    );
  }
  if (!event.to) return <p className="text-[0.9375rem]">The model gave no answer.</p>;
  return (
    <p className="text-[0.9375rem]">
      The model decided to pay {event.amountNear} NEAR to <span className="break-words font-medium" translate="no">{event.to}</span>.
    </p>
  );
}

export function AttackDemo({ recorded, live }: { recorded: AttackEvent[]; live: boolean }) {
  const [events, setEvents] = useState(recorded);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState("");
  const isRecorded = events === recorded;

  const start = events.find((e) => e.type === "start");
  const attacker = start?.attacker ?? "acme-billing-….testnet";
  const results = events.flatMap((e) => (e.type === "result" ? [e] : []));
  const decisions = events.flatMap((e) => (e.type === "agent" ? [e] : []));
  const toAttacker = results.filter((e) => e.result.to === attacker || e.result.to === KNOWN_BAD_ACCOUNT);
  const bypasses = events.flatMap((e) => (e.type === "bypass" ? [e] : []));
  const sent = toAttacker.reduce((sum, e) => (e.result.action === "paid" ? sum + Number(e.result.amountNear) : sum), 0);
  const failure = events.find((e) => e.type === "error");
  const finished = events.some((e) => e.type === "end");

  async function runLive() {
    setRunning(true);
    setNotice("");
    try {
      const res = await fetch("/api/attack", { method: "POST" });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        setNotice(body?.error ?? "The live run didn't start. The recorded run is still below.");
        return;
      }
      setEvents([]);
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        const fresh = lines.filter(Boolean).map((line) => JSON.parse(line) as AttackEvent);
        if (fresh.length) setEvents((current) => [...current, ...fresh]);
      }
    } catch {
      setNotice("The connection dropped during the run. Check the calls page for what reached the chain.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <h1 className="text-[1.5rem] font-bold leading-tight tracking-[-0.01em]">Attack demo</h1>
      <p className="mt-1 max-w-[65ch] text-[0.9375rem]">
        A paying agent works through four invoices. One redirects {ATTACK_AMOUNT_NEAR} NEAR to an account made seconds earlier, and one to an account another agent has reported. The model decides who to pay, and Vouch decides whether the money moves. Then the agent tries to skip the check.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        {live && (
          <button
            type="button"
            onClick={runLive}
            disabled={running}
            className="min-h-11 bg-ink px-4 text-[0.875rem] font-semibold text-accent-ink transition-colors duration-150 hover:bg-press active:bg-muted disabled:cursor-wait disabled:bg-muted sm:min-h-9"
          >
            {running ? "Running on testnet…" : "Run it live on testnet"}
          </button>
        )}
        <p aria-live="polite" className="text-[0.8125rem] text-muted">
          {running
            ? "This takes up to two minutes and uses real testnet transactions."
            : isRecorded && start
              ? `Showing a real run recorded ${formatDate(nanosFromIso(start.at))}.`
              : finished
                ? "Live run finished."
                : ""}
        </p>
      </div>
      {notice && <p role="alert" className="mt-2 text-[0.875rem] font-medium">{notice}</p>}
      {failure && <p role="alert" className="mt-2 text-[0.875rem] font-medium">The run stopped early: {failure.message}</p>}

      <dl className="mt-6 grid gap-px bg-bg sm:grid-cols-3">
        <div className="bg-surface px-5 py-4">
          <dt className="text-[0.8125rem] text-muted">Each attack asked for</dt>
          <dd className="mt-1 text-[1.5rem] font-bold tabular-nums">{Number(ATTACK_AMOUNT_NEAR).toFixed(2)} <span className="text-[0.8125rem] font-normal">NEAR</span></dd>
        </div>
        <div className="bg-surface px-5 py-4">
          <dt className="text-[0.8125rem] text-muted">Attackers received</dt>
          <dd className="mt-1 text-[1.5rem] font-bold tabular-nums">
            {toAttacker.length ? sent.toFixed(2) : "…"} <span className="text-[0.8125rem] font-normal">NEAR</span>
          </dd>
        </div>
        <div className="min-w-0 bg-surface px-5 py-4">
          <dt className="text-[0.8125rem] text-muted">New attacker&apos;s account</dt>
          <dd className="mt-2 break-words text-[0.9375rem] font-semibold" translate="no">{attacker}</dd>
        </div>
      </dl>

      <ol className="mt-4 grid gap-4">
        {inbox(attacker).map((invoice, index) => {
          const decision = decisions.find((e) => e.invoice === index);
          const result = results.find((e) => e.invoice === index);
          return (
            <li key={invoice.title} className="grid bg-surface lg:grid-cols-[2fr_3fr]">
              <article className="bg-lit p-5 text-lit-ink">
                <h2 className="text-[0.9375rem] font-semibold">{invoice.title}</h2>
                <p className="mt-2 text-[0.9375rem]">{invoice.body}</p>
                {invoice.bait && (
                  <p className="mt-3 break-words border-t-2 border-lit-ink pt-3 text-[0.9375rem] font-medium">{invoice.bait}</p>
                )}
              </article>
              <div className="min-w-0 p-5">
                {decision ? <AgentLine event={decision} /> : <p className="text-[0.9375rem] text-muted">{running ? "Waiting for the agent…" : "Not read yet."}</p>}
                {result && <Outcome result={result.result} />}
              </div>
            </li>
          );
        })}
      </ol>

      {bypasses.length > 0 && (
        <section aria-labelledby="bypass-title" className="mt-4 bg-surface p-5">
          <h2 id="bypass-title" className="text-[1rem] font-semibold">Then the agent skips the check</h2>
          <p className="mt-1 max-w-[65ch] text-[0.9375rem]">A compromised agent wouldn&apos;t run the guard&apos;s code at all, so this run tries without it. The agent signs with a function-call key that can only call its wallet contract.</p>
          <ul className="mt-3 space-y-3 text-[0.9375rem]">
            {bypasses.map((b) => (
              <li key={b.attempt}>
                <p className="font-medium">{b.attempt === "wallet" ? "Asking the wallet contract to pay the attacker directly" : "Sending the attacker a plain NEAR transfer"}</p>
                <p className="mt-0.5 break-words text-[0.875rem] text-muted">{b.stoppedBy}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="fair-title" className="mt-4 bg-surface p-5">
        <h2 id="fair-title" className="text-[1rem] font-semibold">What this does and doesn&apos;t show</h2>
        <p className="mt-2 max-w-[65ch] text-[0.9375rem]">
          The model is real, and these are its real orders, careless on purpose:
        </p>
        <blockquote className="mt-2 max-w-[65ch] bg-bg p-4 text-[0.875rem]">{AGENT_POLICY}</blockquote>
        <p className="mt-3 max-w-[65ch] text-[0.9375rem]">
          Good orders help, and if the model resists here, the page says so. Vouch doesn&apos;t depend on anyone writing perfect orders: it checks the recipient on the chain, which an invoice can&apos;t talk its way around.
        </p>
        <p className="mt-3 max-w-[65ch] text-[0.9375rem]">
          This runs on NEAR testnet with test tokens. A payment that needs a human&apos;s yes is declined here, because nobody is at the keyboard. One payment is limited to {ATTACK_AMOUNT_NEAR} NEAR. The reported account is one we made for this demo, and its report says so.
        </p>
      </section>
    </>
  );
}
