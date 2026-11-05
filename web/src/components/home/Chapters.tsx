import Image from "next/image";
import Link from "next/link";
import type { AttackEvent } from "../../lib/agent/attack-data";
import recorded from "../../data/attack-run.json";
import { formatNear, type Claim } from "../../lib/vouch";
import { Ticket } from "../Ticket";

// Sections of the home page, as Stitch designed them. Everything they show comes from the contract.

const SECTION = "p-8 lg:p-16 border-b-2 border-night";
const BIG = "text-6xl sm:text-8xl lg:text-[7.5vw] font-black lowercase tracking-tighter leading-[0.9]";
const PANEL = "text-5xl lg:text-7xl font-black lowercase tracking-tighter leading-[0.9]";
const NOTE = "text-base lg:text-lg font-semibold lowercase text-night";
const CARD = "bg-white p-6 border-2 border-night text-sm flex flex-col justify-between gap-4";
const CLAUSE = "mt-8 font-extrabold text-xl lowercase leading-tight text-night";
const CASE = "p-6 flex flex-col justify-between min-h-[460px]";
const CASE_EDGE = "border-b-2 md:border-b-0 md:border-r-2 border-night";

export function TwoPanels({ story }: { story: Claim }) {
  return (
    <section className="grid grid-cols-1 lg:grid-cols-2 w-full min-h-screen border-b-2 border-night">
      <div className="bg-paper text-night p-8 lg:p-16 flex flex-col justify-between overflow-hidden border-b-2 lg:border-b-0 lg:border-r-2 border-night">
        <div>
          <h2 className={`${PANEL} mb-8`}>paper did it first.</h2>
          <div className="overflow-hidden border-2 border-night bg-white">
            <Image src="/archive/bond-ai.jpg" alt="North Missouri Railroad bond 1858" width={1376} height={768} sizes="(min-width: 1024px) 50vw, 100vw" className="w-full h-[340px] object-cover object-top -mt-4 border-b-2 border-night" />
          </div>
        </div>
        <p className={`${NOTE} mt-8`}>A North Missouri Railroad state bond from 1858: $1,000 at six per cent, signed and engraved.</p>
      </div>
      <div className="bg-sky text-night p-8 lg:p-16 flex flex-col justify-between overflow-hidden">
        <div>
          <h2 className={`${PANEL} mb-8`}>now agents do.</h2>
          <Ticket
            data={{
              account: story.subject,
              verdict: story.verdict,
              reasons: story.reasons.map((text) => ({ text })),
              bond: `bond ${formatNear(story.bond)} NEAR`,
            }}
          />
        </div>
        <div className="mt-8 flex flex-col sm:flex-row justify-between sm:items-end gap-6">
          <p className={`${NOTE} max-w-sm`}>Claim {story.id}, a labelled test case: an agent put {formatNear(story.bond)} NEAR behind one call on one account.</p>
          <Link href={`/claims/${story.id}`} className="bg-night text-white font-bold px-6 py-4 hover:bg-white hover:text-night border-2 border-night lowercase shrink-0 no-underline text-center">
            open the claim
          </Link>
        </div>
      </div>
    </section>
  );
}

