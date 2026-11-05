"use client";

import Link from "next/link";
import { useState } from "react";
import { formatNear, nanosToMs, phaseOf, type Claim, type Phase } from "../../lib/vouch";
import { timeLeft, useNow } from "../claims/format";
import { Icon, ICONS, MONO, PhoneTicket } from "./phoneBits";
import { useAccountCheck } from "./useAccountCheck";

// The parts of Stitch's phone layout that respond to the visitor. Every value is read, not written in.

const TAG = `${MONO} inline-flex items-center px-2 py-0.5 text-[11px] leading-[1.4] uppercase font-bold`;

export function PhoneCheck() {
  const { live, status, error, inputRef, submit } = useAccountCheck();
  return (
    <div className="flex flex-col gap-2 w-full max-w-md">
      <form className="flex flex-col gap-2" onSubmit={submit}>
        <div className="flex flex-col bg-white p-2">
          <label htmlFor="phone-account" className={`${MONO} text-[11px] uppercase tracking-wider text-[#444748] px-1 font-bold`}>query counterparty</label>
          <div className="flex items-center gap-2 mt-1">
            <Icon d={ICONS.terminal} className="size-5 text-black" />
            <input
              ref={inputRef}
              id="phone-account"
              name="account"
              type="text"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              defaultValue="wrap.near"
              aria-describedby="phone-check-error"
              aria-invalid={status === "error"}
              className={`${MONO} w-full min-w-0 bg-transparent text-black text-base font-bold lowercase focus:outline-none`}
            />
          </div>
        </div>
        <button type="submit" disabled={status === "loading"} className="w-full py-4 bg-black text-yellow text-[1.125rem] leading-none uppercase tracking-wider font-extrabold flex items-center justify-center gap-2 active:bg-[#e4e2dc] active:text-black disabled:cursor-wait">
          <span>{status === "loading" ? "checking…" : "check an account"}</span>
          <Icon d={ICONS.forward} />
        </button>
      </form>
      {status === "error" && <p id="phone-check-error" role="status" className="font-semibold lowercase text-black">{error}</p>}
      {live && (
        <div key={live.account + live.note} className="animate-[print_0.6s_var(--ease-out)]">
          <PhoneTicket data={live} />
        </div>
      )}
    </div>
  );
}

type Tab = { id: string; label: string; phases: Phase[] };

const TABS: Tab[] = [
  { id: "open", label: "open now", phases: ["open"] },
  { id: "dispute", label: "in dispute", phases: ["dispute"] },
  { id: "overturned", label: "overturned", phases: ["overturned"] },
  { id: "held", label: "held", phases: ["held", "window-closed"] },
];
const ROWS = 4;
const TAG_COLOUR: Record<string, string> = {
  open: "bg-yellow text-[#231b00]",
  dispute: "bg-[#8fcdfe] text-[#001e30]",
  overturned: "bg-[#e4e2dc] text-[#444748]",
  held: "bg-black text-white",
};

const until = (ns: string, now: number) => {
  const ms = nanosToMs(ns) - now;
  return ms > 0 ? timeLeft(ms) : "closed";
};

// What a dispute is waiting on, and how long the contract gives it.
function disputeClock(claim: Claim, now: number) {
  if (claim.status === "appealed" && claim.appeal) return ["jury vote closes in:", until(claim.appeal.jury_until, now)];
  if (claim.status === "ruled" && claim.ruling) return ["appeal window closes in:", until(claim.ruling.appeal_until, now)];
  return ["now:", "judge deciding"];
}

function CallCard({ claim, tab, stakePct, now }: { claim: Claim; tab: Tab; stakePct: number; now: number }) {
  const bond = BigInt(claim.bond);
  const total = bond + BigInt(claim.challenge?.stake ?? "0");
  const right =
    tab.id === "dispute" ? `${formatNear(total)} NEAR total` :
    tab.id === "overturned" ? "settled" :
    `${formatNear(bond)} NEAR`;
  const reason = claim.reasons[0]?.replace(/.?$/, ".");
  const clock = tab.id === "dispute" ? disputeClock(claim, now) : null;
  return (
    <div className="relative bg-white p-4 flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className={`${TAG} ${TAG_COLOUR[tab.id]}`}>{tab.label}</span>
        <span className={`${MONO} text-xs font-bold text-black`}>{right}</span>
      </div>
      <div>
        <div className={`${MONO} text-[11px] uppercase text-[#747878] font-bold`}>claim #{claim.id} / {claim.verdict}</div>
        <Link href={`/claims/${claim.id}`} className={`${MONO} text-sm font-bold text-black [overflow-wrap:anywhere] no-underline after:absolute after:inset-0`} translate="no">{claim.subject}</Link>
      </div>
      <p className="text-[0.875rem] leading-[1.4] font-medium text-[#444748] lowercase">
        {reason}
        {tab.id === "open" && ` ${until(claim.challenge_until, now)} left in the challenge window.`}
        {tab.id === "overturned" && ` the bond of ${formatNear(bond)} NEAR went to the challenger.`}
      </p>
      {clock && (
        <div className={`${MONO} bg-[#f5f3ed] p-2 flex justify-between gap-3 text-[11px]`}>
          <span>{clock[0]}</span>
          <span className="font-bold text-black">{clock[1]}</span>
        </div>
      )}
      {tab.id === "open" && (
        <span className="w-full py-2 bg-black text-yellow text-[0.875rem] leading-none uppercase font-bold text-center">
          challenge claim ({formatNear((bond / BigInt(100)) * BigInt(stakePct))} near)
        </span>
      )}
    </div>
  );
}

