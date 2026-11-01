"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Ticket, sampleTickets } from "./Ticket";

type Panel = { name: string; lines: [string, string]; width: string; render: (lit: boolean) => ReactNode };

function Frame({ lit, children, className = "" }: { lit: boolean; children: ReactNode; className?: string }) {
  return (
    <div data-ui className={`p-6 ${lit ? "bg-lit text-lit-ink" : "bg-surface text-muted"} ${className}`}>
      {children}
    </div>
  );
}

const panels: Panel[] = [
  {
    name: "The bond ticket",
    lines: ["Every call prints one: the reasons, the bond behind it, and how long anyone can challenge it.", "Sample data."],
    width: "w-[min(86vw,22rem)]",
    render: (lit) => <Ticket data={sampleTickets[0]} lit={lit} />,
  },
  {
    name: "The agent's signer",
    lines: ["It refuses to sign on block and asks you on warn. Its key can call one contract and nothing else.", "Sample log."],
    width: "w-[min(86vw,28rem)]",
    render: (lit) => (
      <Frame lit={lit}>
        <pre className="whitespace-pre-wrap font-mono text-[0.8125rem] leading-relaxed [overflow-wrap:anywhere]">
          {`pay-agent  transfer 40 USDC to free-airdrop-claim.near
vouch      check free-airdrop-claim.near
vouch      BLOCK, bond 5 NEAR, sentinel.vouch.testnet
signer     refused: verdict is block
human      not asked: block needs no approval`}
        </pre>
      </Frame>
    ),
  },
  {
    name: "The challenge",
    lines: ["Anyone can dispute a call. Put up a counter-stake and the evidence, and the contract waits for a ruling.", "Sample form."],
    width: "w-[min(86vw,24rem)]",
    render: (lit) => (
      <Frame lit={lit} className="space-y-4 text-[0.9375rem]">
        <p className="font-medium">Challenge call 417 on new-dex-router.near</p>
        <div>
          <p className={lit ? "text-lit-muted" : ""}>Evidence</p>
          <p className={`mt-1 p-3 ${lit ? "bg-white/60" : "bg-bg"}`}>Owner key minted 9M tokens to itself at block 222,481,077.</p>
        </div>
        <div className="flex items-baseline justify-between tabular-nums">
          <span className={lit ? "text-lit-muted" : ""}>Counter-stake</span>
          <span className="font-medium">1&nbsp;NEAR</span>
        </div>
        <p className={`py-2.5 text-center font-medium ${lit ? "bg-lit-ink text-lit" : "bg-bg"}`}>File challenge</p>
      </Frame>
    ),
  },
  {
    name: "The ruling",
    lines: ["An AI judge running in a TEE rules, with an attestation anyone can verify. The loser can appeal to a staked jury.", "Sample ruling."],
    width: "w-[min(86vw,24rem)]",
    render: (lit) => (
      <Frame lit={lit} className="space-y-3 text-[0.9375rem]">
        <p className="font-medium">Ruling on call 417</p>
        <p className="display text-[2rem]">Challenger wins</p>
        <dl className="space-y-1.5 tabular-nums">
          {[
            ["Bond moved", "2 NEAR to challenger"],
            ["Model", "Ran in a TEE"],
            ["Attestation", "Verified"],
            ["Appeal window", "48 hours"],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4">
              <dt className={lit ? "text-lit-muted" : ""}>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </Frame>
    ),
  },
  {
    name: "The agent's record",
    lines: ["Every checking agent carries a public record backed by money. Lose too many calls and the bond runs out.", "Sample record."],
    width: "w-[min(86vw,26rem)]",
    render: (lit) => (
      <Frame lit={lit} className="text-[0.9375rem]">
        <p className="font-medium" translate="no">
          sentinel.vouch.testnet
        </p>
        <table className="mt-4 w-full border-collapse tabular-nums">
          <tbody>
            {[
              ["Calls made", "128"],
              ["Calls held", "124"],
              ["Calls lost", "4"],
              ["Bond lost", "11 NEAR"],
              ["Bond at stake now", "40 NEAR"],
            ].map(([k, v], i) => (
              <tr key={k} className={i % 2 ? "" : lit ? "bg-lit-ink/[0.06]" : "bg-bg/60"}>
                <td className={`px-2 py-2 ${lit ? "text-lit-muted" : ""}`}>{k}</td>
                <td className="px-2 py-2 text-right">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Frame>
    ),
  },
  {
    name: "One call in your agent",
    lines: ["Check before every payment. Refuse on block, ask a human on warn.", "Sample code: the SDK is in progress."],
    width: "w-[min(86vw,30rem)]",
    render: (lit) => (
      <Frame lit={lit}>
        <pre className="overflow-x-auto font-mono text-[0.875rem] leading-relaxed">
          <code>{`const call = await vouch.check(receiver);

if (call.verdict === "block") throw new Refused(call);
if (call.verdict === "warn") await askHuman(call);

await pay(receiver, amount);`}</code>
        </pre>
      </Frame>
    ),
  },
];

export function Showcase() {
  const [active, setActive] = useState(0);
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
