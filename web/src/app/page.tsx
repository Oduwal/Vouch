import { cacheLife } from "next/cache";
import Link from "next/link";
import { CallsList } from "../components/home/CallsList";
import { Attacked, Bondsman, Footer, LastWord, OffTheChain, OneCase, TakeTheBond, TwoPanels } from "../components/home/Chapters";
import { Hero } from "../components/home/Hero";
import { HomeHeader } from "../components/home/HomeHeader";
import { PhoneHome } from "../components/home/Phone";
import { isLive, view, type Claim, type Config, type Juror } from "../lib/vouch";

// The real case the page tells, start to finish: a full appeal that overturned the judge.
const STORY_ID = "22";
const PAGE = 100;

async function chainData() {
  "use cache";
  cacheLife("minutes");
  try {
    const count = Number(await view<string>("claims_count"));
    const pages = await Promise.all(
      Array.from({ length: Math.ceil(count / PAGE) }, (_, i) => view<Claim[]>("get_claims", { from_index: String(i * PAGE), limit: PAGE })),
    );
    const newest = pages.flat().reverse();
    const [jurors, config] = await Promise.all([view<Juror[]>("get_jurors", { limit: PAGE }), view<Config>("get_config")]);
    const activeBySubject: Record<string, number> = {};
    for (const claim of newest) {
      if (isLive(claim)) activeBySubject[claim.subject] = (activeBySubject[claim.subject] ?? 0) + 1;
    }
    return { claims: newest, jurors: jurors.length, stakePct: config.challenge_stake_pct, activeBySubject, at: Date.now() };
  } catch {
    return null;
  }
}

export default async function Home() {
  const data = await chainData();
  const story = data?.claims.find((c) => c.id === STORY_ID);
  return (
    <>
      <div className="md:hidden">
        <PhoneHome data={data} story={story} />
      </div>
      <div className="hidden md:block">
      <a href="#check" className="sr-only z-[60] bg-night px-4 py-2 text-yellow focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Skip to the account check
      </a>
      <HomeHeader />
      <main>
        <Hero />
        {data && story ? (
          <>
            <TwoPanels story={story} />
            <OneCase story={story} />
            <Bondsman />
            <Attacked />
            <OffTheChain claims={data.claims} jurors={data.jurors} />
            <TakeTheBond>
              <CallsList claims={data.claims} serverNow={data.at} />
            </TakeTheBond>
          </>
        ) : (
          <>
            <Bondsman />
            <Attacked />
            <section className="bg-paper px-8 lg:px-16 py-20 text-night">
              <h2 className="text-5xl font-black lowercase tracking-tighter">the chain didn&apos;t answer.</h2>
              <p className="mt-4">NEAR testnet didn&apos;t answer just now, so this page can&apos;t show its real cases. <Link href="/claims" className="underline">Try the calls page</Link>.</p>
            </section>
          </>
        )}
        <LastWord />
      </main>
      <Footer />
      </div>
    </>
  );
}
