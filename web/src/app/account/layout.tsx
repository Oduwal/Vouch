import type { Metadata } from "next";
import { TopBar } from "../../components/claims/TopBar";
import { WalletProvider } from "../../lib/wallet";

export const metadata: Metadata = {
  title: "Account · Vouch",
  description: "A NEAR testnet account and its newest transactions, read directly from the chain.",
};

export default function AccountLayout({ children }: LayoutProps<"/account">) {
  return (
    <WalletProvider>
      <TopBar />
      <main className="mx-auto max-w-[72rem] px-[var(--margin)] pb-24 md:pb-16 pt-7">{children}</main>
    </WalletProvider>
  );
}
