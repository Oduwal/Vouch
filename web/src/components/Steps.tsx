const steps = [
  {
    line: "First, your agent asks.",
    body: "Before it pays anyone or calls a contract, it sends Vouch the receiver's account name.",
  },
  {
    line: "Then we read the receiver.",
    body: "Account age, recent code changes, who holds the keys, reports from other agents. All from the chain.",
  },
  {
    line: "We call it. We post bond.",
    body: "Allow, warn or block, with reasons. A Vouch agent locks NEAR behind the call for 24 hours.",
  },
  {
    line: "Wrong? Bond is yours.",
    body: "Challenge with evidence. An AI judge rules while the contract waits; a staked jury hears appeals.",
  },
];

const starts = ["sm:col-start-1", "sm:col-start-3", "sm:col-start-5", "sm:col-start-7"];
const indents = ["pl-0", "pl-[6vw]", "pl-[12vw]", "pl-[18vw]"];

export function Steps() {
  return (
    <section aria-labelledby="steps-0" className="page py-[clamp(7.5rem,14vw,15rem)]">
      <ol className="grid grid-cols-1 gap-y-10 sm:grid-cols-12 sm:gap-x-6 sm:gap-y-14">
        {steps.map((s, i) => {
          const Heading = i === 0 ? "h2" : "p";
          return (
            <li key={s.line} className={`${indents[i]} sm:col-span-12 sm:pl-0 ${starts[i]} sm:col-end-13`}>
              <Heading
                id={`steps-${i}`}
                data-reveal
                className="text-[clamp(2.125rem,8.4vw,2.75rem)] font-extrabold leading-none tracking-[-0.02em] [font-stretch:90%] sm:text-[clamp(2.25rem,4.4vw,4.25rem)]"
              >
                {i === steps.length - 1 ? <span className="bg-ink px-[0.12em] text-accent-ink [box-decoration-break:clone]">{s.line}</span> : s.line}
              </Heading>
              <p data-reveal style={{ "--i": 1 } as React.CSSProperties} className="mt-3 max-w-[34ch] text-[var(--step-body)] text-ink">
                {s.body}
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
