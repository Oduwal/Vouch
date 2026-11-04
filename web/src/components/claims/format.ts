import { useEffect, useState } from "react";
import { nanosToMs, phaseOf, type Claim } from "../../lib/vouch";

// A fixed locale and zone, so the server and the browser print the same text.
const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});
const clockFormat = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

export const formatDate = (ns: string) => `${dateFormat.format(new Date(nanosToMs(ns)))} UTC`;
export const formatClock = (ms: number) => `${clockFormat.format(new Date(ms))} UTC`;

export function timeLeft(ms: number) {
  if (ms < 60_000) return "under a minute";
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function statusLine(claim: Claim, now: number) {
  switch (phaseOf(claim, now)) {
    case "open":
      return `${timeLeft(nanosToMs(claim.challenge_until) - now)} left to challenge`;
    case "window-closed":
      return "Window closed, bond returning";
    case "held":
      return "Held";
    case "overturned":
      return "Overturned";
    case "void":
      return "Void, both sides refunded";
    default:
      if (claim.status === "challenged") return "Judge deciding";
      if (claim.status === "appealed") return claim.ruling ? "Jury hearing the appeal" : "Jury hearing the case";
      return claim.ruling?.winner === "agent" ? "Ruled for the agent" : "Ruled for the challenger";
  }
}

// Starts from the server's clock so the first client render matches the server's HTML.
export function useNow(serverNow: number, everyMs = 30_000) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return now;
}
