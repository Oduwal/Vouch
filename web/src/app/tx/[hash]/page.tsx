import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { actionLabel, checkCommand, formatAmount, formatBlockTime, getTransaction, isTxHash, type ActionView, type TxView } from "../../../lib/chain";

const heading = "text-[1.5rem] font-bold leading-tight tracking-[-0.01em]";

function AccountLink({ id }: { id: string }) {
  return <Link href={`/account/${id}`} className="break-words underline" translate="no">{id}</Link>;
}

function Action({ action }: { action: ActionView }) {
  return (
    <div className="min-w-0">
      <p className="text-[0.875rem]">
        <span className="font-medium" translate="no">{actionLabel(action)}</span>
        {action.deposit && action.deposit !== "0" && <span className="text-muted"> with {formatAmount(action.deposit)}</span>}
      </p>
      {action.args && action.args !== "{}" && (
        <details className="mt-1 text-[0.8125rem]">
          <summary className="cursor-pointer text-muted">Arguments ({action.argsBytes} bytes)</summary>
          <pre className="mt-2 max-h-96 overflow-auto bg-bg p-3 text-[0.75rem]" translate="no">{action.args}</pre>
        </details>
      )}
      {action.argsTooLong && (
        <p className="mt-1 text-[0.8125rem] text-muted">Arguments are {action.argsBytes} bytes, too long to show here. The command below returns them.</p>
      )}
    </div>
  );
}

function Detail({ tx }: { tx: TxView }) {
  const failedSteps = tx.steps.filter((step) => step.failure);
  return (
    <>
      <h1 className={heading}>Transaction</h1>
      <p className="mt-1 break-all text-[0.875rem]" translate="no">{tx.hash}</p>

      <dl className="mt-6 grid gap-px bg-bg sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-surface px-5 py-4">
          <dt className="text-[0.8125rem] text-muted">Result</dt>
          <dd className="mt-1 text-[1rem] font-bold capitalize">{tx.result}</dd>
        </div>
        <div className="min-w-0 bg-surface px-5 py-4">
          <dt className="text-[0.8125rem] text-muted">Signed by</dt>
          <dd className="mt-1 text-[0.9375rem] font-medium"><AccountLink id={tx.signer} /></dd>
        </div>
        <div className="min-w-0 bg-surface px-5 py-4">
          <dt className="text-[0.8125rem] text-muted">Sent to</dt>
          <dd className="mt-1 text-[0.9375rem] font-medium"><AccountLink id={tx.receiver} /></dd>
        </div>
        <div className="bg-surface px-5 py-4">
          <dt className="text-[0.8125rem] text-muted">When</dt>
          <dd className="mt-1 text-[0.9375rem] font-medium tabular-nums">{formatBlockTime(tx.at)}</dd>
          <dd className="mt-0.5 text-[0.8125rem] tabular-nums text-muted">Block {tx.blockHeight}</dd>
        </div>
      </dl>

      {tx.failure && failedSteps.length === 0 && (
        <p className="mt-4 break-words bg-surface px-5 py-4 text-[0.875rem]" translate="no">{tx.failure}</p>
      )}

      <section aria-labelledby="steps-title" className="mt-4 bg-surface p-5">
        <h2 id="steps-title" className="text-[1rem] font-semibold">What happened, step by step</h2>
        {failedSteps.length > 0 && tx.result === "succeeded" && (
          <p className="mt-1 text-[0.875rem] text-muted">A step failed but the transaction finished. Contracts can catch a failed step and carry on.</p>
        )}
        <ol className="mt-3 grid gap-3">
          {tx.steps.map((step) => (
            <li key={step.id} className="min-w-0 border-t-2 border-bg pt-3">
              <p className="break-words text-[0.875rem] text-muted">
                <span translate="no">{step.from}</span> to <span translate="no">{step.to}</span>
                {step.failure && <span className="font-semibold text-ink"> · failed</span>}
              </p>
              <div className="mt-1 grid gap-2">
                {step.actions.map((action, index) => <Action key={index} action={action} />)}
              </div>
              {step.failure && <p className="mt-1 break-words text-[0.8125rem]" translate="no">{step.failure}</p>}
              {step.logs.length > 0 && (
                <details className="mt-1 text-[0.8125rem]">
                  <summary className="cursor-pointer text-muted">Logs ({step.logs.length})</summary>
                  <pre className="mt-2 max-h-96 overflow-auto bg-bg p-3 text-[0.75rem]" translate="no">{step.logs.join("\n")}</pre>
                </details>
              )}
            </li>
          ))}
        </ol>
        {tx.hiddenRefunds > 0 && (
          <p className="mt-3 text-[0.8125rem] text-muted">{tx.hiddenRefunds} automatic refund {tx.hiddenRefunds === 1 ? "step" : "steps"} from the network not shown.</p>
        )}
      </section>

      <Source tx={tx} />
    </>
  );
}

function Source({ tx }: { tx: TxView }) {
  return (
    <section aria-labelledby="source-title" className="mt-4 bg-surface p-5">
      <h2 id="source-title" className="text-[1rem] font-semibold">Check this yourself</h2>
      <p className="mt-1 max-w-[65ch] text-[0.9375rem]">
        This page reads FastNEAR&apos;s public transaction index and stores nothing. This command asks a NEAR archival node for the same transaction and needs no keys.
      </p>
      <pre className="mt-2 overflow-auto bg-bg p-3 text-[0.75rem]" translate="no">{checkCommand(tx)}</pre>
      <p className="mt-2 max-w-[65ch] text-[0.8125rem] text-muted">
        Vouch has its own page because testnet.nearblocks.io stopped indexing on 27 Sep 2026, so it can&apos;t show newer transactions.
      </p>
    </section>
  );
}

function Message({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <h1 className={heading}>{title}</h1>
      <p className="mt-2 text-[0.9375rem]">{children}</p>
    </>
  );
}

async function Loaded({ params }: { params: Promise<{ hash: string }> }) {
  await connection();
  const { hash } = await params;
  if (!isTxHash(hash)) return <Message title="That isn't a transaction hash">Check the link and try again.</Message>;

  let tx: TxView | null;
  try {
    tx = await getTransaction(hash);
  } catch {
    return <Message title="Transaction">Couldn&apos;t read this from NEAR testnet. <Link href={`/tx/${hash}`} className="underline">Try again</Link>.</Message>;
  }
  if (!tx) {
    return <Message title="No transaction found">The testnet index has no transaction with this hash. A very new one can take a few seconds to appear.</Message>;
  }
  return <Detail tx={tx} />;
}

export default function TxPage({ params }: PageProps<"/tx/[hash]">) {
  return (
    <Suspense fallback={<p className="text-[0.9375rem] text-muted">Reading from NEAR testnet…</p>}>
      <Loaded params={params} />
    </Suspense>
  );
}
