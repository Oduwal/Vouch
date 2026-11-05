"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { eligibleJurors, formatNear, JURY_SIZE, isDemoJuror, nanosToMs, view, type Claim, type Config, type Juror, type Side } from "../../lib/vouch";
import { useWallet } from "../../lib/wallet";
import { formatDate, timeLeft } from "./format";

// Covers closing the appeal in the same call: juror payouts and the settlement.
const JURY_TGAS = 100;
const SEAL_TGAS = 30;

function useAction(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      onDone();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "The wallet did not send the transaction. Nothing changed.");
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

export function AppealPanel({ claim, config, jurors, now, onDone }: { claim: Claim; config: Config; jurors: Juror[] | null; now: number; onDone: () => void }) {
  const { accountId, connect, call } = useWallet();
  const { busy, error, run } = useAction(onDone);
  const { ruling, challenge } = claim;
  if (!ruling || !challenge) return null;

  const loser = ruling.winner === "agent" ? challenge.challenger : claim.agent;
  const open = nanosToMs(ruling.appeal_until) > now;
  const eligible = jurors ? eligibleJurors(jurors, claim, config).length : null;
  const short = eligible !== null && eligible < JURY_SIZE;
  const fee = formatNear(config.appeal_fee);

  if (!open) {
    return <p className="mt-5 text-[0.875rem] text-muted">The appeal window has closed. The ruling takes effect when the claim is closed.</p>;
  }

  return (
    <div className="mt-5 bg-bg p-4">
      <h3 className="text-[0.875rem] font-medium">Appeal to a jury</h3>
      <p className="mt-1 max-w-[65ch] text-[0.875rem]">
        <span translate="no">{loser}</span> can send this to {JURY_SIZE} jurors drawn at random for {fee} NEAR within {timeLeft(nanosToMs(ruling.appeal_until) - now)}.
        Jurors on the majority split the fee, after a {formatNear(config.appeal_storage_fee)} NEAR storage fee, whichever way they vote. If they reach no majority in time, the ruling stands and it goes back.
      </p>
      {short && (
        <p className="mt-2 text-[0.875rem] font-medium">
          An appeal can&apos;t start yet: only {eligible} of the {JURY_SIZE} jurors it needs are outside this case.{" "}
          <Link href="/jury" className="underline">Join the jury</Link>.
        </p>
      )}
      <div className="mt-3">
        {accountId === loser ? (
          <button
            type="button"
            disabled={busy || short}
            onClick={() => run(() => call("appeal", { claim_id: claim.id }, BigInt(config.appeal_fee), JURY_TGAS))}
            className="min-h-11 bg-ink px-4 text-[0.875rem] font-semibold text-accent-ink transition-colors duration-150 hover:bg-press active:bg-muted disabled:cursor-not-allowed disabled:bg-muted sm:min-h-9"
          >
            {busy ? "Waiting for your wallet…" : `Appeal for ${fee} NEAR`}
          </button>
        ) : accountId ? (
          <p className="text-[0.8125rem] text-muted">You&apos;re connected as <span translate="no">{accountId}</span>, which didn&apos;t lose this ruling.</p>
        ) : (
          <button
            type="button"
            onClick={() => run(connect)}
            className="min-h-11 px-4 text-[0.875rem] outline outline-1 -outline-offset-1 outline-muted transition-colors duration-150 hover:bg-surface sm:min-h-9"
          >
            Connect wallet to appeal
          </button>
        )}
      </div>
      {error && <p role="alert" className="mt-2 text-[0.875rem] font-medium">{error}</p>}
    </div>
  );
}

// A juror's sealed vote lives only in this browser until it's revealed.
const voteKey = (claimId: string, juror: string) => `vouch-vote:${claimId}:${juror}`;

