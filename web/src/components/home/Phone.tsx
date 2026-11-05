import Image from "next/image";
import Link from "next/link";
import { formatNear, type Claim } from "../../lib/vouch";
import { attackersReceived, recordedEvents } from "./Chapters";
import { Icon, ICONS, MONO, PhoneTicket } from "./phoneBits";
import { PhoneCheck, PhoneLastCheck, PhoneLedger } from "./PhoneLive";

// Stitch's phone layout of the home page. Its sample accounts, hashes and timers are replaced with
// what the contract says, and its red with the page's black, white and yellow.

const SECTION = "flex flex-col p-6 sm:p-8";
const EYEBROW = `${MONO} text-[11px] uppercase tracking-widest text-[#444748] font-bold mb-1`;
const H2 = "text-[1.75rem] leading-[1.1] tracking-tight font-bold lowercase text-black";
const H3 = "text-[1.5rem] leading-[1.15] tracking-[-0.02em] font-bold lowercase mb-2";
const SMALL = "text-[0.875rem] leading-[1.4] font-medium lowercase";
const STEP_LABEL = "text-[0.875rem] leading-none uppercase tracking-wider font-extrabold";
const STEP_TAG = `${MONO} px-2 py-0.5 text-[11px] uppercase font-bold`;
const STAGE_NUMBER = `${MONO} size-5 text-xs font-black flex items-center justify-center`;
const ROW = `${MONO} bg-[#f5f3ed] p-2.5 text-[11px] text-[#1b1c18] flex justify-between items-center gap-3`;
const CHOICE = "text-[0.875rem] leading-none font-bold lowercase text-black";
const STAT = "text-[2.5rem] leading-none tracking-[-0.03em] font-extrabold lowercase text-black";
const STAT_LABEL = `${MONO} text-[11px] uppercase tracking-wider font-bold mb-1`;
const NAV_ITEM = "flex-1 flex flex-col items-center justify-center min-h-11 min-w-11 no-underline";
const NAV_LABEL = "text-[11px] uppercase tracking-wider mt-0.5";

function Header() {
  return (
    <header className="fixed top-0 w-full z-50 bg-[#fbf9f3]/90 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
      <div className="h-16 px-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <a href="#phone-check" className="text-[2.5rem] tracking-tighter font-bold lowercase text-black leading-none no-underline" translate="no">vouch</a>
          <div className="flex items-center gap-1.5 px-2 py-0.5 bg-yellow text-[#231b00]">
            <span className="size-1.5 bg-black" />
            <span className={`${MONO} text-[11px] tracking-tight uppercase font-bold`}>testnet</span>
          </div>
        </div>
        <Link href="/agents" aria-label="Connect agent" className="size-8 rounded-full bg-black text-white flex items-center justify-center">
          <Icon d={ICONS.person} className="size-[18px]" />
        </Link>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section id="phone-check" className={`${SECTION} bg-yellow text-[#231b00]`}>
      <div className="flex items-center gap-2 mb-4">
        <span className="inline-block size-2.5 bg-black" />
        <span className={`${MONO} text-xs uppercase tracking-wider font-bold text-black`}>verifiable counterparty protocol</span>
      </div>
      <h1 className="text-[4rem] leading-none font-extrabold tracking-tighter lowercase text-black mb-4">
        <span className="sr-only">vouch: </span>put money<br />behind it.
      </h1>
      <p className="text-[1.25rem] leading-snug text-black max-w-sm font-semibold mb-8 lowercase">
        Vouch is a counterparty check for AI agents that pay. Every answer has a bond on it, and whoever proves it wrong takes the bond.
      </p>
      <PhoneCheck />
      <a href="#attack-section" className={`${MONO} inline-flex items-center gap-2 mt-6 text-black text-xs uppercase tracking-wider font-bold underline underline-offset-4 decoration-2`}>
        <span className="size-2 bg-black" />
        <span>watch it stop a real attack</span>
        <Icon d={ICONS.south} className="size-4" />
      </a>
    </section>
  );
}

