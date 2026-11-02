import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { JuryBoard, JuryBoardSkeleton } from "../../components/claims/JuryBoard";
import { latestClaims, view, type Config, type Juror } from "../../lib/vouch";

async function load() {
  await connection();
  const data = await Promise.all([view<Juror[]>("get_jurors", { limit: 100 }), latestClaims(), view<Config>("get_config")]).catch(() => null);
  return { data, now: Date.now() };
}

async function Board() {
  const { data, now } = await load();
  if (!data) {
    return (
      <>
        <h1 className="text-[1.5rem] font-bold leading-tight tracking-[-0.01em]">Jury</h1>
        <p className="mt-4 bg-surface px-4 py-3 text-[0.875rem]">
          Couldn&apos;t read the jury from NEAR testnet. <Link href="/jury" className="underline">Try again</Link>.
        </p>
      </>
    );
  }
  const [jurors, claims, config] = data;
  return <JuryBoard initialJurors={jurors} initialClaims={claims} config={config} serverNow={now} />;
}

export default function JuryPage() {
  return (
    <Suspense fallback={<JuryBoardSkeleton />}>
      <Board />
    </Suspense>
  );
}