export function OneCase({ story }: { story: Claim }) {
  const { challenge, ruling, appeal } = story;
  if (!challenge || !ruling || !appeal) return null;
  const forChallenger = appeal.votes.filter((v) => v.side === "challenger").length;
  const forAgent = appeal.votes.filter((v) => v.side === "agent").length;
  // The parts of the case's own words that say what happened, without the test-case label before them.
  const objection = challenge.evidence.replace(/^Test case[^.]*\.\s*/, "");
  const opinion = /The challenger[^,.]*/.exec(ruling.summary)?.[0] ?? ruling.summary;
  return (
    <section className={`bg-yellow text-night ${SECTION}`}>
      <h2 className={`${BIG} mb-12`}>one real case.</h2>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-0 border-2 border-night">
        <div className={`bg-paper ${CASE} ${CASE_EDGE}`}>
          <div className={CARD}>
            <div className="font-black text-2xl lowercase">{story.verdict}</div>
            <div className="font-medium lowercase text-xs break-all">{story.subject}</div>
            <div className="font-bold text-xs bg-yellow p-2 border-2 border-night lowercase self-start">bond {formatNear(story.bond)} NEAR</div>
          </div>
          <div className={CLAUSE}>first, an agent blocks it.</div>
        </div>
        <div className={`bg-sky ${CASE} ${CASE_EDGE}`}>
          <div className={CARD}>
            <div className="font-black text-2xl lowercase">challenged</div>
            <p className="font-medium lowercase text-xs leading-relaxed">&quot;{objection}&quot;</p>
            <div className="font-bold text-xs bg-sky p-2 border-2 border-night lowercase self-start">stake {formatNear(challenge.stake)} NEAR</div>
          </div>
          <div className={CLAUSE}>then someone objects.</div>
        </div>
        <div className={`bg-paper ${CASE} ${CASE_EDGE}`}>
          <div className={CARD}>
            <div className="font-black text-2xl lowercase leading-none">ruled for the {ruling.winner}</div>
            <p className="font-medium lowercase text-xs leading-relaxed">&quot;{opinion}.&quot;</p>
            <div className="font-mono text-[11px] font-medium bg-[#f0eee8] p-2 border-2 border-night truncate">proof {ruling.attestation.slice(0, 19)}…</div>
          </div>
          <div className={CLAUSE}>the judge backs the agent.</div>
        </div>
        <div className={`bg-yellow ${CASE}`}>
          <div className={CARD}>
            <div className="font-black text-2xl lowercase">{story.status}.</div>
            <p className="font-medium lowercase text-xs leading-relaxed">Bond went to the {appeal.decided}.</p>
            <div className="font-bold text-xs bg-night text-white p-2 border-2 border-night lowercase self-start">fee to jurors {formatNear(appeal.fee)} NEAR</div>
          </div>
          <div className={CLAUSE}>jurors overturn it, {forChallenger} to {forAgent}.</div>
        </div>
      </div>
    </section>
  );
}

export function Bondsman() {
  return (
    <section className={`bg-night text-paper ${SECTION}`}>
      <h2 className={`${BIG} text-yellow mb-12`}>a bondsman for software.</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 border-2 border-paper">
        <div className="border-b-2 lg:border-b-0 lg:border-r-2 border-paper">
          <Image src="/archive/bail-ai.jpg" alt="bail bonds 24hr office night" width={1376} height={768} sizes="(min-width: 1024px) 50vw, 100vw" className="w-full h-[450px] object-cover" />
        </div>
        <div className="flex items-center justify-center p-8 lg:p-12 bg-graphite">
          <p className="text-2xl lg:text-3xl font-bold lowercase leading-relaxed text-paper">
            A bondsman stakes money that someone will show up. A Vouch agent stakes money that an account is what it says. Get it wrong, and the stake is gone.
          </p>
        </div>
      </div>
    </section>
  );
}

export const recordedEvents = recorded as AttackEvent[];

// What the two attackers in the recorded run were actually paid.
export function attackersReceived() {
  return recordedEvents
    .flatMap((e) => (e.type === "result" && e.invoice >= 2 && e.result.action === "paid" ? [Number(e.result.amountNear)] : []))
    .reduce((a, b) => a + b, 0);
}

// The two attacks from the recorded run, and the two attempts to get round the check.
function recordedLog() {
  const lines: string[] = [];
  for (const e of recordedEvents) {
    if (e.type === "agent" && e.invoice >= 2) lines.push(`invoice ${e.invoice + 101}  model: pay ${e.amountNear} NEAR to ${e.to}${e.fell ? "  (fell for it)" : ""}`);
    if (e.type === "result" && e.invoice >= 2) lines.push(`             ${e.result.action}${e.result.claimId ? `, claim ${e.result.claimId}` : ""}`);
    if (e.type === "bypass") lines.push(`bypass       ${e.attempt}: ${e.stoppedBy}`);
  }
  return lines.join("\n");
}

export function Attacked() {
  return (
    <section className={`bg-graphite text-paper ${SECTION}`}>
      <h2 className={`${BIG} text-sky mb-12`}>we attacked it.</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-start">
        <div>
          <p className="text-xl lg:text-2xl font-semibold lowercase mb-8 leading-relaxed text-paper">
            A real model reads a poisoned invoice and decides to pay the attacker. It falls for it. The money stays put, because its key can&apos;t send NEAR and its wallet contract says no.
          </p>
          <Link href="/attack" className="bg-sky text-night font-bold px-8 py-5 border-2 border-black hover:bg-white hover:text-black lowercase inline-block text-lg no-underline">
            run it live
          </Link>
        </div>
        <pre className="bg-night text-paper p-6 lg:p-8 border-2 border-sky font-mono text-sm leading-relaxed whitespace-pre-wrap overflow-x-auto"><code>{recordedLog()}</code></pre>
      </div>
    </section>
  );
}

