"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Check } from "../lib/signals";
import { Ticket, sampleTickets, type TicketData } from "./Ticket";

const HOLD_MS = 7100;
const timeFormat = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

function toTicket(check: Check): TicketData {
  return {
    account: check.account,
    verdict: check.verdict,
    reasons: check.reasons,
    issuer: "Preview, not bonded yet",
    bond: "Live mainnet data",
    note: `Read ${timeFormat.format(new Date(check.checkedAt))} UTC`,
  };
}

export function Hero() {
  const [index, setIndex] = useState(0);
  const [live, setLive] = useState<TicketData | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (live || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => {
      if (!document.hidden) setIndex((i) => (i + 1) % sampleTickets.length);
    }, HOLD_MS);
    return () => window.clearInterval(id);
  }, [live]);

  const run = useCallback(async (account: string) => {
    setStatus("loading");
    setError("");
    try {
      const res = await fetch(`/api/check?account=${encodeURIComponent(account)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setLive(toTicket(body));
      setStatus("idle");
      const url = new URL(window.location.href);
      url.searchParams.set("account", account);
      window.history.replaceState(null, "", url);
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error && e.message ? e.message : "Something went wrong. Try again.");
      inputRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    const account = new URLSearchParams(window.location.search).get("account");
    if (account && inputRef.current) {
      inputRef.current.value = account;
      void run(account);
    }
  }, [run]);

  return (
    <section id="check" className="page relative flex min-h-svh flex-col pb-[8svh]">
      <header className="flex items-center justify-between py-[var(--margin)] text-[var(--step-body)]">
        <a href="#check" className="display text-[1.125rem] no-underline" translate="no">
          Vouch
        </a>
        <a href="https://github.com/Oduwal/Vouch" className="underline-offset-4 hover:underline">
          GitHub
        </a>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-[clamp(1.25rem,3svh,2rem)]">
        <div className="grid w-[70vw] max-w-[22rem] sm:w-[min(31vw,44svh)] sm:max-w-none" aria-live="polite">
          {live ? (
            <div key={live.account + live.note} className="[grid-area:1/1] animate-[print_0.6s_var(--ease-out)]">
              <Ticket data={live} lit />
            </div>
          ) : (
            sampleTickets.map((t, i) => (
              <div
                key={t.account}
                className="[grid-area:1/1] transition-opacity duration-[1600ms] ease-in-out"
                style={{ opacity: i === index ? 1 : 0 }}
                aria-hidden={i !== index}
              >
                <Ticket data={t} />
              </div>
            ))
          )}
        </div>

        <h1 className="flex w-full flex-col items-center gap-[clamp(1rem,2.4svh,1.75rem)] text-center">
          <span className="sr-only">Vouch:</span>
          <span aria-hidden="true" className="display flex w-full justify-between text-[clamp(2.25rem,6vw,5.5rem)] sm:w-[72%]">
            {"VOUCH".split("").map((c, i) => (
              <span key={i}>{c}</span>
            ))}
          </span>
          <span className="max-w-[22ch] text-balance text-[clamp(1.5rem,2.6vw,2.375rem)] font-medium leading-[1.1] tracking-[-0.01em]">
            Bonded safety checks for AI agents
          </span>
        </h1>

        <div className="flex w-full flex-col items-center gap-4 text-[0.9375rem] sm:flex-row sm:justify-center sm:gap-12">
          <p className="order-1 text-muted">Allow, warn or block</p>
          <form
            className="order-2 flex w-full max-w-[26rem] focus-within:outline-3 focus-within:outline-offset-3 focus-within:outline-ink sm:w-auto"
            onSubmit={(e) => {
              e.preventDefault();
              const account = inputRef.current?.value.trim().toLowerCase();
              if (account) void run(account);
            }}
          >
            <label htmlFor="account" className="sr-only">
              NEAR account to check
            </label>
            <input
              ref={inputRef}
              id="account"
              name="account"
              type="text"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="wrap.near…"
              className="min-w-0 flex-1 bg-surface px-4 py-3 text-ink placeholder:text-muted focus:outline-none sm:w-56"
              aria-describedby="check-error"
              aria-invalid={status === "error"}
            />
            <button
              type="submit"
              disabled={status === "loading"}
              className="bg-ink px-5 py-3 font-semibold text-accent-ink transition-colors duration-150 hover:bg-lit active:bg-muted disabled:cursor-wait"
            >
              {status === "loading" ? "Checking…" : "Print ticket"}
            </button>
          </form>
          <p className="order-3 text-muted">Reads NEAR mainnet live</p>
        </div>
        <p id="check-error" role="status" className="min-h-[1.45em] text-center text-[0.9375rem]">
          {status === "error" ? error : ""}
        </p>
      </div>
    </section>
  );
}
