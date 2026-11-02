"use client";

import Link from "next/link";
import { useState } from "react";
import { useWallet } from "../../lib/wallet";

export function TopBar() {
  const { accountId, connect, disconnect } = useWallet();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      await (accountId ? disconnect() : connect());
    } catch {
      // Closing the wallet picker lands here; staying disconnected is the right result.
    } finally {
      setBusy(false);
    }
  }

  return (
    <header className="bg-deep">
      <div className="mx-auto flex min-h-14 max-w-[72rem] flex-wrap items-center gap-x-4 gap-y-1 sm:gap-x-6 px-[var(--margin)] py-2 text-[0.875rem]">
        <Link href="/" className="display text-[1.125rem] no-underline" translate="no">
          Vouch
        </Link>
        <nav aria-label="Main" className="flex items-center gap-4 sm:gap-5">
          <Link href="/claims" className="py-2 no-underline hover:underline">
            Calls
          </Link>
          <Link href="/#check" className="py-2 no-underline hover:underline">
            Check<span className="max-sm:hidden"> an account</span>
          </Link>
        </nav>
        <div className="ml-auto flex min-w-0 items-center gap-3">
          {accountId && (
            <span className="max-w-[40vw] truncate text-muted sm:max-w-[16rem]" translate="no" title={accountId}>
              {accountId}
            </span>
          )}
          <button
            type="button"
            onClick={toggle}
            disabled={busy}
            className="min-h-11 shrink-0 px-3 sm:min-h-9 outline outline-1 -outline-offset-1 outline-muted transition-colors duration-150 hover:bg-surface active:bg-bg disabled:cursor-wait"
          >
            {accountId ? "Disconnect" : "Connect wallet"}
          </button>
        </div>
      </div>
    </header>
  );
}