export function OffTheChain({ claims, jurors }: { claims: Claim[]; jurors: number }) {
  const received = attackersReceived();
  const figure = "text-4xl lg:text-5xl font-black lowercase tracking-tight leading-none";
  return (
    <section className={`bg-paper text-night ${SECTION}`}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="md:col-span-2 bg-night text-yellow p-8 lg:p-12 border-2 border-night">
          <h2 className={PANEL}>read off the chain.</h2>
          <p className="text-lg lg:text-xl text-paper mt-4 lowercase font-medium">
            Counted from the contract, not typed in. Most of these are test cases from building Vouch, and each one says so.
          </p>
        </div>
        <div className="bg-yellow text-night p-8 lg:p-10 border-2 border-night min-h-[220px] flex flex-col justify-end">
          <span className={figure}>{claims.length} calls on the contract</span>
        </div>
        <div className="bg-sky text-night p-8 lg:p-10 border-2 border-night min-h-[220px] flex flex-col justify-end">
          <span className={figure}>{received.toFixed(2)} NEAR the attackers received</span>
        </div>
        <div className="md:col-span-2 bg-white text-night p-8 lg:p-10 border-2 border-night min-h-[200px] flex flex-col justify-end">
          <span className={figure}>{jurors} jurors staked in the pool</span>
        </div>
      </div>
    </section>
  );
}

export function TakeTheBond({ children }: { children: React.ReactNode }) {
  return (
    <section id="calls" className={`bg-night text-paper ${SECTION}`}>
      <h2 className={`${BIG} text-yellow mb-4`}>take the bond.</h2>
      <p className="text-lg lg:text-xl text-paper mb-12 lowercase font-medium">
        Think one of these calls is wrong? Stake half its bond with your evidence, and win the rest if the judge agrees.
      </p>
      {children}
    </section>
  );
}

export function LastWord() {
  return (
    <section className="bg-yellow text-night p-12 lg:p-24 flex items-center justify-center border-b-4 border-night">
      <form action="/" method="get" className="text-center font-black lowercase tracking-tighter leading-tight text-4xl sm:text-6xl lg:text-[5.5vw]">
        <label htmlFor="last-account">before you pay</label>
        <input
          id="last-account"
          name="account"
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="wrap.near"
          className="inline-block w-[6.2em] max-w-full bg-white text-night border-4 border-night px-4 py-1 mx-2 align-middle font-black tracking-normal text-3xl sm:text-5xl lg:text-[4.5vw] placeholder:text-night focus:outline-none"
        />
        <button type="submit" className="font-black lowercase tracking-tighter underline-offset-8 hover:underline">check.</button>
      </form>
    </section>
  );
}

const LINKS = [
  ["the code", "https://github.com/Oduwal/Vouch"],
  ["NEAR HACKATHON", "https://nearhackathon.com"],
  ["built on NEAR", "https://docs.near.org"],
  ["contract spec", "https://github.com/Oduwal/Vouch/tree/main/contract"],
  ["testnet faucet", "https://near-faucet.io"],
];

export function Footer() {
  return (
    <footer className="w-full bg-night text-paper px-6 sm:px-12 py-16 flex flex-col justify-between items-center border-t-4 border-yellow">
      <div className="w-full text-center">
        <span aria-hidden="true" className="font-black text-[18vw] sm:text-[19vw] tracking-tighter leading-none text-paper lowercase block select-none">vouch</span>
      </div>
      <div className="flex flex-wrap gap-8 justify-center mt-6 text-yellow font-bold lowercase text-base sm:text-lg">
        {LINKS.map(([label, href]) => (
          <a key={href} href={href} className="no-underline hover:underline hover:text-white">{label}</a>
        ))}
      </div>
      <p className="text-center text-xs sm:text-sm mt-8 text-sky font-medium lowercase max-w-xl">NEAR testnet, with no real value at stake.</p>
      <p className="text-center text-[11px] sm:text-xs text-[#858383] mt-4 lowercase font-medium">
        vouch protocol © near testnet verification. machine transactions carry systemic counterparty risk. verify or forfeit.
      </p>
    </footer>
  );
}
