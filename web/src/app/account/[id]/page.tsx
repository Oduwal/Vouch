import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { actionLabel, formatAmount, formatBlockTime, getAccount, getAccountTransactions, isMethodName } from "../../../lib/chain";
import { isAccountId } from "../../../lib/signals";

const heading = "text-[1.5rem] font-bold leading-tight tracking-[-0.01em]";
const NEWEST = 25;
// Enough to reach past routine calls when looking for one method, such as the judge's rulings.
const SEARCHED = 200;

function Message({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <h1 className={heading}>{title}</h1>
      <p className="mt-2 text-[0.9375rem]">{children}</p>
    </>
  );
}

async function Loaded({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ method?: string | string[] }> }) {
  await connection();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!isAccountId(id)) return <Message title="That isn't a NEAR account name">Check the link and try again.</Message>;
  const method = typeof query.method === "string" && isMethodName(query.method) ? query.method : undefined;

  let found;
  try {
    const [account, history] = await Promise.all([getAccount(id), getAccountTransactions(id, method ? SEARCHED : NEWEST, method)]);
    found = { account, history };
  } catch {
    return <Message title={id}>Couldn&apos;t read this from NEAR testnet. <Link href={`/account/${id}`} className="underline">Try again</Link>.</Message>;
  }
  const { account, history } = found;
  if (!account) return <Message title="No such account">No account by this name exists on NEAR testnet.</Message>;

  return (
    <>
      <h1 className={`${heading} break-words`} translate="no">{id}</h1>
      <p className="mt-1 text-[0.9375rem]">{account.isContract ? "A contract" : "An account with no contract"} on NEAR testnet.</p>

      <dl className="mt-6 grid gap-px bg-bg sm:grid-cols-2">
        <div className="bg-surface px-5 py-4">
          <dt className="text-[0.8125rem] text-muted">Balance</dt>
          <dd className="mt-1 text-[1rem] font-bold tabular-nums">{formatAmount(account.balance)}</dd>
        </div>
        <div className="bg-surface px-5 py-4">
          <dt className="text-[0.8125rem] text-muted">Storage used</dt>
          <dd className="mt-1 text-[1rem] font-bold tabular-nums">{account.storageBytes.toLocaleString("en-GB")} bytes</dd>
        </div>
      </dl>

      <section aria-labelledby="history-title" className="mt-4 bg-surface p-5">
        <h2 id="history-title" className="text-[1rem] font-semibold">
          {method ? <>Calls to <span translate="no">{method}()</span></> : "Newest transactions"}
        </h2>
        <p className="mt-1 text-[0.8125rem] text-muted">
          {method
            ? <>Among the newest {history.looked} transactions. <Link href={`/account/${id}`} className="underline">Show all</Link>.</>
            : `The newest ${history.txs.length}, read from FastNEAR's public index.`}
        </p>
        {history.txs.length === 0 ? (
          <p className="mt-3 text-[0.9375rem]">None found.</p>
        ) : (
          <ul className="mt-3 grid">
            {history.txs.map((tx) => (
              <li key={tx.hash} className="min-w-0 border-t-2 border-bg py-3">
                <Link href={`/tx/${tx.hash}`} className="block min-w-0 hover:underline">
                  <span className="block break-words text-[0.9375rem] font-medium" translate="no">
                    {tx.actions.map(actionLabel).join(", ") || "No actions"}
                    {tx.result === "failed" && <span className="font-semibold"> · failed</span>}
                  </span>
                  <span className="mt-0.5 block break-words text-[0.8125rem] text-muted">
                    {formatBlockTime(tx.at)} · <span translate="no">{tx.signer}</span> to <span translate="no">{tx.receiver}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export default function AccountPage({ params, searchParams }: PageProps<"/account/[id]">) {
  return (
    <Suspense fallback={<p className="text-[0.9375rem] text-muted">Reading from NEAR testnet…</p>}>
      <Loaded params={params} searchParams={searchParams} />
    </Suspense>
  );
}
