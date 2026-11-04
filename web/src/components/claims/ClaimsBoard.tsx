"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatNear, latestClaims, nanosToMs, phaseOf, type Claim, type Phase } from "../../lib/vouch";
import { LevelIcon } from "../Ticket";
import { formatClock, statusLine, timeLeft, useNow } from "./format";

type Filter = "open" | "dispute" | "held" | "overturned" | "void";

const FILTERS: { id: Filter; label: string; phases: Phase[] }[] = [
  { id: "open", label: "Open to challenge", phases: ["open"] },
  { id: "dispute", label: "In dispute", phases: ["dispute"] },
  // A window that closed unchallenged is a call that stood; only the release transaction is still to come.
  { id: "held", label: "Held", phases: ["held", "window-closed"] },
  { id: "overturned", label: "Overturned", phases: ["overturned"] },
  { id: "void", label: "Void", phases: ["void"] },
];

const EMPTY: Record<Filter, string> = {
  open: "No calls are open to challenge right now.",
  dispute: "No calls are in dispute right now.",
  held: "No calls have held yet.",
  overturned: "No calls have been overturned yet.",
  void: "No challenges have gone unruled.",
};

const verdictLabel = { allow: "Allow", warn: "Warn", block: "Block" };

export function ClaimsBoard({ initial, serverNow }: { initial: Claim[]; serverNow: number }) {
  const [claims, setClaims] = useState(initial);
  const [filter, setFilter] = useState<Filter>("open");
  const [updatedAt, setUpdatedAt] = useState(serverNow);
  const [failed, setFailed] = useState(false);
  const now = useNow(serverNow);

  const refresh = useCallback(async () => {
    try {
      setClaims(await latestClaims());
      setUpdatedAt(Date.now());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 20_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const groups = useMemo(() => {
    const byFilter = new Map<Filter, Claim[]>(FILTERS.map((f) => [f.id, []]));
    for (const claim of claims) {
      const phase = phaseOf(claim, now);
      const match = FILTERS.find((f) => f.phases.includes(phase));
      if (match) byFilter.get(match.id)?.push(claim);
    }
    // The next window to close is the most urgent.
    byFilter.get("open")?.sort((a, b) => nanosToMs(a.challenge_until) - nanosToMs(b.challenge_until));
    return byFilter;
  }, [claims, now]);

  const open = groups.get("open") ?? [];
  const rows = groups.get(filter) ?? [];
  const atStake = open.reduce((sum, c) => sum + BigInt(c.bond), BigInt(0));

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h1 className="text-[1.5rem] font-bold leading-tight tracking-[-0.01em]">Bonded calls</h1>
        <p className="text-[0.75rem] text-muted tabular-nums" role="status">
          {failed ? (
            <>
              Couldn&apos;t refresh. Last updated {formatClock(updatedAt)}.{" "}
              <button type="button" onClick={refresh} className="underline">
                Retry
              </button>
            </>
          ) : (
            <>Updated {formatClock(updatedAt)}, NEAR testnet</>
          )}
        </p>
      </div>
      <p className="mt-1 max-w-[65ch] text-[0.9375rem]">
        {open.length
          ? `${open.length} ${open.length === 1 ? "call is" : "calls are"} open to challenge with ${formatNear(atStake)} NEAR at stake. The next window closes in ${timeLeft(nanosToMs(open[0].challenge_until) - now)}.`
          : "Nothing is open to challenge right now. The sentinel keeps two calls open, so check back in a minute."}
      </p>

      <div role="group" aria-label="Filter calls" className="mt-6 flex gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-5 sm:overflow-visible">
        {FILTERS.map((f) => {
          const selected = f.id === filter;
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={selected}
              onClick={() => setFilter(f.id)}
              className={`min-w-[8.5rem] shrink-0 bg-surface px-3 py-2.5 text-left outline-offset-[-2px] transition-colors duration-150 hover:bg-deep sm:min-w-0 ${selected ? "outline outline-2 -outline-offset-2 outline-ink" : ""}`}
            >
              <span className="block whitespace-nowrap text-[0.8125rem] text-muted">{f.label}</span>
              <span className="block text-[1.125rem] font-semibold tabular-nums">{groups.get(f.id)?.length ?? 0}</span>
            </button>
          );
        })}
      </div>

      {rows.length ? (
        <table className="mt-4 w-full table-fixed border-collapse bg-surface text-[0.875rem]">
          <thead className="max-sm:sr-only">
            <tr className="text-[0.75rem] text-muted">
              <th scope="col" className="px-4 py-2.5 text-left font-normal">Account</th>
              <th scope="col" className="w-24 px-4 py-2.5 text-left font-normal">Call</th>
              <th scope="col" className="w-28 px-4 py-2.5 text-right font-normal">Bond</th>
              <th scope="col" className="w-52 px-4 py-2.5 text-right font-normal">Status</th>
              <th scope="col" className="w-28 px-4 py-2.5 font-normal"><span className="sr-only">Action</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((claim) => {
              const challengeable = phaseOf(claim, now) === "open";
              return (
                <tr key={claim.id} className="border-t border-bg transition-colors duration-150 hover:bg-deep">
                  <td className="px-4 py-3">
                    <Link href={`/claims/${claim.id}`} className="block break-words font-medium no-underline hover:underline sm:truncate" translate="no">
                      {claim.subject}
                    </Link>
                    <p className="mt-0.5 text-[0.8125rem] text-muted sm:truncate">{claim.reasons[0]}</p>
                    <p className="mt-0.5 text-[0.8125rem] text-muted tabular-nums sm:hidden">
                      {formatNear(claim.bond)} NEAR, {statusLine(claim, now)}
                    </p>
                  </td>
                  <td className="w-24 whitespace-nowrap px-4 py-3 align-top">
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      <LevelIcon level={claim.verdict} />
                      {verdictLabel[claim.verdict]}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right align-top tabular-nums max-sm:hidden">
                    {formatNear(claim.bond)} <span className="text-[0.75rem] text-muted">NEAR</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right align-top text-muted tabular-nums max-sm:hidden">
                    {statusLine(claim, now)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right align-top max-sm:hidden">
                    {challengeable && (
                      <Link href={`/claims/${claim.id}#challenge`} className="font-medium underline-offset-4 hover:underline">
                        Challenge
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="mt-4 bg-surface px-4 py-3 text-[0.875rem] text-muted">{EMPTY[filter]}</p>
      )}
    </>
  );
}

export function ClaimsBoardSkeleton() {
  return (
    <>
      <h1 className="text-[1.5rem] font-bold leading-tight tracking-[-0.01em]">Bonded calls</h1>
      <div className="mt-2 h-5 max-w-[32rem] bg-surface" />
      <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {FILTERS.map((f) => (
          <div key={f.id} className="bg-surface px-3 py-2.5">
            <span className="block whitespace-nowrap text-[0.8125rem] text-muted">{f.label}</span>
            <span className="mt-1 block h-5 w-6 bg-bg" />
          </div>
        ))}
      </div>
      <div className="mt-4 h-64 bg-surface" />
    </>
  );
}
