import type { Level, Reason } from "../lib/signals";

export type TicketData = {
  account: string;
  verdict: Level;
  // On-chain reasons are plain text, so the level is only known for a fresh check.
  reasons: (Omit<Reason, "level"> & { level?: Level })[];
  bond: string;
  issuer?: string;
  note?: string;
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

const LABEL = "text-xs font-bold text-[#444748] lowercase mb-1";

export function Ticket({ data }: { data: TicketData }) {
  return (
    <article aria-label={`Bond ticket for ${data.account}: ${data.verdict}`} className="bg-white text-night p-8 border-2 border-night">
      <div className="flex flex-wrap justify-between items-start gap-3 mb-6 pb-4 border-b-2 border-night">
        <span className="text-4xl lg:text-6xl font-black lowercase tracking-tight leading-none">{data.verdict}</span>
        <span className="bg-yellow text-night font-bold text-sm px-3 py-1 border-2 border-night lowercase">{data.bond}</span>
      </div>
      <div className="space-y-4">
        <div>
          <div className={LABEL}>target account</div>
          <div className="font-bold text-lg lowercase [overflow-wrap:anywhere]" translate="no">{data.account}</div>
        </div>
        <div>
          <div className={LABEL}>reasoning</div>
          <ul className="space-y-2">
            {data.reasons.map((r) => (
              <li key={r.text} className="flex gap-2 font-medium lowercase text-base">
                {r.level && <LevelIcon level={r.level} className="mt-1" />}
                <span>{r.text}</span>
              </li>
            ))}
          </ul>
        </div>
        {data.issuer && (
          <div>
            <div className={LABEL}>issued by</div>
            <div className="font-medium lowercase [overflow-wrap:anywhere]" translate="no">{data.issuer}</div>
          </div>
        )}
        {data.note && <p className="text-sm font-bold lowercase">{data.note}</p>}
      </div>
    </article>
  );
}