function savedVote(claimId: string, juror: string): { side: Side; salt: string } | null {
  try {
    const raw = localStorage.getItem(voteKey(claimId, juror));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function commitmentOf(claimId: string, juror: string, side: Side, salt: string) {
  const data = new TextEncoder().encode(`${claimId}:${juror}:${side}:${salt}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function JuryPanel({ claim, config, now, onDone }: { claim: Claim; config: Config; now: number; onDone: () => void }) {
  const { accountId, connect, call } = useWallet();
  const [sealed, setSealed] = useState<string[]>([]);
  const refreshSealed = useCallback(async () => {
    if (!claim.appeal) return;
    const flags = await Promise.all(claim.appeal.jury.map((juror) => view<boolean>("has_committed", { claim_id: claim.id, juror }).catch(() => false)));
    setSealed(claim.appeal.jury.filter((_, i) => flags[i]));
  }, [claim.appeal, claim.id]);
  const { busy, error, run } = useAction(() => {
    void refreshSealed();
    onDone();
  });

  useEffect(() => {
    const first = window.setTimeout(() => void refreshSealed(), 0);
    const id = window.setInterval(() => {
      if (!document.hidden) void refreshSealed();
    }, 15_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [refreshSealed]);

  const { appeal } = claim;
  if (!appeal) return null;

  const until = nanosToMs(appeal.jury_until);
  const sealBy = until - nanosToMs(config.jury_window) / 2;
  const open = claim.status === "appealed" && until > now;
  const seated = !!accountId && appeal.jury.includes(accountId);
  const voted = appeal.votes.some((v) => v.juror === accountId);
  const iSealed = !!accountId && sealed.includes(accountId);
  const sealingOpen = now < sealBy;
  const revealOpen = sealed.length === appeal.jury.length || now >= sealBy;
  const mine = accountId ? savedVote(claim.id, accountId) : null;

  function seal(side: Side) {
    if (!accountId) return;
    const juror = accountId;
    void run(async () => {
      const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
      // Saved first: a vote that's sealed on-chain but lost here could never be revealed.
      localStorage.setItem(voteKey(claim.id, juror), JSON.stringify({ side, salt }));
      await call("commit_vote", { claim_id: claim.id, commitment: await commitmentOf(claim.id, juror, side, salt) }, BigInt(0), SEAL_TGAS);
    });
  }

  function reveal() {
    if (!mine) return;
    void run(() => call("reveal_vote", { claim_id: claim.id, side: mine.side, salt: mine.salt }, BigInt(0), JURY_TGAS));
  }

  return (
    <div className="mt-5 bg-bg p-4">
      <h3 className="text-[0.875rem] font-medium">
        {claim.ruling ? <>Appeal by <span translate="no">{appeal.appellant}</span></> : "The judge gave no ruling, so a jury took the case"}, {formatNear(appeal.fee)} NEAR for the jurors
      </h3>
      <ul className="mt-2 text-[0.875rem]">
        {appeal.jury.map((juror) => {
          const cast = appeal.votes.find((v) => v.juror === juror);
          const status = cast ? `Voted for the ${cast.side}` : sealed.includes(juror) ? "Vote sealed" : open ? "Has not voted" : "Not counted";
          return (
            <li key={juror} className="flex flex-wrap justify-between gap-x-4 py-1">
              <span className="min-w-0 break-words">
                <span translate="no">{juror}</span>
                {isDemoJuror(juror) && <span className="text-muted"> Demo juror (bot)</span>}
              </span>
              <span className={cast ? "font-medium" : "text-muted"}>{status}</span>
            </li>
          );
        })}
      </ul>

      {open && (
        <div className="mt-3">
          {seated && voted ? (
            <p className="text-[0.8125rem] text-muted">Your vote is in.</p>
          ) : seated && !iSealed && sealingOpen ? (
            <>
              <p className="max-w-[65ch] text-[0.875rem]">
                You were drawn for this jury. Read the call, the evidence and any ruling above, then seal your vote before {formatDate(String(BigInt(Math.floor(sealBy)) * BigInt(1_000_000)))}.
                Nobody can see how you voted until everyone has sealed. If you don&apos;t vote, you lose {config.no_show_slash_pct}% of your stake.
              </p>
              {/* The two votes look the same on purpose: the screen must not lean either way. */}
              <div className="mt-2 flex flex-wrap gap-2">
                {(["agent", "challenger"] as const).map((side) => (
                  <button
                    key={side}
                    type="button"
                    disabled={busy}
                    onClick={() => seal(side)}
                    className="min-h-11 px-4 text-[0.875rem] font-medium outline outline-1 -outline-offset-1 outline-ink transition-colors duration-150 hover:bg-surface active:bg-deep disabled:cursor-wait sm:min-h-9"
                  >
                    Side with the {side}
                  </button>
                ))}
              </div>
            </>
          ) : seated && iSealed && !revealOpen ? (
            <p className="text-[0.8125rem] text-muted">Your vote is sealed. You can reveal it once all {appeal.jury.length} jurors have sealed.</p>
          ) : seated && iSealed && mine ? (
            <>
              <p className="max-w-[65ch] text-[0.875rem]">Voting is sealed. Reveal your vote to count it, before {formatDate(appeal.jury_until)}.</p>
              <button
                type="button"
                disabled={busy}
                onClick={reveal}
                className="mt-2 min-h-11 bg-ink px-4 text-[0.875rem] font-semibold text-accent-ink transition-colors duration-150 hover:bg-press active:bg-muted disabled:cursor-wait disabled:bg-muted sm:min-h-9"
              >
                {busy ? "Waiting for your wallet…" : "Reveal my vote"}
              </button>
            </>
          ) : seated && iSealed ? (
            <p className="max-w-[65ch] text-[0.875rem] font-medium">You sealed this vote in another browser. Reveal it from there, or it won&apos;t count.</p>
          ) : seated ? (
            <p className="text-[0.8125rem] text-muted">The time to seal a vote has passed.</p>
          ) : accountId ? (
            <p className="text-[0.8125rem] text-muted">Only the {appeal.jury.length} jurors drawn for this case can vote.</p>
          ) : (
            <button
              type="button"
              onClick={() => run(connect)}
              className="min-h-11 px-4 text-[0.875rem] outline outline-1 -outline-offset-1 outline-muted transition-colors duration-150 hover:bg-surface sm:min-h-9"
            >
              Connect wallet if you were drawn
            </button>
          )}
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-[0.875rem] font-medium">{error}</p>}
    </div>
  );
}
