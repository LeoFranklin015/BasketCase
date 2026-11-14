import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { BRAND, NET } from "@/lib/config";
import { WalletProvider } from "@/lib/wallet";
import { XWalletProvider } from "@/lib/xwallet";

// One face: Inter with its optical-size axis, from captions to the big money numbers.
// Inter, self-hosted (variable: weight and optical size), so builds and tests need no font download.
const inter = localFont({ src: "./fonts/inter-latin-opsz-normal.woff2", variable: "--font-inter", display: "swap", weight: "100 900" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: { default: `${BRAND.name}: ${BRAND.tagline}`, template: `%s · ${BRAND.name}` },
  description:
    `A memecoin launchpad on ${NET.chain}. Every coin is backed by a basket of real assets, and no sell pays less than its floor (before the fee), shown next to every price.`,
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#f6f6f6" },
    { media: "(prefers-color-scheme: light)", color: "#f6f6f6" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};


export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="light" className={inter.variable} suppressHydrationWarning>
      <body className="min-h-dvh">
        <WalletProvider>
          <XWalletProvider>{children}</XWalletProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
