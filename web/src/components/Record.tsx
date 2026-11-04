// Real readings for wrap.near, taken from NEAR RPC and NearBlocks on 1 Nov 2026.
const groups = [
  {
    source: "NEAR RPC",
    rows: [
      ["Contract code", "Deployed, hash DL2f…Tsh1", "Any change to it is caught"],
      ["Access keys", "None", "No key can redeploy the code"],
    ],
  },
  {
    source: "NearBlocks",
    rows: [
      ["Account age", "Created 15 Feb 2021", "Accounts under 30 days old warn"],
      ["Code deploys", "2, the last on 22 Apr 2021", "A deploy this week warns; today, blocks"],
    ],
  },
  {
    source: "Vouch contract",
    rows: [["Shared blocklist", "Read with get_reports, on testnet", "A report with its bond at risk blocks. One nobody challenged needs a human"]],
  },
];

export function Record() {
  let stripe = 0;
  return (
    <section aria-labelledby="record-title" className="page py-[clamp(7.5rem,14vw,15rem)]">
      <div className="grid gap-y-6 sm:grid-cols-12 sm:gap-x-6">
        <h2
          id="record-title"
          data-reveal
          className="text-[11vw] font-extrabold leading-[0.95] tracking-[-0.02em] [font-stretch:110%] sm:col-span-7 sm:text-[5vw]"
        >
          On the
          <br />
          <span className="pl-[16.6%]">record</span>
        </h2>
        <p data-reveal style={{ "--i": 1 } as React.CSSProperties} className="max-w-[40ch] self-end sm:col-span-5">
          What one check read for wrap.near, the wrapped-NEAR contract, on 1 November 2026. Type any account at the top to read yours.
        </p>
      </div>

      <table data-reveal style={{ "--i": 2 } as React.CSSProperties} className="mt-[72px] w-full border-collapse text-[var(--step-body)]">
        <caption className="sr-only">Signals Vouch reads, with the values for wrap.near</caption>
        <thead className="sr-only sm:not-sr-only">
          <tr className="text-left text-muted">
            <th scope="col" className="w-[16%] py-3.5 pr-4 font-normal">Read from</th>
            <th scope="col" className="w-[22%] py-3.5 pr-4 font-normal">Signal</th>
            <th scope="col" className="w-[32%] py-3.5 pr-4 font-normal">wrap.near, 1 Nov 2026</th>
            <th scope="col" className="py-3.5 text-right font-normal">What it changes</th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.source} className="block border-b-[1.5em] border-transparent sm:table-row-group sm:border-b-0">
            {g.rows.map(([signal, value, effect], i) => (
              <tr key={signal} className={`block py-3.5 sm:table-row sm:py-0 ${stripe++ % 2 ? "bg-surface" : ""}`}>
                <td className="hidden py-3.5 pr-4 align-top sm:table-cell">{i === 0 ? g.source : ""}</td>
                <td className="block px-3 font-medium sm:table-cell sm:px-0 sm:py-3.5 sm:pr-4 sm:align-top">{signal}</td>
                <td className="block px-3 sm:table-cell sm:px-0 sm:py-3.5 sm:pr-4 sm:align-top" translate="no">{value}</td>
                <td className="block px-3 text-muted sm:table-cell sm:px-0 sm:py-3.5 sm:pr-3 sm:text-right sm:align-top sm:text-ink">{effect}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </section>
  );
}
