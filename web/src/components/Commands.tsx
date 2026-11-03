"use client";

import { useId, useMemo, useState } from "react";

const commands = [
  { name: "Check a receiver", key: "C", text: "Ask before paying. One call returns allow, warn or block, with the reasons." },
  { name: "Post a verdict", key: "P", text: "A Vouch agent signs the call and locks NEAR behind it for 24 hours." },
  { name: "Challenge a call", key: "X", text: "Put up a counter-stake and evidence. The bond goes to whoever is right." },
  { name: "Rule on a dispute", key: "R", text: "An AI judge rules while the contract waits. Each ruling shows whether it ran in a verified TEE." },
  { name: "Appeal to a jury", key: "A", text: "The losing side can put the ruling before a small staked human jury." },
  { name: "Scope a payment key", key: "K", text: "Your agent signs with a key that can call one contract and nothing else." },
  { name: "Read a record", key: "L", text: "See every call an agent made, held and lost, and the bond it has at stake." },
];

export function Commands() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const listId = useId();

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? commands.filter((c) => `${c.name} ${c.text}`.toLowerCase().includes(q)) : commands;
  }, [query]);

  const current = Math.min(selected, Math.max(visible.length - 1, 0));

  return (
    <section aria-labelledby="commands-title" className="page pb-[clamp(7.5rem,14vw,15rem)]">
      <h2 id="commands-title" className="sr-only">
        What Vouch does
      </h2>
      <div data-ui data-reveal className="sm:max-w-[83%]">
        <label htmlFor={`${listId}-input`} className="sr-only">
          Find a command
        </label>
        <input
          id={`${listId}-input`}
          type="search"
          autoComplete="off"
          spellCheck={false}
          placeholder="Find a command…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelected((s) => Math.min(s + 1, visible.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected((s) => Math.max(s - 1, 0));
            }
          }}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={visible.length ? `${listId}-${current}` : undefined}
          className="h-14 w-full bg-surface px-4 text-[1.25rem] text-ink placeholder:text-muted focus:outline-none focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-ink sm:h-[1.9em] sm:text-[clamp(1.75rem,3vw,2.75rem)]"
        />
      </div>

      <ul id={listId} role="listbox" aria-label="Commands" className="mt-6">
        {visible.map((c, i) => {
          const on = i === current;
          return (
            <li
              key={c.name}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={on}
              onMouseEnter={() => setSelected(i)}
              onClick={() => setSelected(i)}
              className={`cursor-default px-3 py-2 transition-colors duration-150 ${on ? "bg-ink text-accent-ink" : "text-ink"}`}
            >
              <div className="flex items-center justify-between gap-6">
                <span className="text-[8.5vw] font-extrabold leading-[1.1] tracking-[-0.02em] [font-stretch:90%] sm:text-[clamp(2.25rem,4.4vw,4.25rem)]">
                  {c.name}
                </span>
                <kbd className={`hidden size-[2.2rem] shrink-0 place-items-center font-sans text-[1rem] font-medium sm:grid ${on ? "bg-accent-ink text-ink" : "bg-surface text-ink"}`}>
                  {c.key}
                </kbd>
              </div>
              {on && <p className="max-w-[60ch] pb-2 text-[var(--step-body)]">{c.text}</p>}
            </li>
          );
        })}
        {visible.length === 0 && <li className="px-3 py-4 text-muted">Nothing matches “{query}”. Try “check” or “bond”.</li>}
      </ul>
    </section>
  );
}