function Ancestry({ story }: { story: Claim }) {
  return (
    <section className={`${SECTION} bg-[#f5f3ed]`}>
      <div className="mb-6">
        <div className={EYEBROW}>01 / ancestry</div>
        <h2 className={H2}>paper did it first.<br />now agents do.</h2>
      </div>
      <div className="flex flex-col bg-white mb-6">
        <div className="w-full aspect-[16/10] overflow-hidden bg-[#eae8e2]">
          <Image src="/archive/bond-ai.jpg" alt="North Missouri Railroad bond 1858" width={1376} height={768} sizes="100vw" className="size-full object-cover grayscale contrast-125" />
        </div>
        <div className="p-4 bg-[#e4e2dc] text-black">
          <p className={`${MONO} text-xs leading-normal lowercase`}>
            <span className="font-bold uppercase tracking-wider">exhibit 1858:</span> a North Missouri Railroad state bond from 1858: $1,000 at six per cent, signed and engraved.
          </p>
        </div>
      </div>
      <PhoneTicket
        data={{
          account: story.subject,
          verdict: story.verdict,
          reasons: story.reasons.map((text) => ({ text })),
          bond: `bond: ${formatNear(story.bond)} near`,
        }}
        lead={`claim #${story.id} flag:`}
      >
        <div className="flex items-center justify-between gap-3 pt-3 border-t border-white/20">
          <span className={`${MONO} text-[11px] text-[#c8c6c5] lowercase`}>a labelled test case</span>
          <Link href={`/claims/${story.id}`} className="px-3 py-1.5 bg-yellow text-black text-[0.875rem] leading-none lowercase tracking-tight font-extrabold no-underline">
            open the claim
          </Link>
        </div>
      </PhoneTicket>
    </section>
  );
}

function Stage({ n, label, tag, tagColour, title, children, row }: { n: number; label: string; tag: string; tagColour: string; title: string; children: React.ReactNode; row: [string, string] }) {
  return (
    <div className="flex flex-col bg-white p-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className={`${STAGE_NUMBER} bg-black text-yellow`}>{n}</span>
          <span className={`${STEP_LABEL} text-black`}>{label}</span>
        </div>
        <span className={`${STEP_TAG} ${tagColour}`}>{tag}</span>
      </div>
      <div className={`${H3} text-black`}>{title}</div>
      <p className={`${SMALL} text-[#444748] mb-3`}>{children}</p>
      <div className={ROW}>
        <span>{row[0]}</span>
        <span className="font-bold text-black truncate">{row[1]}</span>
      </div>
    </div>
  );
}

