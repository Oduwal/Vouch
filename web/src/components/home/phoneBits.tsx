import type { TicketData } from "../Ticket";

// Shared by the server and client parts of the phone layout, so this file has no client directive.

export const MONO = "font-[family-name:var(--font-jetbrains)]";

export function Icon({ d, className = "size-5" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 -960 960 960" aria-hidden="true" fill="currentColor" className={`shrink-0 ${className}`}>
      <path d={d} />
    </svg>
  );
}

export const ICONS = {
  person: "M367-527q-47-47-47-113t47-113q47-47 113-47t113 47q47 47 47 113t-47 113q-47 47-113 47t-113-47ZM160-160v-112q0-34 17.5-62.5T224-378q62-31 126-46.5T480-440q66 0 130 15.5T736-378q29 15 46.5 43.5T800-272v112H160Zm80-80h480v-32q0-11-5.5-20T700-306q-54-27-109-40.5T480-360q-56 0-111 13.5T260-306q-9 5-14.5 14t-5.5 20v32Zm296.5-343.5Q560-607 560-640t-23.5-56.5Q513-720 480-720t-56.5 23.5Q400-673 400-640t23.5 56.5Q447-560 480-560t56.5-23.5ZM480-640Zm0 400Z",
  terminal: "M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160Zm0-80h640v-400H160v400Zm140-40-56-56 103-104-104-104 57-56 160 160-160 160Zm180 0v-80h240v80H480Z",
  forward: "M647-440H160v-80h487L423-744l57-56 320 320-320 320-57-56 224-224Z",
  south: "M480-80 200-360l56-56 184 183v-647h80v647l184-184 56 57L480-80Z",
  verified: "m344-60-76-128-144-32 14-148-98-112 98-112-14-148 144-32 76-128 136 58 136-58 76 128 144 32-14 148 98 112-98 112 14 148-144 32-76 128-136-58-136 58Zm34-102 102-44 104 44 56-96 110-26-10-112 74-84-74-86 10-112-110-24-58-96-102 44-104-44-56 96-110 24 10 112-74 86 74 84-10 114 110 24 58 96Zm102-318Zm-42 142 226-226-56-58-170 170-86-84-56 56 142 142Z",
  gavel: "M160-120v-80h480v80H160Zm226-194L160-540l84-86 228 226-86 86Zm254-254L414-796l86-84 226 226-86 86Zm184 408L302-682l56-56 522 522-56 56Z",
  play: "M320-200v-560l440 280-440 280Zm80-280Zm0 134 210-134-210-134v268Z",
  toll: "M373-253q-93-93-93-227t93-227q93-93 227-93t227 93q93 93 93 227t-93 227q-93 93-227 93t-227-93Zm-93 83q-106-28-173-114T40-480q0-110 67-196t173-114v84q-72 25-116 87t-44 139q0 77 44 139t116 87v84Zm320-310Zm170 170q70-70 70-170t-70-170q-70-70-170-70t-170 70q-70 70-70 170t70 170q70 70 170 70t170-70Z",
  balance: "M80-120v-80h360v-447q-26-9-45-28t-28-45H240l120 280q0 50-41 85t-99 35q-58 0-99-35t-41-85l120-280h-80v-80h247q12-35 43-57.5t70-22.5q39 0 70 22.5t43 57.5h247v80h-80l120 280q0 50-41 85t-99 35q-58 0-99-35t-41-85l120-280H593q-9 26-28 45t-45 28v447h360v80H80Zm585-320h150l-75-174-75 174Zm-520 0h150l-75-174-75 174Zm335-280q17 0 28.5-11.5T520-760q0-17-11.5-28.5T480-800q-17 0-28.5 11.5T440-760q0 17 11.5 28.5T480-720Z",
  robot: "M160-360q-50 0-85-35t-35-85q0-50 35-85t85-35v-80q0-33 23.5-56.5T240-760h120q0-50 35-85t85-35q50 0 85 35t35 85h120q33 0 56.5 23.5T800-680v80q50 0 85 35t35 85q0 50-35 85t-85 35v160q0 33-23.5 56.5T720-120H240q-33 0-56.5-23.5T160-200v-160Zm242.5-97.5Q420-475 420-500t-17.5-42.5Q385-560 360-560t-42.5 17.5Q300-525 300-500t17.5 42.5Q335-440 360-440t42.5-17.5Zm240 0Q660-475 660-500t-17.5-42.5Q625-560 600-560t-42.5 17.5Q540-525 540-500t17.5 42.5Q575-440 600-440t42.5-17.5ZM320-280h320v-80H320v80Zm-80 80h480v-480H240v480Zm240-240Z",
  shield: "M480-80q-139-35-229.5-159.5T160-516v-244l320-120 320 120v244q0 152-90.5 276.5T480-80Zm0-84q97-30 162-118.5T718-480H480v-315l-240 90v207q0 7 2 18h238v316Z",
};

export function PhoneTicket({ data, lead, children }: { data: TicketData; lead?: string; children?: React.ReactNode }) {
  return (
    <article aria-label={`Bond ticket for ${data.account}: ${data.verdict}`} className="flex flex-col bg-black text-white p-5 text-left">
      <div className="flex items-center justify-between gap-2 mb-4">
        <span className={`${MONO} px-2 py-0.5 bg-white text-black text-xs uppercase font-extrabold`}>{data.verdict}</span>
        <span className={`${MONO} px-2 py-0.5 bg-yellow text-[#231b00] text-xs font-bold lowercase`}>{data.bond}</span>
      </div>
      <div className="mb-3">
        <div className={`${MONO} text-[11px] uppercase tracking-wider text-[#c4c7c7] font-medium`}>target account</div>
        <div className={`${MONO} text-sm font-bold text-yellow [overflow-wrap:anywhere]`} translate="no">{data.account}</div>
      </div>
      <ul className="p-3 bg-[#e4e2dc] text-black mb-4 text-[0.875rem] leading-[1.4] font-medium lowercase space-y-1.5">
        {data.reasons.map((r, i) => (
          <li key={r.text}>
            {i === 0 && lead && <span className="font-bold">{lead} </span>}
            {r.text}
          </li>
        ))}
      </ul>
      {data.note && <p className={`${MONO} text-[11px] text-[#c8c6c5] lowercase`}>{data.note}</p>}
      {children}
    </article>
  );
}
