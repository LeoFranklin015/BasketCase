/**
 * The user's own buys, recorded in this browser only, for "floor as % of your cost".
 * Amounts are what the quote said at the time of the buy, not read back from chain.
 */

import type { RecordedBuy } from "@backed/client";
import { BRAND, BUYS_EVENT } from "./config";

export type StoredBuy = RecordedBuy & { ts: number; tx?: string };

const key = (account: string, coin: string) => `${BRAND.codename}:buys:${account}:${coin}`;

export function readBuys(account: string, coin: string): StoredBuy[] {
  try {
    const raw = localStorage.getItem(key(account, coin));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as StoredBuy[]).filter((b) => /^\d+$/.test(b.tokens) && /^\d+$/.test(b.bu)) : [];
  } catch {
    return [];
  }
}

export function recordBuy(account: string, coin: string, buy: StoredBuy): void {
  try {
    const all = [...readBuys(account, coin), buy].slice(-200);
    localStorage.setItem(key(account, coin), JSON.stringify(all));
    window.dispatchEvent(new Event(BUYS_EVENT));
  } catch {
    // Storage blocked: the figure just won't show.
  }
}

export function clearBuys(account: string, coin: string): void {
  try {
    localStorage.removeItem(key(account, coin));
    window.dispatchEvent(new Event(BUYS_EVENT));
  } catch {
    // ignore
  }
}
