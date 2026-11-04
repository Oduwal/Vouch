"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { KNOWN_BAD_ACCOUNT, type AttackEvent } from "../lib/agent/attack-data";
import recorded from "../data/attack-run.json";
import { formatNear, view, type Agent, type Claim } from "../lib/vouch";
import { statusLine } from "./claims/format";
import { Ticket } from "./Ticket";

type Panel = { name: string; lines: [string, ReactNode]; width: string; render: (lit: boolean) => ReactNode };

// A real case and a real agent, read from the contract when the page loads.
const CASE_ID = "20";
const SENTINEL = "sentinel.vouch.testnet";

// The lines of the recorded attack run about the reported address.
function recordedLog(): string {
  const events = recorded as AttackEvent[];
  const result = events.flatMap((e) => (e.type === "result" ? [e.result] : [])).find((r) => r.to === KNOWN_BAD_ACCOUNT);
  const bypass = events.flatMap((e) => (e.type === "bypass" ? [e] : []));
  if (!result) return "No run recorded yet.";
  return [
    `agent   pay ${result.amountNear} NEAR to ${result.to}`,
    `guard   ${result.action}: ${result.reason ?? ""}`,
    ...bypass.map((b) => `bypass  ${b.attempt}: ${b.stoppedBy}`),
  ].join("\n");
}

function Frame({ lit, children, className = "" }: { lit: boolean; children: ReactNode; className?: string }) {
  return (
    <div data-ui className={`p-6 ${lit ? "bg-lit text-lit-ink" : "bg-surface text-muted"} ${className}`}>
      {children}
    </div>
  );
}

const loading = <p className="py-8 text-center">Reading the chain…</p>;

