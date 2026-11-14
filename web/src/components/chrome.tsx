"use client";

import { faucetTx } from "@backed/client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useState } from "react";
import { BRAND, DATA_MODE, FAUCET_AMOUNT, NET, NOT_DEPLOYED, PAY_TOKEN_ID } from "@/lib/config";
import { OTHER_NETWORK_URL } from "@/lib/network";
import { verifierId } from "@/lib/data";
import { useWallet } from "@/lib/wallet";
import { Avatar } from "./coin-bits";
import { IconHome, IconRocket, IconTomb } from "./icons";
import { Sheet } from "./sheet";
import { TxStatus, useTx } from "./tx";
import { ChainIcon } from "./token-icon";
import { cx } from "./ui";
import { AccountCard, ConnectOptions, TryFreeButton, WalletButton } from "./wallet-button";

const NAV = [
  { href: "/app", label: "Markets" },
  { href: "/launch", label: "Launch" },
  { href: "/graveyard", label: "Graveyard" },
  { href: "/sim", label: "Simulation" },
];

const isActive = (href: string, path: string) => (href === "/app" ? path === "/app" || path.startsWith("/c/") : path.startsWith(href));

/**
 * The brand mark: a basket holding three coins. The middle coin is the floor yellow; the two beside it are other
 * assets, so the mark says what a coin is (a basket of assets). Drawn on a 32 grid so it holds at 20px.
 */
export function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <circle cx="10.5" cy="11" r="5" fill="#2DBE60" stroke="var(--ink)" strokeWidth="1.8" />
      <circle cx="21.5" cy="11" r="5" fill="#7B61FF" stroke="var(--ink)" strokeWidth="1.8" />
      <circle cx="16" cy="8.5" r="5.5" fill="var(--floor)" stroke="var(--ink)" strokeWidth="1.8" />
      <path d="M4.5 15.5h23l-3.2 11.2a2.5 2.5 0 0 1-2.4 1.8H10.1a2.5 2.5 0 0 1-2.4-1.8z" fill="var(--ink)" />
      <rect x="3" y="13.6" width="26" height="3.4" rx="1.7" fill="var(--ink)" />
      <path d="M8.2 20.6h15.6M9.4 24.4h13.2" stroke="var(--panel)" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ className, size = 26 }: { className?: string; size?: number }) {
  return (
    <span className={cx("inline-flex items-center gap-2 text-[20px] font-bold leading-none tracking-[-0.03em] text-ink", className)}>
      <Mark size={size} />
      <span className="-mt-0.5">{BRAND.name.toLowerCase()}</span>
    </span>
  );
}

export function DataNotice() {
  if (DATA_MODE === "fixture") {
    return (
      <div role="note" className="bg-floor-soft px-4 py-1.5 text-center text-xs text-ink">
        <span className="font-bold">Fixture data.</span> These coins are sample data shaped like the contracts. Nothing here is live and no transaction is sent.
      </div>
    );
  }
  if (NOT_DEPLOYED) {
    return (
      <div role="note" className="bg-down-soft px-4 py-1.5 text-center text-xs text-ink">
        {NET.id === "mainnet" ? (
          <>
            <span className="font-bold">Not live on mainnet yet.</span> The same contracts run on testnet today; mainnet goes live after the owner&apos;s go (deployments/mainnet.json).{" "}
            {OTHER_NETWORK_URL && (
              <a className="link font-semibold" href={OTHER_NETWORK_URL}>
                Open the testnet app
              </a>
            )}
          </>
        ) : (
          <>Contracts aren&apos;t deployed yet: deployments/{NET.id}.json still holds placeholder ids. Run with NEXT_PUBLIC_DATA=fixture to preview.</>
        )}
      </div>
    );
  }
  return null;
}

/** Which network this build reads (NEXT_PUBLIC_NETWORK). A link to the other one when it is hosted. */
export function TestnetBadge({ className }: { className?: string }) {
  const cls = cx("inline-flex h-8 items-center gap-1.5 rounded-full bg-pill px-3 text-xs font-semibold text-ink", className);
  const title = NET.testTokens ? "NEAR testnet: test tokens only, nothing here has real value" : "NEAR mainnet: real assets";
  const body = (
    <>
      <ChainIcon chain="near" size={16} className="-ml-1" />
      {NET.label}
    </>
  );
  return OTHER_NETWORK_URL ? (
    <a href={OTHER_NETWORK_URL} className={cx(cls, "hover:border-ink")} title={`${title}. Switch to ${NET.id === "mainnet" ? "testnet" : "mainnet"}.`}>
      {body}
      <span aria-hidden>⇄</span>
    </a>
  ) : (
    <span className={cls} title={title}>
      {body}
    </span>
  );
}

/** The app is light only; the toggle stays as a component so callers keep compiling, and renders nothing. */
export function ThemeToggle() {
  return null;
}

