"use client";

import Link from "next/link";
import { useState } from "react";
import { eligibleJurors, formatNear, JURY_SIZE, nanosToMs, type Claim, type Config, type Juror, type Side } from "../../lib/vouch";
import { useWallet } from "../../lib/wallet";
import { formatDate, timeLeft } from "./format";

// Covers closing the appeal in the same call: juror payouts and the settlement.
const JURY_TGAS = 100;

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
    return <p className="mt-5 text-[0.875rem] text-muted">The appeal window has closed. The ruling becomes final when the claim is closed.</p>;
  }

  return (
    <div className="mt-5 bg-bg p-4">
      <h3 className="text-[0.875rem] font-medium">Appeal to a jury</h3>
      <p className="mt-1 max-w-[65ch] text-[0.875rem]">
        <span translate="no">{loser}</span> can send this to {JURY_SIZE} jurors drawn at random for {fee} NEAR within {timeLeft(nanosToMs(ruling.appeal_until) - now)}.
        Jurors on the majority split the fee, whichever way they vote. If they reach no majority in time, the ruling stands and the fee goes back.
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
            className="min-h-11 bg-ink px-4 text-[0.875rem] font-semibold text-accent-ink transition-colors duration-150 hover:bg-lit active:bg-muted disabled:cursor-not-allowed disabled:bg-muted sm:min-h-9"
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

export function JuryPanel({ claim, now, onDone }: { claim: Claim; now: number; onDone: () => void }) {
  const { accountId, connect, call } = useWallet();
  const { busy, error, run } = useAction(onDone);
  const { appeal } = claim;
  if (!appeal) return null;

  const open = claim.status === "appealed" && nanosToMs(appeal.jury_until) > now;
  const seated = !!accountId && appeal.jury.includes(accountId);
  const voted = appeal.votes.some((v) => v.juror === accountId);
  const vote = (side: Side) => run(() => call("vote", { claim_id: claim.id, side }, BigInt(0), JURY_TGAS));

  return (
    <div className="mt-5 bg-bg p-4">
      <h3 className="text-[0.875rem] font-medium">
        Appeal by <span translate="no">{appeal.appellant}</span>, {formatNear(appeal.fee)} NEAR fee
      </h3>
      <ul className="mt-2 text-[0.875rem]">
        {appeal.jury.map((juror) => {
          const cast = appeal.votes.find((v) => v.juror === juror);
          return (
            <li key={juror} className="flex flex-wrap justify-between gap-x-4 py-1">
              <span className="min-w-0 break-words" translate="no">{juror}</span>
              <span className={cast ? "font-medium" : "text-muted"}>{cast ? `Voted for the ${cast.side}` : open ? "Has not voted" : "Did not vote"}</span>
            </li>
          );
        })}
      </ul>

      {open && (
        <div className="mt-3">
          {seated && !voted ? (
            <>
              <p className="max-w-[65ch] text-[0.875rem]">
                You were drawn for this jury. Read the call, the evidence and the ruling above, then vote before {formatDate(appeal.jury_until)}.
              </p>
              {/* The two votes look the same on purpose: the screen must not lean either way. */}
              <div className="mt-2 flex flex-wrap gap-2">
                {(["agent", "challenger"] as const).map((side) => (
                  <button
                    key={side}
                    type="button"
                    disabled={busy}
                    onClick={() => vote(side)}
                    className="min-h-11 px-4 text-[0.875rem] font-medium outline outline-1 -outline-offset-1 outline-ink transition-colors duration-150 hover:bg-surface active:bg-deep disabled:cursor-wait sm:min-h-9"
                  >
                    Side with the {side}
                  </button>
                ))}
              </div>
            </>
          ) : seated ? (
            <p className="text-[0.8125rem] text-muted">Your vote is in.</p>
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
