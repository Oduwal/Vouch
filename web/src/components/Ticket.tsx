import type { Level, Reason } from "../lib/signals";

export type TicketData = {
  account: string;
  verdict: Level;
  // On-chain reasons are plain text, so the level is only known for a fresh check.
  reasons: (Omit<Reason, "level"> & { level?: Level })[];
  issuer: string;
  bond: string;
  note: string;
  sample?: boolean;
};

export function LevelIcon({ level, className = "" }: { level: Level; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={`size-4 shrink-0 ${className}`} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      {level === "allow" && <path d="M3 8.5 6.5 12 13 4.5" />}
      {level === "warn" && <path d="M8 3v6.5M8 12.5v.5" />}
      {level === "block" && <path d="m4 4 8 8M12 4l-8 8" />}
    </svg>
  );
}

const verdictLabel: Record<Level, string> = { allow: "Allow", warn: "Warn", block: "Block" };

export function Ticket({ data, lit = false }: { data: TicketData; lit?: boolean }) {
  const ink = lit ? "text-lit-ink" : "text-ink";
  const soft = lit ? "text-lit-muted" : "text-muted";
  const solid = lit ? "bg-lit-ink text-lit" : "bg-ink text-accent-ink";

  return (
    <article
      data-ui
      aria-label={`Bond ticket for ${data.account}: ${verdictLabel[data.verdict]}`}
      className={`flex aspect-[4/5] w-full flex-col p-[7%] ${lit ? "bg-lit" : "bg-surface"} ${ink}`}
    >
      <div className={`flex items-baseline justify-between text-[0.875rem] ${soft}`}>
        <span>Bond ticket</span>
        {data.sample && <span>Sample</span>}
      </div>

      <p className="mt-[6%] break-words text-[clamp(1.125rem,1.6vw,1.5rem)] font-medium leading-tight" translate="no">
        {data.account}
      </p>

      <p
        className={`mt-[5%] py-[4%] text-center text-[clamp(2rem,3.6vw,3.25rem)] ${
          data.verdict === "block" ? solid : data.verdict === "warn" ? `outline outline-[3px] -outline-offset-[3px] ${lit ? "outline-lit-ink" : "outline-ink"}` : ""
        }`}
      >
        <span className="display">{verdictLabel[data.verdict]}</span>
      </p>

      <ul className="mt-[6%] space-y-2 text-[0.9375rem] leading-snug">
        {data.reasons.slice(0, 3).map((r) => (
          <li key={r.text} className="flex gap-2.5">
            {r.level && <LevelIcon level={r.level} className="mt-0.5" />}
            <span>{r.text}</span>
          </li>
        ))}
      </ul>

      <dl className="mt-auto space-y-1.5 pt-5 text-[0.875rem] tabular-nums">
        {[
          ["Issued by", data.issuer],
          [data.bond, data.note],
        ].map(([k, v]) => (
          <div key={k} className="flex flex-wrap justify-between gap-x-4">
            <dt className={soft}>{k}</dt>
            <dd translate="no">{v}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

export const sampleTickets: TicketData[] = [
  {
    account: "free-airdrop-claim.near",
    verdict: "block",
    issuer: "sentinel.vouch.testnet",
    reasons: [
      { level: "block", text: "Account was created 3 hours ago" },
      { level: "block", text: "Contract code changed 41 minutes ago" },
      { level: "warn", text: "1 full-access key can redeploy the code" },
    ],
    bond: "Bond 5 NEAR",
    note: "Open to challenge 6d 23h",
    sample: true,
  },
  {
    account: "new-dex-router.near",
    verdict: "warn",
    issuer: "keeper.vouch.testnet",
    reasons: [
      { level: "warn", text: "Contract code changed this week" },
      { level: "warn", text: "2 full-access keys can redeploy the code" },
      { level: "allow", text: "Account has existed for 2 years" },
    ],
    bond: "Bond 2 NEAR",
    note: "Open to challenge 4d 11h",
    sample: true,
  },
  {
    account: "wrap.near",
    verdict: "allow",
    issuer: "sentinel.vouch.testnet",
    reasons: [
      { level: "allow", text: "Account has existed for 5 years" },
      { level: "allow", text: "Contract is locked: no key can change its code" },
      { level: "allow", text: "Code last changed April 2021" },
    ],
    bond: "Bond 1 NEAR",
    note: "Open to challenge 2d 05h",
    sample: true,
  },
];
