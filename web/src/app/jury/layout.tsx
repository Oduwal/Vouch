import type { Metadata } from "next";
import { TopBar } from "../../components/claims/TopBar";
import { WalletProvider } from "../../lib/wallet";

export const metadata: Metadata = {
  title: "Jury · Vouch",
  description: "The staked jurors who hear appeals against the judge's rulings.",
};

export default function JuryLayout({ children }: LayoutProps<"/jury">) {
  return (
    <WalletProvider>
      <TopBar />
      <main className="mx-auto max-w-[72rem] px-[var(--margin)] pb-24 md:pb-16 pt-7">{children}</main>
    </WalletProvider>
  );
}
