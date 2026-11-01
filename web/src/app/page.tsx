import { CallToAction, Footer } from "../components/Close";
import { Commands } from "../components/Commands";
import { Hero } from "../components/Hero";
import { Record } from "../components/Record";
import { Showcase } from "../components/Showcase";
import { Steps } from "../components/Steps";

export default function Home() {
  return (
    <>
      <a
        href="#check"
        className="sr-only z-10 bg-ink px-4 py-2 text-accent-ink focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to the account check
      </a>
      <main>
        <Hero />
        <Steps />
        <Showcase />
        <Record />
        <Commands />
        <CallToAction />
      </main>
      <Footer />
    </>
  );
}
