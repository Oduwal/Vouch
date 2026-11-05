"use client";

import Link from "next/link";
import { useState } from "react";
import { formatNear, phaseOf, type Claim, type Phase } from "../../lib/vouch";
import { useNow } from "../claims/format";

type Tab = { id: string; label: string; phases: Phase[] };

const TABS: Tab[] = [
  { id: "open", label: "open now", phases: ["open"] },
  { id: "dispute", label: "in dispute", phases: ["dispute"] },
  { id: "overturned", label: "overturned", phases: ["overturned"] },
  { id: "held", label: "held", phases: ["held", "window-closed"] },
];
const ROWS = 4;

const VERDICT: Record<Claim["verdict"], string> = {
  block: "bg-night text-white border-paper",
  warn: "bg-yellow text-night border-night",
  allow: "bg-white text-night border-night",
};
const STATUS: Record<string, string> = {
  open: "bg-yellow text-night",
  dispute: "bg-sky text-night",
  overturned: "bg-white text-night",
  held: "bg-paper text-night",
};

// The contract's real calls, by where they stand.
export function CallsList({ claims, serverNow }: { claims: Claim[]; serverNow: number }) {
  const now = useNow(serverNow);
  const [tab, setTab] = useState(TABS[0].id);
  const inTab = (t: Tab) => claims.filter((c) => t.phases.includes(phaseOf(c, now)));
  const active = TABS.find((t) => t.id === tab) ?? TABS[0];
  const rows = inTab(active).slice(0, ROWS);

  return (
    <div className="flex flex-col md:flex-row gap-0 border-2 border-paper">
      <div role="group" aria-label="Filter calls" className="w-full md:w-1/3 flex flex-col border-b-2 md:border-b-0 md:border-r-2 border-paper">
        {TABS.map((t, i) => {
          const selected = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={selected}
              onClick={() => setTab(t.id)}
              className={`font-bold p-5 lowercase text-left flex justify-between items-center cursor-pointer ${i < TABS.length - 1 ? "border-b-2 border-night" : ""} ${selected ? "bg-yellow text-night" : "bg-graphite text-paper hover:bg-white hover:text-black"}`}
            >
              <span>{t.label}</span>
              {selected && <span className="text-xs bg-night text-yellow px-2 py-0.5 font-bold tabular-nums">{inTab(t).length}</span>}
            </button>
          );
        })}
      </div>
      <div className="w-full md:w-2/3 bg-graphite divide-y-2 divide-night">
        {rows.length ? (
          rows.map((claim) => (
            <Link key={claim.id} href={`/claims/${claim.id}`} className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-[#1c1b1b] no-underline">
              <span className="flex items-center gap-4 min-w-0">
                <span className={`px-3 py-1 text-xs font-black lowercase border ${VERDICT[claim.verdict]}`}>{claim.verdict}</span>
                <span className="font-bold text-sm lg:text-base lowercase text-paper break-all" translate="no">{claim.subject}</span>
              </span>
              <span className="flex items-center gap-4 shrink-0">
                <span className="font-mono text-sm text-yellow">{formatNear(claim.bond)} NEAR</span>
                <span className={`text-xs font-bold px-2 py-1 lowercase ${STATUS[active.id]}`}>{active.label}</span>
              </span>
            </Link>
          ))
        ) : (
          <p className="p-6 text-paper lowercase font-medium">Nothing is {active.label} right now.</p>
        )}
      </div>
    </div>
  );
}
