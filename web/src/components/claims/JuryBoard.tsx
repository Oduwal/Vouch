"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatNear, formatWindow, isDemoJuror, JURY_SIZE, latestClaims, nanosToMs, parseNear, view, type Claim, type Config, type Juror } from "../../lib/vouch";
import { useWallet } from "../../lib/wallet";
import { formatDate, useNow } from "./format";

const JOIN_TGAS = 30;
const LEAVE_TGAS = 30;
const ONE_YOCTO = BigInt(1);

function YourSeat({ me, config, now, onDone }: { me: Juror | null; config: Config; now: number; onDone: () => void }) {
  const { accountId, connect, call } = useWallet();
  const [stake, setStake] = useState(() => formatNear(config.juror_stake));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [joinedAt, setJoinedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!accountId || !me) return;
    void view<string | null>("get_juror_joined", { account: accountId })
      .then((t) => setJoinedAt(t ? nanosToMs(t) : null))
      .catch(() => {});
  }, [accountId, me]);

  const lockedUntil = joinedAt === null ? null : joinedAt + nanosToMs(config.juror_lockup);
  const locked = lockedUntil !== null && now < lockedUntil;

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

  function join() {
    const amount = parseNear(stake);
    if (amount === null) return setError("Enter the stake as a NEAR amount, like 0.5.");
    if (amount < BigInt(config.juror_stake)) return setError(`The stake must be at least ${formatNear(config.juror_stake)} NEAR.`);
    void run(() => call("join_jury", {}, amount + BigInt(config.juror_fee), JOIN_TGAS));
  }

  return (
    <section aria-labelledby="seat-title" className="bg-surface p-5">
      <h2 id="seat-title" className="text-[1rem] font-semibold">Your seat</h2>
      {!accountId ? (
        <>
          <p className="mt-1 text-[0.875rem]">Connect a testnet wallet to join the pool or vote on a case you were drawn for.</p>
          <button type="button" onClick={() => run(connect)} className="mt-3 min-h-11 bg-ink px-4 text-[0.875rem] font-semibold text-accent-ink transition-colors duration-150 hover:bg-lit active:bg-muted sm:min-h-9">
            Connect wallet
          </button>
        </>
      ) : me ? (
        <>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-[0.8125rem] tabular-nums">
            <div>
              <dt className="text-muted">Stake</dt>
              <dd className="text-[1rem] font-semibold">{formatNear(me.stake)}</dd>
            </div>
            <div>
              <dt className="text-muted">Votes</dt>
              <dd className="text-[1rem] font-semibold">{me.votes_cast}</dd>
            </div>
            <div>
              <dt className="text-muted">With majority</dt>
              <dd className="text-[1rem] font-semibold">{me.votes_with_majority}</dd>
            </div>
          </dl>
          <button
            type="button"
            disabled={busy || me.open_cases > 0 || locked}
            onClick={() => run(() => call("leave_jury", {}, ONE_YOCTO, LEAVE_TGAS))}
            className="mt-4 min-h-11 px-4 text-[0.875rem] outline outline-1 -outline-offset-1 outline-muted transition-colors duration-150 hover:bg-bg disabled:cursor-not-allowed disabled:text-muted sm:min-h-9"
          >
            {busy ? "Waiting for your wallet…" : `Leave and take back ${formatNear(me.stake)} NEAR`}
          </button>
          {locked && me.open_cases === 0 && (
            <p className="mt-2 text-[0.8125rem] text-muted">Your stake is locked for {formatWindow(config.juror_lockup)} after joining, so you can leave after {new Date(lockedUntil as number).toISOString().slice(11, 16)} UTC.</p>
          )}
          {me.open_cases > 0 && (
            <p className="mt-2 text-[0.8125rem] text-muted">
              You can leave once your {me.open_cases === 1 ? "open case closes" : `${me.open_cases} open cases close`}.
            </p>
          )}
        </>
      ) : (
        <>
          <p className="mt-1 text-[0.875rem]">
            Jurors on the majority split each appeal&apos;s fee. Voting with the minority costs nothing, but failing to seal a vote, or to reveal it before time runs out, costs {config.no_show_slash_pct}% of your stake. You can be drawn {formatWindow(config.juror_warmup)} after joining and leave after {formatWindow(config.juror_lockup)}.
          </p>
          <label htmlFor="juror-stake" className="mt-4 block text-[0.875rem] font-medium">Your stake</label>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <div className="flex items-center bg-bg outline outline-1 -outline-offset-1 outline-muted focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-ink">
              <input
                id="juror-stake"
                value={stake}
                onChange={(e) => setStake(e.target.value)}
                inputMode="decimal"
                autoComplete="off"
                aria-describedby="juror-minimum"
                className="w-20 bg-transparent px-3 py-2 text-[0.9375rem] tabular-nums text-ink focus:outline-none"
              />
              <span className="pr-3 text-[0.8125rem] text-muted">NEAR</span>
            </div>
            <button type="button" disabled={busy} onClick={join} className="min-h-[2.625rem] bg-ink px-4 text-[0.875rem] font-semibold text-accent-ink transition-colors duration-150 hover:bg-lit active:bg-muted disabled:cursor-wait disabled:bg-muted">
              {busy ? "Waiting for your wallet…" : "Join the jury"}
            </button>
          </div>
          <p id="juror-minimum" className="mt-2 text-[0.8125rem] text-muted">At least {formatNear(config.juror_stake)} NEAR, plus a {formatNear(config.juror_fee)} NEAR storage fee that isn&apos;t refunded.</p>
        </>
      )}
      {error && <p role="alert" className="mt-2 text-[0.875rem] font-medium">{error}</p>}
    </section>
  );
}

