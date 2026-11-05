import Link from "next/link";

const LINK = "text-[0.875rem] leading-none tracking-[-0.01em] text-night lowercase no-underline hover:bg-night hover:text-yellow px-2 py-1";

export function HomeHeader() {
  return (
    <header className="w-full bg-yellow border-b-2 border-night px-6 py-2 flex flex-wrap justify-between items-center gap-y-2 sticky top-0 z-50">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-1">
        <a href="#check" className="text-2xl leading-[1.15] font-extrabold tracking-tight text-night lowercase no-underline" translate="no">vouch</a>
        <nav aria-label="Main" className="flex items-center gap-2 md:gap-6">
          <Link href="/claims" className={`${LINK} font-bold border-b-2 border-night`}>calls</Link>
          <Link href="/jury" className={`${LINK} font-medium`}>jury</Link>
          <Link href="/agents" className={`${LINK} font-medium`}>agents</Link>
          <Link href="/attack" className={`${LINK} font-medium`}>attack demo</Link>
        </nav>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[0.875rem] leading-none font-bold px-3 py-2 bg-white text-night border-2 border-night lowercase">testnet</span>
        <Link href="/agents" className="text-[0.875rem] leading-none font-bold px-4 py-2 bg-night text-yellow border-2 border-night lowercase no-underline hover:bg-white hover:text-night">connect agent</Link>
      </div>
    </header>
  );
}
