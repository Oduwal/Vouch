import type { Metadata } from "next";
import { TopBar } from "../../components/claims/TopBar";
import { WalletProvider } from "../../lib/wallet";

export const metadata: Metadata = {
  title: "Bonded calls · Vouch",
  description: "Every safety call an agent has put money behind, and the challenges against them.",
};

export default function ClaimsLayout({ children }: LayoutProps<"/claims">) {
  return (
    <WalletProvider>
      <TopBar />
      <main className="mx-auto max-w-[72rem] px-[var(--margin)] pb-24 md:pb-16 pt-7">{children}</main>
    </WalletProvider>
  );
}