export function PhoneLedger({ claims, stakePct, serverNow }: { claims: Claim[]; stakePct: number; serverNow: number }) {
  const now = useNow(serverNow);
  const [filter, setFilter] = useState("all");
  const inTab = (t: Tab) => claims.filter((c) => t.phases.includes(phaseOf(c, now)));

  // "All" shows the newest call in each state, the way the design does.
  const cards = filter === "all"
    ? TABS.flatMap((t) => inTab(t).slice(0, 1).map((claim) => ({ claim, tab: t })))
    : TABS.filter((t) => t.id === filter).flatMap((t) => inTab(t).slice(0, ROWS).map((claim) => ({ claim, tab: t })));

  const pill = (id: string, label: string, count: number) => (
    <button
      key={id}
      type="button"
      aria-pressed={filter === id}
      onClick={() => setFilter(id)}
      className={`${MONO} px-3 py-1.5 text-xs uppercase whitespace-nowrap ${filter === id ? "bg-black text-white font-extrabold" : "bg-[#e4e2dc] text-black font-bold"}`}
    >
      {label} ({count})
    </button>
  );

  return (
    <>
      <div role="group" aria-label="Filter calls" className="flex items-center gap-1.5 overflow-x-auto pb-2 mb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {pill("all", "all", claims.length)}
        {TABS.map((t) => pill(t.id, t.label, inTab(t).length))}
      </div>
      <div className="flex flex-col gap-3">
        {cards.length ? (
          cards.map(({ claim, tab }) => <CallCard key={claim.id} claim={claim} tab={tab} stakePct={stakePct} now={now} />)
        ) : (
          <p className="bg-white p-4 text-[0.875rem] font-medium lowercase text-[#444748]">Nothing here right now.</p>
        )}
      </div>
      <Link href="/claims" className={`${MONO} inline-block mt-4 text-xs uppercase tracking-wider font-bold text-black underline underline-offset-4 decoration-2`}>
        see all {claims.length} calls
      </Link>
    </>
  );
}

const DEFAULT_ACCOUNT = "wrap.near";

export function PhoneLastCheck({ activeBySubject }: { activeBySubject: Record<string, number> }) {
  const { live, status, error, inputRef, submit } = useAccountCheck({ fromUrl: false });
  const [typed, setTyped] = useState(DEFAULT_ACCOUNT);
  const active = activeBySubject[typed.trim().toLowerCase()] ?? 0;
  return (
    <form className="flex flex-col gap-2 w-full mb-8" onSubmit={submit}>
      <div className="bg-white p-3 flex items-center justify-between gap-2">
        <label htmlFor="phone-last-account" className="sr-only">NEAR account to check</label>
        <input
          ref={inputRef}
          id="phone-last-account"
          name="account"
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          defaultValue={DEFAULT_ACCOUNT}
          onChange={(e) => setTyped(e.target.value)}
          className={`${MONO} min-w-0 flex-1 bg-transparent text-base font-bold text-black lowercase focus:outline-none`}
        />
        <span className={`${MONO} shrink-0 px-2 py-0.5 bg-[#eae8e2] text-black text-xs uppercase font-extrabold`}>
          {active} {active === 1 ? "claim" : "claims"} active
        </span>
      </div>
      <button type="submit" disabled={status === "loading"} className="w-full py-4 bg-black text-yellow text-[1.125rem] leading-none uppercase tracking-wider font-extrabold active:bg-[#e4e2dc] active:text-black disabled:cursor-wait">
        {status === "loading" ? "checking…" : "instant verify counterparty"}
      </button>
      {status === "error" && <p role="status" className="font-semibold lowercase text-black">{error}</p>}
      {live && (
        <div key={live.account + live.note} className="animate-[print_0.6s_var(--ease-out)]">
          <PhoneTicket data={live} />
        </div>
      )}
    </form>
  );
}
