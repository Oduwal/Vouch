"use client";

import type { NearConnector } from "@hot-labs/near-connect";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { CONTRACT_ID } from "./vouch";

type Wallet = {
  accountId: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  // Signs a call on the Vouch contract and returns the transaction hash. Throws with the contract's own message.
  call: (method: string, args: object, depositYocto: bigint, tgas: number) => Promise<string>;
};

const WalletContext = createContext<Wallet | null>(null);

// The wallet library touches the browser as it loads, so it is only imported on the client, once.
let connector: Promise<NearConnector> | null = null;
function getConnector() {
  connector ??= import("@hot-labs/near-connect").then((m) => new m.NearConnector({ network: "testnet" }));
  return connector;
}

type Failure = { ActionError?: { kind?: { FunctionCallError?: { ExecutionError?: string } } } };

export function WalletProvider({ children }: { children: ReactNode }) {
  const [accountId, setAccountId] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void getConnector().then((c) => {
      if (!live) return;
      c.on("wallet:signIn", (e) => setAccountId(e.accounts[0]?.accountId ?? null));
      c.on("wallet:signOut", () => setAccountId(null));
      // Throws when no wallet is connected yet, which is the normal first visit.
      c.getConnectedWallet()
        .then(({ accounts }) => live && setAccountId(accounts[0]?.accountId ?? null))
        .catch(() => {});
    });
    return () => {
      live = false;
    };
  }, []);

  const connect = useCallback(async () => {
    const c = await getConnector();
    await c.connect();
  }, []);

  const disconnect = useCallback(async () => {
    const c = await getConnector();
    await c.disconnect();
    setAccountId(null);
  }, []);

  const call = useCallback<Wallet["call"]>(async (method, args, depositYocto, tgas) => {
    const c = await getConnector();
    const { wallet, accounts } = await c.getConnectedWallet();
    const outcome = await wallet.signAndSendTransaction({
      network: "testnet",
      signerId: accounts[0]?.accountId,
      receiverId: CONTRACT_ID,
      actions: [
        {
          type: "FunctionCall",
          params: {
            methodName: method,
            args,
            gas: (BigInt(tgas) * BigInt(10) ** BigInt(12)).toString(),
            deposit: depositYocto.toString(),
          },
        },
      ],
    });
    const status = outcome.status as { Failure?: Failure } | string;
    const failure = typeof status === "object" ? status.Failure : undefined;
    if (failure) {
      const reason = failure.ActionError?.kind?.FunctionCallError?.ExecutionError;
      throw new Error(reason?.replace(/^Smart contract panicked: /, "") ?? "The transaction failed");
    }
    return outcome.transaction.hash;
  }, []);

  const value = useMemo(() => ({ accountId, connect, disconnect, call }), [accountId, connect, disconnect, call]);
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const wallet = useContext(WalletContext);
  if (!wallet) throw new Error("useWallet must be used inside WalletProvider");
  return wallet;
}
