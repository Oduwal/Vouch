import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { THEME_SCRIPT } from "../lib/theme";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  weight: "variable",
  subsets: ["latin"],
});

// Only the phone layout of the home page sets type in it, so it isn't preloaded everywhere.
const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  preload: false,
});

export const metadata: Metadata = {
  title: "Vouch",
  description: "A counterparty check for AI agents that pay, with a bond behind every answer.",
};

export const viewport: Viewport = {
  themeColor: "#f2f0ea",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${jakarta.variable} ${jetbrains.variable} antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
