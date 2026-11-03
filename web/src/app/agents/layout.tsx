import type { Metadata } from "next";
import { TopBar } from "../../components/claims/TopBar";
import { WalletProvider } from "../../lib/wallet";

export const metadata: Metadata = {
  title: "Agents · Vouch",
  description: "Every Vouch agent's record: the calls it made, the calls that held, and the bond it lost.",
};

export default function AgentsLayout({ children }: LayoutProps<"/agents">) {
  return (
    <WalletProvider>
      <TopBar />
      <main className="mx-auto max-w-[72rem] px-[var(--margin)] pb-16 pt-7">{children}</main>
    </WalletProvider>
  );
}
