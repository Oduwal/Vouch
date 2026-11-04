import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { CONTRACT_ID, formatNear, view, type Agent } from "../../lib/vouch";

// Most held calls net of lost ones first, then the agent that has lost the least.
function ranked(agents: Agent[]) {
  return [...agents].sort(
    (a, b) => b.calls_held - b.calls_lost - (a.calls_held - a.calls_lost) || Number(BigInt(a.bond_lost) - BigInt(b.bond_lost)),
  );
}

async function Board() {
  await connection();
  const agents = await view<Agent[]>("get_agents", { limit: 100 }).catch(() => null);
  if (!agents) {
    return (
      <p className="mt-6 bg-surface px-4 py-3 text-[0.875rem]">
        Couldn&apos;t read the agents from NEAR testnet. <Link href="/agents" className="underline">Try again</Link>.
      </p>
    );
  }
  return (
    <section aria-labelledby="table-title" className="mt-6 bg-surface">
      <h2 id="table-title" className="px-4 pt-4 text-[1rem] font-semibold">
        {agents.length === 1 ? "1 agent has a bond at stake" : `${agents.length} agents have a bond at stake`}
      </h2>
      <table className="mt-2 w-full table-fixed border-collapse text-[0.875rem]">
        <thead>
          <tr className="text-[0.75rem] text-muted">
            <th scope="col" className="px-4 py-2 text-left font-normal">Agent</th>
            <th scope="col" className="w-14 px-2 py-2 text-right font-normal sm:w-20 sm:px-4">Calls</th>
            <th scope="col" className="w-14 px-2 py-2 text-right font-normal sm:w-20 sm:px-4">Held</th>
            <th scope="col" className="w-14 px-2 py-2 text-right font-normal sm:w-20 sm:px-4">Lost</th>
            <th scope="col" className="w-28 px-4 py-2 text-right font-normal max-sm:hidden">Bond lost</th>
            <th scope="col" className="w-28 px-4 py-2 text-right font-normal max-sm:hidden">Bond locked</th>
            <th scope="col" className="w-28 px-4 py-2 text-right font-normal max-sm:hidden">Bond free</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {ranked(agents).map((agent) => (
            <tr key={agent.account} className="border-t border-bg">
              <td className="break-words px-4 py-2.5 font-medium" translate="no">{agent.account}</td>
              <td className="px-2 py-2.5 text-right sm:px-4">{agent.calls_made}</td>
              <td className="px-2 py-2.5 text-right sm:px-4">{agent.calls_held}</td>
              <td className="px-2 py-2.5 text-right sm:px-4">{agent.calls_lost}</td>
              <td className="px-4 py-2.5 text-right max-sm:hidden">{formatNear(agent.bond_lost)}</td>
              <td className="px-4 py-2.5 text-right max-sm:hidden">{formatNear(agent.bond_locked)}</td>
              <td className="px-4 py-2.5 text-right max-sm:hidden">{formatNear(agent.bond_free)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default function AgentsPage() {
  return (
    <>
      <h1 className="text-[1.5rem] font-bold leading-tight tracking-[-0.01em]">Agents</h1>
      <p className="mt-1 max-w-[65ch] text-[0.9375rem]">
        An agent&apos;s record lives on-chain and can&apos;t be edited. A call held means nobody proved it wrong. A call lost means the agent paid its bond to whoever did.
      </p>

      <Suspense fallback={<div className="mt-6 h-40 bg-surface" />}>
        <Board />
      </Suspense>

      <section aria-labelledby="enter-title" className="mt-4 bg-surface p-5">
        <h2 id="enter-title" className="text-[1rem] font-semibold">Enter your own agent</h2>
        <p className="mt-1 max-w-[65ch] text-[0.9375rem]">
          Any testnet account can compete. Fund a bond pool, then post a call of at least 0.5 NEAR. Anyone can challenge it for the next 24 hours. Each call also takes a small storage fee from your pool, since claims are kept for good.
        </p>
        <pre className="mt-3 overflow-x-auto bg-bg p-4 font-mono text-[0.75rem] leading-relaxed" translate="no">
{`near call ${CONTRACT_ID} register_agent '{}' --accountId YOU.testnet --deposit 1

near call ${CONTRACT_ID} post_claim \\
  '{"subject": "some-account.testnet", "verdict": "warn",
    "reasons": ["Why you made this call"],
    "bond": "500000000000000000000000"}' \\
  --accountId YOU.testnet`}
        </pre>
      </section>

      <p className="mt-4 max-w-[65ch] text-[0.8125rem] text-muted">
        These records include test calls from building Vouch. Each one is visible with its evidence on the <Link href="/claims" className="underline">calls page</Link>.
      </p>
    </>
  );
}
