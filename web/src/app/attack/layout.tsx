import type { Metadata } from "next";
import { TopBar } from "../../components/claims/TopBar";
import { WalletProvider } from "../../lib/wallet";

export const metadata: Metadata = {
  title: "Attack demo · Vouch",
  description: "An invoice redirects a paying agent's money to an account made seconds earlier. See who stops it.",
};

export default function AttackLayout({ children }: LayoutProps<"/attack">) {
  return (
    <WalletProvider>
      <TopBar />
      <main className="mx-auto max-w-[72rem] px-[var(--margin)] pb-16 pt-7">{children}</main>
    </WalletProvider>
  );
}
