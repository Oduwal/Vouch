export function CallToAction() {
  return (
    <a
      href="#check"
      className="group relative flex min-h-[46svh] flex-col justify-end overflow-hidden bg-ink px-[var(--margin)] pb-6 text-accent-ink no-underline transition-none hover:bg-accent-ink hover:text-ink focus-visible:bg-accent-ink focus-visible:text-ink focus-visible:outline-offset-[-6px] sm:min-h-[60svh]"
    >
      <span className="absolute left-[var(--margin)] top-[var(--margin)] max-w-[24ch] text-[1.0625rem] sm:text-[1.25rem]">
        Paste any NEAR account and read its bond ticket.
      </span>
      <svg viewBox="0 0 48 48" className="absolute right-[var(--margin)] top-[var(--margin)] size-8 sm:size-12" fill="none" stroke="currentColor" strokeWidth="4" aria-hidden="true">
        <path d="M12 36 36 12M16 12h20v20" />
      </svg>
      <span className="display block whitespace-nowrap text-[22vw] leading-[0.8] tracking-[-0.03em] [font-stretch:80%] sm:text-[26vw]">Check</span>
    </a>
  );
}

const links = [
  ["GitHub", "https://github.com/Oduwal/Vouch"],
  ["NEAR HACKATHON", "https://nearhackathon.com"],
  ["Built on NEAR", "https://docs.near.org"],
];

export function Footer() {
  return (
    <footer className="relative flex flex-col gap-16 overflow-hidden bg-deep sm:min-h-svh sm:gap-0">
      <div className="page grid gap-10 pt-[clamp(5rem,10vw,8rem)] sm:grid-cols-12 sm:gap-6">
        <div className="sm:col-span-7">
          <h2 id="footer-title" className="text-[11vw] font-extrabold leading-[0.95] tracking-[-0.02em] [font-stretch:110%] sm:text-[5vw]">
            Put your agent
            <br />
            on a bond.
          </h2>
          <a
            href="https://github.com/Oduwal/Vouch"
            className="mt-8 inline-block w-full bg-ink px-6 py-3.5 text-center font-medium text-accent-ink no-underline transition-colors duration-150 hover:bg-lit sm:w-auto"
          >
            Get the code
          </a>
        </div>
        <ul className="flex flex-wrap gap-x-6 gap-y-2 text-[0.9375rem] sm:col-span-3 sm:col-start-10 sm:flex-col sm:text-[var(--step-body)]">
          {links.map(([label, href]) => (
            <li key={href}>
              <a href={href} className="underline-offset-4 hover:underline">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-auto">
        <div className="page flex flex-col gap-1 pb-2 text-[0.8125rem] text-muted sm:flex-row sm:justify-between">
          <span>Testnet project, in development. The panels above show sample data.</span>
          <span>© 2026 Vouch</span>
        </div>
        <p aria-hidden="true" className="display translate-y-[22%] whitespace-nowrap pl-[var(--margin)] text-[34vw] leading-[0.8] [font-stretch:150%] sm:text-[28vw]">
          Vouch
        </p>
      </div>
    </footer>
  );
}
