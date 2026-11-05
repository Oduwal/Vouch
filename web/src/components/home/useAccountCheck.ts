"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Check, Level } from "../../lib/signals";
import type { TicketData } from "../Ticket";

const timeFormat = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
// A ticket's reasons start with the ones that drove the verdict.
const RANK: Record<Level, number> = { block: 0, warn: 1, allow: 2 };

function toTicket(check: Check): TicketData {
  return {
    account: check.account,
    verdict: check.verdict,
    reasons: [...check.reasons].sort((a, b) => RANK[a.level] - RANK[b.level]).slice(0, 4),
    bond: "not bonded yet",
    note: `live ${check.network} data, read ${timeFormat.format(new Date(check.checkedAt))} UTC`,
  };
}

// The home page keeps a desktop and a phone layout in the document, so a link with ?account= runs
// only the form that's on screen. `fromUrl` is off for a form lower down the same layout.
export function useAccountCheck({ fromUrl = true }: { fromUrl?: boolean } = {}) {
  const [live, setLive] = useState<TicketData | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

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
    if (!fromUrl) return;
    const account = new URLSearchParams(window.location.search).get("account");
    const input = inputRef.current;
    if (account && input && input.offsetParent !== null) {
      input.value = account;
      void run(account);
    }
  }, [fromUrl, run]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const account = inputRef.current?.value.trim().toLowerCase();
    if (account) void run(account);
  };

  return { live, status, error, inputRef, submit };
}
