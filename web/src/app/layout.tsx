import type { Metadata, Viewport } from "next";
import { TikTok_Sans } from "next/font/google";
import { THEME_SCRIPT } from "../lib/theme";
import "./globals.css";

const tiktok = TikTok_Sans({
  variable: "--font-tiktok",
  weight: "variable",
  axes: ["wdth"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Vouch",
  description: "Bonded safety checks for AI agents that pay. Wrong calls cost the checker its bond.",
};

// Dark is the brand's first impression. Light is a choice each visitor makes with the toggle.
export const viewport: Viewport = {
  themeColor: "#3d0012",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${tiktok.variable} antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