export function SiteHeader() {
  const path = usePathname();
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-full focus:bg-card focus:px-4 focus:py-2">
        Skip to content
      </a>
      <DataNotice />
      <header className="sticky top-0 z-30 bg-bg/90 backdrop-blur-xl">
        <div className="mx-auto flex h-[52px] max-w-[1280px] items-center gap-2 px-4 md:h-16 md:gap-3 lg:gap-8 lg:px-8">
          <Link href="/app" aria-label={`${BRAND.name} markets`} className="shrink-0">
            <Wordmark />
          </Link>
          <nav aria-label="Main" className="hidden min-w-0 flex-1 items-center gap-1 md:flex">
            {NAV.map((n) => {
              const active = isActive(n.href, path);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={cx("rounded-full px-3.5 py-2 text-[15px] font-semibold transition-colors", active ? "bg-ink text-white" : "text-muted hover:bg-pill hover:text-ink")}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <span className="flex-1 md:hidden" />
          <TestnetBadge />
          <ThemeToggle />
          <span className="hidden items-start gap-2 md:inline-flex">
            <TryFreeButton className="btn-sm" note={false} />
            <WalletButton />
          </span>
        </div>
      </header>
    </>
  );
}

/** Phone navigation: four tabs at the thumb. The last one is the wallet. */
export function TabBar() {
  const path = usePathname();
  const { accountId } = useWallet();
  const [you, setYou] = useState(false);
  const tabs = [
    { href: "/app", label: "Home", icon: IconHome },
    { href: "/launch", label: "Launch", icon: IconRocket },
    { href: "/graveyard", label: "Graveyard", icon: IconTomb },
  ];
  return (
    <>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card pb-[env(safe-area-inset-bottom)] md:hidden">
        <ul className="grid h-16 grid-cols-4">
          {tabs.map((t) => {
            const active = isActive(t.href, path);
            const Icon = t.icon;
            return (
              <li key={t.href}>
                <Link href={t.href} aria-current={active ? "page" : undefined} className={cx("flex h-full flex-col items-center justify-center gap-1 text-[11px] font-semibold", active ? "text-ink" : "text-muted")}>
                  <span className={cx("flex h-7 w-12 items-center justify-center rounded-full transition-colors", active && "bg-ink text-white")}>
                    <Icon size={18} />
                  </span>
                  {t.label}
                </Link>
              </li>
            );
          })}
          <li>
            <button type="button" onClick={() => setYou(true)} className="flex h-full w-full flex-col items-center justify-center gap-1 text-[11px] font-semibold text-muted" aria-haspopup="dialog">
              <span className="flex h-7 w-12 items-center justify-center">
                {accountId ? <Avatar account={accountId} size={22} /> : <span aria-hidden className="size-[18px] rounded-full border-[1.5px] border-current" />}
              </span>
              {accountId ? "You" : "Sign in"}
            </button>
          </li>
        </ul>
      </nav>
      <Sheet open={you} onClose={() => setYou(false)} title={accountId ? "You" : "Sign in"}>
        <YouSheet onDone={() => setYou(false)} />
      </Sheet>
    </>
  );
}

function YouSheet({ onDone }: { onDone: () => void }) {
  const { accountId, method, connect, disconnect } = useWallet();
  const tx = useTx();
  const [err, setErr] = useState<string>();
  if (!accountId) {
    return (
      <div className="pb-2">
        <p className="caption mb-3">Connect to buy, sell and burn. {NET.testTokens ? `Everything runs on ${NET.chain} with free test tokens.` : `This is ${NET.chain}: real assets.`}</p>
        <ConnectOptions
          onPick={(m) => {
            setErr(undefined);
            onDone();
            connect(m).catch((e: Error) => setErr(e.message));
          }}
        />
        {err && (
          <p role="alert" className="mt-2 text-sm text-down">
            {err}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-3 pb-2">
      <div className="-mx-3">
        <AccountCard />
      </div>
      {NET.testTokens && (
        <button
          type="button"
          className="btn btn-quiet w-full"
          disabled={tx.busy}
          onClick={() => void tx.run([{ title: "Get 100 test USDC from the faucet", txs: [faucetTx(verifierId(), { token_id: PAY_TOKEN_ID, amount: FAUCET_AMOUNT })] }])}
        >
          Get 100 test USDC
        </button>
      )}
      <TxStatus s={tx} />
      <button
        type="button"
        className="btn btn-line w-full"
        onClick={() => {
          onDone();
          void disconnect();
        }}
      >
        {method === "privy" ? "Sign out" : "Disconnect"}
      </button>
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-line pb-24 md:pb-0">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-3 px-4 py-6 text-[13px] text-muted lg:flex-row lg:items-start lg:justify-between lg:px-8">
        <p className="max-w-2xl">
          <span className="font-semibold text-ink-2">{BRAND.name}</span> runs on {NET.chain}
          {NET.testTokens ? " with test tokens" : ""}. A floor is not a guarantee of value: it is backed by assets whose prices move. No admin keys; every method is permissionless.{" "}
          <Link href="/sim" className="link md:hidden">
            See the 60-day simulation
          </Link>
        </p>
        <p className="max-w-md lg:text-right">
          Charts:{" "}
          <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer" className="link text-ink-2">
            TradingView Lightweight Charts™
          </a>
          , Copyright (c) 2025 TradingView, Inc.
        </p>
      </div>
    </footer>
  );
}