export function JuryBoard({ initialJurors, initialClaims, config, serverNow }: { initialJurors: Juror[]; initialClaims: Claim[]; config: Config; serverNow: number }) {
  const { accountId } = useWallet();
  const [jurors, setJurors] = useState(initialJurors);
  const [claims, setClaims] = useState(initialClaims);
  const now = useNow(serverNow);

  const refresh = useCallback(async () => {
    const [nextJurors, nextClaims] = await Promise.all([view<Juror[]>("get_jurors", { limit: 100 }), latestClaims()]).catch(() => [null, null] as const);
    if (nextJurors) setJurors(nextJurors);
    if (nextClaims) setClaims(nextClaims);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 20_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const me = jurors.find((j) => j.account === accountId) ?? null;
  const appeals = claims.filter((c) => c.status === "appealed" && c.appeal);
  const yours = appeals.filter((c) => accountId && c.appeal?.jury.includes(accountId) && !c.appeal.votes.some((v) => v.juror === accountId) && nanosToMs(c.appeal.jury_until) > now);
  // Your own cases come first: they are the ones waiting on you.
  const ordered = [...yours, ...appeals.filter((c) => !yours.includes(c))];

  return (
    <>
      <h1 className="text-[1.5rem] font-bold leading-tight tracking-[-0.01em]">Jury</h1>
      <p className="mt-1 max-w-[65ch] text-[0.9375rem]">
        {yours.length
          ? `${yours.length} ${yours.length === 1 ? "case is" : "cases are"} waiting for your vote.`
          : jurors.length >= JURY_SIZE
            ? `${jurors.length} jurors are in the pool, and ${appeals.length} ${appeals.length === 1 ? "appeal is" : "appeals are"} being heard.`
            : `${jurors.length} of the ${JURY_SIZE} jurors an appeal needs have joined. Until the pool fills, the judge's rulings can't be appealed.`}
      </p>

      {jurors.some((j) => isDemoJuror(j.account)) && (
        <p className="mt-2 max-w-[65ch] text-[0.875rem] text-muted">
          The pool includes demo jurors: bots we run, so anyone can try a full appeal. They make their own calls with the TEE model and every vote is on-chain, but they aren&apos;t independent of us. A real deployment would use independent staked jurors.
        </p>
      )}

      <div className="mt-6 grid items-start gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="grid min-w-0 gap-4">
          <section aria-labelledby="appeals-title" className="bg-surface">
            <h2 id="appeals-title" className="px-4 pt-4 text-[1rem] font-semibold">Appeals being heard</h2>
            {ordered.length ? (
              <ul className="mt-2">
                {ordered.map((claim) => (
                  <li key={claim.id} className="border-t border-bg px-4 py-3 text-[0.875rem]">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                      <Link href={`/claims/${claim.id}`} className="min-w-0 break-words font-medium no-underline hover:underline" translate="no">{claim.subject}</Link>
                      {yours.includes(claim) && <Link href={`/claims/${claim.id}`} className="font-medium underline-offset-4 hover:underline">Vote</Link>}
                    </div>
                    <p className="mt-0.5 text-[0.8125rem] text-muted tabular-nums">
                      {claim.appeal?.votes.length} of {claim.appeal?.jury.length} votes in, closes {claim.appeal && formatDate(claim.appeal.jury_until)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 pb-4 pt-1 text-[0.875rem] text-muted">No appeals are being heard right now.</p>
            )}
          </section>

          <section aria-labelledby="pool-title" className="bg-surface">
            <h2 id="pool-title" className="px-4 pt-4 text-[1rem] font-semibold">The pool</h2>
            {jurors.length ? (
              <table className="mt-2 w-full table-fixed border-collapse text-[0.875rem]">
                <thead>
                  <tr className="text-[0.75rem] text-muted">
                    <th scope="col" className="px-4 py-2 text-left font-normal">Juror</th>
                    <th scope="col" className="w-20 px-4 py-2 text-right font-normal sm:w-24">Stake</th>
                    <th scope="col" className="w-16 px-4 py-2 text-right font-normal sm:w-20">Votes</th>
                    <th scope="col" className="w-28 px-4 py-2 text-right font-normal max-sm:hidden">With majority</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {jurors.map((j) => (
                    <tr key={j.account} className="border-t border-bg">
                      <td className="break-words px-4 py-2.5">
                        <span className="font-medium" translate="no">{j.account}</span>
                        {isDemoJuror(j.account) && <span className="block text-[0.75rem] text-muted">Demo juror (bot)</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right">{formatNear(j.stake)}</td>
                      <td className="px-4 py-2.5 text-right">{j.votes_cast}</td>
                      <td className="px-4 py-2.5 text-right max-sm:hidden">{j.votes_with_majority}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="px-4 pb-4 pt-1 text-[0.875rem] text-muted">Nobody has joined yet.</p>
            )}
          </section>
        </div>

        <div className="max-lg:order-first">
          <YourSeat me={me} config={config} now={now} onDone={refresh} />
        </div>
      </div>
    </>
  );
}

export function JuryBoardSkeleton() {
  return (
    <>
      <h1 className="text-[1.5rem] font-bold leading-tight tracking-[-0.01em]">Jury</h1>
      <div className="mt-2 h-5 max-w-[32rem] bg-surface" />
      <div className="mt-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="h-64 bg-surface" />
        <div className="h-48 bg-surface" />
      </div>
    </>
  );
}
