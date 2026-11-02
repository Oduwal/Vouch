import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ClaimsBoard, ClaimsBoardSkeleton } from "../../components/claims/ClaimsBoard";
import { latestClaims } from "../../lib/vouch";

async function load() {
  await connection();
  return { claims: await latestClaims().catch(() => null), now: Date.now() };
}

async function Board() {
  const { claims, now } = await load();
  if (!claims) {
    return (
      <>
        <h1 className="text-[1.5rem] font-bold leading-tight tracking-[-0.01em]">Bonded calls</h1>
        <p className="mt-4 bg-surface px-4 py-3 text-[0.875rem]">
          Couldn&apos;t read the calls from NEAR testnet. <Link href="/claims" className="underline">Try again</Link>.
        </p>
      </>
    );
  }
  return <ClaimsBoard initial={claims} serverNow={now} />;
}

export default function ClaimsPage() {
  return (
    <Suspense fallback={<ClaimsBoardSkeleton />}>
      <Board />
    </Suspense>
  );
}