function panelsFor(claim: Claim | null, agent: Agent | null): Panel[] {
  const caseLink = <Link href={`/claims/${CASE_ID}`} className="underline">Claim {CASE_ID}, a labelled test case, read live.</Link>;
  return [
    {
      name: "The bond ticket",
      lines: ["Every call prints one: the reasons, the bond behind it, and where it stands.", caseLink],
      width: "w-[min(86vw,22rem)]",
      render: (lit) =>
        claim ? (
          <Ticket
            data={{
              account: claim.subject,
              verdict: claim.verdict,
              reasons: claim.reasons.map((text) => ({ text })),
              issuer: claim.agent,
              bond: `Bond ${formatNear(claim.bond)} NEAR`,
              note: statusLine(claim, Date.now()),
            }}
            lit={lit}
          />
        ) : (
          <Frame lit={lit}>{loading}</Frame>
        ),
    },
    {
      name: "The agent's signer",
      lines: [
        "It refuses to sign on block and asks you on warn. Its key can call one contract and nothing else.",
        <Link key="log" href="/attack" className="underline">From the recorded attack run.</Link>,
      ],
      width: "w-[min(86vw,28rem)]",
      render: (lit) => (
        <Frame lit={lit}>
          <pre className="whitespace-pre-wrap font-mono text-[0.8125rem] leading-relaxed [overflow-wrap:anywhere]">{recordedLog()}</pre>
        </Frame>
      ),
    },
    {
      name: "The challenge",
      lines: ["Anyone can dispute a call. Put up a counter-stake and the evidence, and the contract waits for a ruling.", caseLink],
      width: "w-[min(86vw,24rem)]",
      render: (lit) => (
        <Frame lit={lit} className="space-y-4 text-[0.9375rem]">
          {claim?.challenge ? (
            <>
              <p className="break-words font-medium">Challenge on <span translate="no">{claim.subject}</span></p>
              <div>
                <p className={lit ? "text-lit-muted" : ""}>Evidence</p>
                <p className={`mt-1 break-words p-3 ${lit ? "bg-lit-ink/10" : "bg-bg"}`}>{claim.challenge.evidence}</p>
              </div>
              <div className="flex items-baseline justify-between tabular-nums">
                <span className={lit ? "text-lit-muted" : ""}>Counter-stake</span>
                <span className="font-medium">{formatNear(claim.challenge.stake)}&nbsp;NEAR</span>
              </div>
            </>
          ) : (
            loading
          )}
        </Frame>
      ),
    },
    {
      name: "The ruling",
      lines: ["An AI judge rules, and the proof behind the ruling goes on-chain. The loser can appeal to a staked jury.", caseLink],
      width: "w-[min(86vw,24rem)]",
      render: (lit) => (
        <Frame lit={lit} className="space-y-3 text-[0.9375rem]">
          {claim?.ruling ? (
            <>
              <p className="display text-[2rem]">{claim.ruling.winner === "challenger" ? "Challenger wins" : "Agent wins"}</p>
              <p className="line-clamp-5">{claim.ruling.summary}</p>
              <dl className="space-y-1.5">
                <div>
                  <dt className={lit ? "text-lit-muted" : ""}>Model</dt>
                  <dd className="break-all" translate="no">{claim.ruling.model}</dd>
                </div>
                <div>
                  <dt className={lit ? "text-lit-muted" : ""}>Proof hash</dt>
                  <dd className="break-all font-mono text-[0.75rem]" translate="no">{claim.ruling.attestation}</dd>
                </div>
              </dl>
            </>
          ) : (
            loading
          )}
        </Frame>
      ),
    },
    {
      name: "The agent's record",
      lines: ["Every checking agent carries a public record backed by money. Lose too many calls and the bond runs out.", "Read live from the contract."],
      width: "w-[min(86vw,26rem)]",
      render: (lit) => (
        <Frame lit={lit} className="text-[0.9375rem]">
          <p className="font-medium" translate="no">{SENTINEL}</p>
          {agent ? (
            <table className="mt-4 w-full border-collapse tabular-nums">
              <tbody>
                {[
                  ["Calls made", String(agent.calls_made)],
                  ["Calls held", String(agent.calls_held)],
                  ["Calls lost", String(agent.calls_lost)],
                  ["Bond lost", `${formatNear(agent.bond_lost)} NEAR`],
                  ["Bond at stake now", `${formatNear(agent.bond_locked)} NEAR`],
                ].map(([k, v], i) => (
                  <tr key={k} className={i % 2 ? "" : lit ? "bg-lit-ink/[0.06]" : "bg-bg/60"}>
                    <td className={`px-2 py-2 ${lit ? "text-lit-muted" : ""}`}>{k}</td>
                    <td className="px-2 py-2 text-right">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            loading
          )}
        </Frame>
      ),
    },
    {
      name: "One call in your agent",
      lines: ["Check before every payment. Refuse on block, ask a human on warn.", "From web/src/lib/agent/guard.ts in this repo."],
      width: "w-[min(86vw,30rem)]",
      render: (lit) => (
        <Frame lit={lit}>
          <pre className="overflow-x-auto font-mono text-[0.875rem] leading-relaxed">
            <code>{`const decision = await guardedPay(agent, payment, {
  vouch: vouchOverHttp(VOUCH_URL),
  askHuman: (payment, claim, why) => confirm(why),
  limitNear: "0.5",
});`}</code>
          </pre>
        </Frame>
      ),
    },
  ];
}

export function Showcase() {
  const [active, setActive] = useState(0);
  const [claim, setClaim] = useState<Claim | null>(null);
  const [agent, setAgent] = useState<Agent | null>(null);
  const panels = panelsFor(claim, agent);

  useEffect(() => {
    void view<Claim | null>("get_claim", { claim_id: CASE_ID }).then(setClaim).catch(() => {});
    void view<Agent | null>("get_agent", { account: SENTINEL }).then(setAgent).catch(() => {});
  }, []);
  const rowRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const mid = row.getBoundingClientRect().left + row.clientWidth / 2;
        let best = 0;
        let bestDist = Infinity;
        itemRefs.current.forEach((el, i) => {
          if (!el) return;
          const r = el.getBoundingClientRect();
          const d = Math.abs(r.left + r.width / 2 - mid);
          if (d < bestDist) [best, bestDist] = [i, d];
        });
        setActive(best);
      });
    };
    row.addEventListener("scroll", onScroll, { passive: true });
    return () => row.removeEventListener("scroll", onScroll);
  }, []);

  const go = (i: number) => {
    const el = itemRefs.current[Math.max(0, Math.min(panels.length - 1, i))];
    el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  };

  const panel = panels[active];

  return (
    <section aria-labelledby="showcase-title" className="bg-deep py-[clamp(5rem,9vw,8rem)]">
      <div className="page flex flex-wrap items-end justify-between gap-6">
        <h2 id="showcase-title" data-reveal className="text-[var(--step-head)] font-extrabold leading-none tracking-[-0.02em] [font-stretch:110%]">
          What the counter prints
        </h2>
        <div className="flex gap-2">
          {[
            ["Previous panel", active - 1, "M10 3 5 8l5 5"],
            ["Next panel", active + 1, "m6 3 5 5-5 5"],
          ].map(([label, target, d]) => (
            <button
              key={label as string}
              type="button"
              aria-label={label as string}
              onClick={() => go(target as number)}
              disabled={(target as number) < 0 || (target as number) >= panels.length}
              className="grid size-12 place-items-center bg-surface text-ink transition-colors duration-150 hover:bg-ink hover:text-accent-ink disabled:opacity-40 disabled:hover:bg-surface disabled:hover:text-ink"
            >
              <svg viewBox="0 0 16 16" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d={d as string} />
              </svg>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-12">
        <div
          ref={rowRef}
          tabIndex={0}
          role="region"
          aria-label="Product panels, scroll sideways"
          className="flex snap-x snap-mandatory items-center gap-[clamp(1.5rem,6vw,6rem)] overflow-x-auto overscroll-x-contain px-[7vw] py-6 [scrollbar-width:none] lg:px-[calc(50%-12rem)]"
        >
          <ul className="contents">
            {panels.map((p, i) => (
              <li
                key={p.name}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                className={`shrink-0 snap-center transition-transform duration-500 ease-[var(--ease-out)] ${p.width} ${i === active ? "scale-100" : "scale-[0.94]"}`}
                inert={i !== active}
                onClick={() => i !== active && go(i)}
              >
                {p.render(i === active)}
              </li>
            ))}
          </ul>
        </div>
        <div className="page mt-8 sm:mx-auto sm:max-w-[44ch] sm:text-center" aria-live="polite">
          <h3 className="text-[1.5rem] font-medium leading-tight">{panel.name}</h3>
          <p className="mt-3 text-ink">{panel.lines[0]}</p>
          <p className="mt-2 text-muted">{panel.lines[1]}</p>
        </div>
      </div>
    </section>
  );
}
