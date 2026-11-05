import type { Metadata } from "next";
import { TopBar } from "../../components/claims/TopBar";
import { WalletProvider } from "../../lib/wallet";

export const metadata: Metadata = {
  title: "Transaction · Vouch",
  description: "A NEAR testnet transaction, read directly from the chain's public index.",
};

export default function TxLayout({ children }: LayoutProps<"/tx">) {
  return (
    <WalletProvider>
      <TopBar />
      <main className="mx-auto max-w-[72rem] px-[var(--margin)] pb-24 md:pb-16 pt-7">{children}</main>
    </WalletProvider>
  );
}
