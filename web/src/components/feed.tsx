"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { displayName, isTestTrader } from "@/lib/avatar";
import { EXPLORER_ACCOUNT, EXPLORER_TX } from "@/lib/config";
import type { Trade } from "@/lib/history";
import { fmtQty, usd } from "@/lib/money";
import { Avatar } from "./coin-bits";
import { IconExternal } from "./icons";
import { cx, timeAgo } from "./ui";

export type FeedItem = {
  key: string;
  trade: Trade;
  /** Dollars at today's basket value, or null for an asset swap. */
  usd: number | null;
  ticker: string;
  /** Set on the cross-coin feed, to link each row to its coin. */
  coin?: string;
};

function verb(t: Trade): string {
  switch (t.kind) {
    case "buy":
      return t.path === "pool" ? "bought from the pool" : "bought";
    case "sell":
      return t.path === "pool" ? "sold to the pool" : "sold";
    case "burn":
      return t.reason === "challenge" ? "burned to challenge" : t.reason === "defend" ? "burned to defend" : "burned";
    case "redeem":
      return "redeemed";
    case "settle":
      return t.account === "fair launch" ? "settled: everyone got the same price" : "settled the fair launch";
    case "graduate":
      return "graduated";
    case "fill":
      return "filled a swap auction";
  }
}

/** Remembers which rows were already on screen, so only new ones get the arrival tint. */
export function useArrivals(keys: string[]): Set<string> {
  const seen = useRef<Set<string> | null>(null);
  const fresh = new Set<string>();
  if (seen.current) for (const k of keys) if (!seen.current.has(k)) fresh.add(k);
  useEffect(() => {
    seen.current = new Set([...(seen.current ?? []), ...keys]);
  });
  return fresh;
}

/** "trader2 bought $26 · 2m ago", with a generated face and a link to the transaction. */
export function FeedRow({ item, now, you, fresh }: { item: FeedItem; now: number; you?: string | null; fresh?: boolean }) {
  const t = item.trade;
  const who = t.account;
  const system = who === "fair launch" || who === "pool" || !who;
  const mine = !!you && who === you;
  return (
    <li className={cx("flex items-center gap-3 rounded-[14px] px-2 py-2.5", fresh && "row-in")}>
      <Avatar account={who || item.ticker} size={36} />
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5 text-[15px] leading-snug">
          {t.kind === "graduate" ? (
            <span className="min-w-0 truncate font-semibold">${item.ticker}</span>
          ) : system ? (
            <span className="min-w-0 truncate font-semibold">{who === "pool" ? "The pool" : "The fair launch"}</span>
          ) : (
            <a href={EXPLORER_ACCOUNT(who)} target="_blank" rel="noreferrer" className="min-w-0 truncate font-semibold hover:underline" title={who}>
              {mine ? "You" : displayName(who)}
            </a>
          )}
          {!system && isTestTrader(who) && (
            <span className="shrink-0 rounded-full bg-sunk px-2 py-px text-[11px] font-semibold text-ink-2" title="One of our own test accounts, disclosed in the README">
              test trader
            </span>
          )}
          <span className="num caption ml-auto shrink-0 pl-2 text-xs" title={new Date(t.ts).toLocaleString()}>
            {now ? `${timeAgo(t.ts, now)} ago` : ""}
          </span>
        </p>
        <p className="text-sm leading-snug">
          <span className={t.kind === "buy" ? "font-semibold text-up" : t.kind === "sell" ? "font-semibold text-down" : "text-ink-2"}>{verb(t)}</span>
          {item.usd !== null && t.kind !== "graduate" && t.kind !== "settle" && <span className="num whitespace-nowrap font-semibold"> {usd(item.usd)}</span>}
          {(item.coin || (t.tokens > 0 && t.kind !== "fill")) && <span className="caption" aria-hidden> · </span>}
          {item.coin ? (
            <Link href={`/c/${item.coin}`} className="num whitespace-nowrap font-semibold hover:underline">
              {t.tokens > 0 && t.kind !== "fill" ? `${fmtQty(t.tokens)} ` : ""}${item.ticker}
            </Link>
          ) : (
            t.tokens > 0 &&
            t.kind !== "fill" && (
              <span className="num caption whitespace-nowrap">
                {fmtQty(t.tokens)} {item.ticker}
              </span>
            )
          )}
        </p>
      </div>
      {t.tx && !t.tx.startsWith("fx") && (
        <a href={EXPLORER_TX(t.tx)} target="_blank" rel="noreferrer" className="icon-btn size-8 shrink-0" aria-label="Open the transaction on NEARBlocks">
          <IconExternal size={14} />
        </a>
      )}
    </li>
  );
}
