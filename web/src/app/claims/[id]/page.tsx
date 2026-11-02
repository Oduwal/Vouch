import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ClaimDetail, ClaimDetailSkeleton } from "../../../components/claims/ClaimDetail";
import { view, type Agent, type Claim, type Config, type Juror } from "../../../lib/vouch";

function Missing({ id }: { id: string }) {
  return (
    <>
      <h1 className="text-[1.5rem] font-bold leading-tight tracking-[-0.01em]">No claim {id}</h1>
      <p className="mt-2 text-[0.9375rem]">
        The contract has no claim with that number. <Link href="/claims" className="underline">See all bonded calls</Link>.
      </p>
    </>
  );
}

async function loadPeople(account: string) {
  const [agent, jurors] = await Promise.all([
    view<Agent | null>("get_agent", { account }).catch(() => null),
    view<Juror[]>("get_jurors", { limit: 100 }).catch(() => null),
  ]);
  return { agent, jurors, now: Date.now() };
}

async function Loaded({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) return <Missing id={id.slice(0, 20)} />;

  const [claim, config] = await Promise.all([
    view<Claim | null>("get_claim", { claim_id: id }),
    view<Config>("get_config"),
  ]).catch(() => [undefined, undefined] as const);

  if (claim === undefined || !config) {
    return (
      <>
        <h1 className="text-[1.5rem] font-bold leading-tight tracking-[-0.01em]">Claim {id}</h1>
        <p className="mt-4 bg-surface px-4 py-3 text-[0.875rem]">
          Couldn&apos;t read this claim from NEAR testnet. <Link href={`/claims/${id}`} className="underline">Try again</Link>.
        </p>
      </>
    );
  }
  if (!claim) return <Missing id={id} />;

  const { agent, jurors, now } = await loadPeople(claim.agent);
  return <ClaimDetail initial={claim} config={config} agent={agent} jurors={jurors} serverNow={now} />;
}

export default function ClaimPage({ params }: PageProps<"/claims/[id]">) {
  return (
    <Suspense fallback={<ClaimDetailSkeleton />}>
      <Loaded params={params} />
    </Suspense>
  );
}