function OneCase({ story }: { story: Claim }) {
  const { challenge, ruling, appeal } = story;
  if (!challenge || !ruling || !appeal) return null;
  const forChallenger = appeal.votes.filter((v) => v.side === "challenger").length;
  const forAgent = appeal.votes.filter((v) => v.side === "agent").length;
  const objection = challenge.evidence.replace(/^Test case[^.]*\.\s*/, "");
  const opinion = /The challenger[^,.]*/.exec(ruling.summary)?.[0] ?? ruling.summary;
  const figure = `${MONO} text-black font-bold`;
  return (
    <section className={`${SECTION} bg-[#fbf9f3]`}>
      <div className="mb-6">
        <div className={EYEBROW}>02 / adjudication lifecycle</div>
        <h2 className={H2}>one real case.</h2>
        <p className={`${SMALL} text-[#444748] mt-1`}>claim {story.id}&apos;s four steps, read off the contract.</p>
      </div>
      <div className="flex flex-col gap-4">
        <Stage n={1} label="phase: block" tag="halted" tagColour="bg-black text-white" title="first, an agent blocks it." row={["bond on the call:", `${formatNear(story.bond)} near`]}>
          an agent puts <span className={figure}>{formatNear(story.bond)} near</span> behind a block on <span className={`${MONO} text-xs font-bold text-black [overflow-wrap:anywhere]`}>{story.subject}</span>.
        </Stage>
        <Stage n={2} label="phase: challenge" tag="in review" tagColour="bg-yellow text-[#231b00]" title="then someone objects." row={["counter-stake:", `${formatNear(challenge.stake)} near`]}>
          a challenger stakes <span className={figure}>{formatNear(challenge.stake)} near</span> and says: <span className="italic">&quot;{objection}&quot;</span>
        </Stage>
        <Stage n={3} label="phase: referee" tag="verdict" tagColour="bg-[#8fcdfe] text-[#001e30]" title="the judge backs the agent." row={["proof:", `${ruling.attestation.slice(0, 19)}…`]}>
          &quot;{opinion}.&quot;
        </Stage>
        <div className="flex flex-col bg-black text-white p-5">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <span className={`${STAGE_NUMBER} bg-yellow text-black`}>4</span>
              <span className={`${STEP_LABEL} text-yellow`}>final: verdict finalized</span>
            </div>
            <span className={`${STEP_TAG} bg-yellow text-[#231b00]`}>resolved</span>
          </div>
          <div className={`${H3} text-white`}>jurors overturn it, {forChallenger} to {forAgent}.</div>
          <p className={`${SMALL} text-[#e5e2e1] mb-4`}>
            a staked jury heard the appeal and overturned the judge. the bond went to the {appeal.decided}.
          </p>
          <div className="flex items-center justify-between gap-3 bg-[#1c1b1b] p-3">
            <span className={`${MONO} text-xs text-[#c4c7c7]`}>fee to jurors:</span>
            <span className={`${MONO} text-sm font-bold text-yellow`}>+{formatNear(appeal.fee)} near</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function Principle() {
  return (
    <section className="flex flex-col bg-[#e4e2dc] text-[#1b1c18]">
      <div className="w-full aspect-video overflow-hidden">
        <Image src="/archive/bail-ai.jpg" alt="bail bonds 24hr office night" width={1376} height={768} sizes="100vw" className="size-full object-cover" />
      </div>
      <div className="p-6 sm:p-8 flex flex-col">
        <div className={`${EYEBROW} mb-2`}>03 / principle</div>
        <h2 className={`${H2} mb-4`}>a bondsman for software.</h2>
        <p className="text-[1.25rem] leading-relaxed tracking-[-0.01em] text-black font-medium lowercase mb-6">
          A bondsman stakes money that someone will show up. A Vouch agent stakes money that an account is what it says. Get it wrong, and the stake is gone.
        </p>
        <div className="flex flex-col gap-3 bg-white p-5">
          <div className="flex items-start gap-3">
            <Icon d={ICONS.verified} className="size-6 text-black" />
            <div>
              <div className={CHOICE}>skin in every call</div>
              <p className={`${SMALL} text-[#444748] mt-0.5`}>no promise badges. every call has NEAR staked behind it.</p>
            </div>
          </div>
          <div className="flex items-start gap-3 pt-3 border-t border-[#eae8e2]">
            <Icon d={ICONS.gavel} className="size-6 text-black" />
            <div>
              <div className={CHOICE}>staked jury pool</div>
              <p className={`${SMALL} text-[#444748] mt-0.5`}>staked jurors hear appeals and earn the fee. on this testnet the jurors are bots, and the readme says so.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// The recorded run, in the design's terminal.
function RunLog() {
  const lines: { text: string; className: string; indent?: boolean; label?: string }[] = [];
  let attack = 0;
  for (const e of recordedEvents) {
    if (e.type === "agent" && e.invoice >= 2) {
      attack += 1;
      lines.push({ label: `[attack-0${attack}]`, text: `invoice ${e.invoice + 101} model: pay ${e.amountNear} NEAR to ${e.to}`, className: "text-[#c4c7c7]" });
      if (e.fell) lines.push({ text: "↳ (fell for it)", className: "text-yellow font-semibold", indent: true });
    }
    if (e.type === "result" && e.invoice >= 2) {
      lines.push({ text: `[${e.result.action}]${e.result.claimId ? ` claim ${e.result.claimId}` : ""}`, className: "text-white", indent: true });
    }
    if (e.type === "bypass") lines.push({ label: "[bypass attempt]", text: `${e.attempt}: ${e.stoppedBy}`, className: "text-[#8fcdfe]" });
  }
  return (
    <div className={`${MONO} flex flex-col bg-[#1c1b1b] p-4 text-xs mb-5 overflow-x-auto`}>
      <div className="flex items-center justify-between gap-2 pb-3 mb-3 border-b border-white/20 text-[#c4c7c7]">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-yellow" />
          <span className="size-2 rounded-full bg-white" />
          <span className="size-2 rounded-full bg-[#8fcdfe]" />
          <span className="ml-2 uppercase tracking-wider text-[10px]">recorded run</span>
        </span>
        <span className="text-[10px] text-yellow uppercase">near testnet</span>
      </div>
      <div className="space-y-2.5 leading-snug break-words">
        {lines.map((l, i) => (
          <div key={i} className={`${l.className} ${l.indent ? "pl-3" : ""}`}>
            {l.label && <span className="text-yellow font-bold uppercase">{l.label} </span>}
            {l.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function Attacked() {
  return (
    <section id="attack-section" className={`${SECTION} bg-black text-white`}>
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="size-2 bg-yellow" />
          <span className={`${MONO} text-xs uppercase tracking-widest text-yellow font-extrabold`}>adversarial proof</span>
        </div>
        <h2 className={`${H2} !text-white`}>we attacked it.</h2>
        <p className={`${SMALL} text-[#e5e2e1] mt-1`}>
          A real model reads a poisoned invoice and decides to pay the attacker. It falls for it. The money stays put, because its key can&apos;t send NEAR and its wallet contract says no.
        </p>
      </div>
      <RunLog />
      <Link href="/attack" className="w-full py-3.5 bg-yellow text-[#231b00] text-[1.125rem] leading-none uppercase tracking-wider font-extrabold flex items-center justify-center gap-2 no-underline">
        <Icon d={ICONS.play} />
        <span>run the attack live</span>
      </Link>
    </section>
  );
}

function OffTheChain({ calls, jurors }: { calls: number; jurors: number }) {
  const received = attackersReceived();
  return (
    <section className={`${SECTION} bg-[#fbf9f3]`}>
      <div className="mb-6">
        <div className={EYEBROW}>04 / on-chain state</div>
        <h2 className={H2}>read off the chain.</h2>
        <p className={`${SMALL} text-[#444748] mt-1`}>direct reads from contract vouch.testnet. most of these are test cases from building Vouch, and each one says so.</p>
      </div>
      <div className="flex flex-col gap-3">
        <div className="p-6 bg-white">
          <div className={`${STAT_LABEL} text-[#444748]`}>total calls</div>
          <div className={STAT}>{calls}</div>
          <div className={`${SMALL} text-[#444748] mt-1`}>calls made on the contract to date</div>
        </div>
        <div className="p-6 bg-yellow text-[#231b00]">
          <div className={`${STAT_LABEL} text-[#231b00]`}>recorded attack run</div>
          <div className={STAT}>{received.toFixed(2)} near</div>
          <div className={`${SMALL} !font-bold text-black mt-1`}>{received === 0 ? "the attackers received nothing" : "what the attackers received"}</div>
        </div>
        <div className="p-6 bg-white">
          <div className={`${STAT_LABEL} text-[#444748]`}>jury pool</div>
          <div className={STAT}>{jurors}</div>
          <div className={`${SMALL} text-[#444748] mt-1`}>jurors staked in the pool</div>
        </div>
      </div>
    </section>
  );
}

function Ledger({ claims, stakePct, serverNow }: { claims: Claim[]; stakePct: number; serverNow: number }) {
  return (
    <section className={`${SECTION} bg-[#f5f3ed]`}>
      <div className="mb-5">
        <div className={EYEBROW}>05 / bond ledger</div>
        <h2 className={H2}>take the bond.</h2>
        <p className={`${SMALL} text-[#444748] mt-1`}>dispute a wrong call, stake half its bond with your evidence, and win the rest if the judge agrees.</p>
      </div>
      <PhoneLedger claims={claims} stakePct={stakePct} serverNow={serverNow} />
    </section>
  );
}

const LINKS = [
  ["documentation", "https://github.com/Oduwal/Vouch"],
  ["contracts", "https://github.com/Oduwal/Vouch/tree/main/contract"],
  ["testnet rpc", "https://docs.near.org/api/rpc/providers"],
  ["jury staking", "/jury"],
];

function Closing({ activeBySubject }: { activeBySubject: Record<string, number> }) {
  return (
    <section className={`${SECTION} bg-yellow text-[#231b00]`}>
      <div className={`${MONO} text-[11px] uppercase tracking-widest text-black font-bold mb-2`}>verdict awaits</div>
      <div className="text-[1.75rem] tracking-tighter leading-none font-extrabold lowercase text-black mb-4">before you pay [wrap.near] check.</div>
      <PhoneLastCheck activeBySubject={activeBySubject} />
      <div className="pt-6 border-t-2 border-black/20 flex flex-col">
        <div aria-hidden="true" className="text-[4rem] tracking-tighter leading-none lowercase text-black font-extrabold select-none -mb-3">vouch</div>
        <div className={`${MONO} flex flex-wrap gap-x-4 gap-y-2 text-black text-xs font-bold uppercase tracking-wider mt-4`}>
          {LINKS.map(([label, href]) => <a key={label} href={href} className="underline">{label}</a>)}
        </div>
        <p className={`${MONO} mt-6 text-black/70 text-[11px] leading-relaxed lowercase`}>NEAR testnet, with no real value at stake.</p>
      </div>
    </section>
  );
}

function BottomNav() {
  const items = [
    { href: "/claims", label: "calls", icon: ICONS.toll, active: true },
    { href: "/jury", label: "jury", icon: ICONS.balance },
    { href: "/agents", label: "agents", icon: ICONS.robot },
    { href: "/attack", label: "attack", icon: ICONS.shield },
  ];
  return (
    <nav aria-label="Main" className="fixed bottom-0 w-full z-50 bg-[#fbf9f3]/90 backdrop-blur-xl shadow-[0_-1px_8px_rgba(0,0,0,0.04)] pb-[env(safe-area-inset-bottom,0px)]">
      <div className="flex items-stretch justify-around h-16">
        {items.map((item) => (
          <Link key={item.href} href={item.href} className={`${NAV_ITEM} ${item.active ? "text-black bg-yellow font-bold" : "text-[#444748]"}`}>
            <Icon d={item.icon} className="size-[22px]" />
            <span className={NAV_LABEL}>{item.label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}

export function PhoneHome({ data, story }: { data: { claims: Claim[]; jurors: number; stakePct: number; at: number; activeBySubject: Record<string, number> } | null; story?: Claim }) {
  return (
    <>
      <a href="#phone-check" className="sr-only z-[60] bg-black px-4 py-2 text-yellow focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Skip to the account check
      </a>
      <Header />
      <main className="flex flex-col relative w-full bg-[#fbf9f3] text-[#1b1c18] pt-16 pb-24">
        <Hero />
        {story && <Ancestry story={story} />}
        {story && <OneCase story={story} />}
        <Principle />
        <Attacked />
        {data ? (
          <>
            <OffTheChain calls={data.claims.length} jurors={data.jurors} />
            <Ledger claims={data.claims} stakePct={data.stakePct} serverNow={data.at} />
          </>
        ) : (
          <section className={`${SECTION} bg-[#f5f3ed]`}>
            <h2 className={H2}>the chain didn&apos;t answer.</h2>
            <p className={`${SMALL} text-[#444748] mt-1`}>NEAR testnet didn&apos;t answer just now, so this page can&apos;t show its real cases. <Link href="/claims" className="underline">Try the calls page</Link>.</p>
          </section>
        )}
        <Closing activeBySubject={data?.activeBySubject ?? {}} />
      </main>
      <BottomNav />
    </>
  );
}
