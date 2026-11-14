/**
 * Basket assets wear their own colours, always next to their symbol (never colour alone).
 * None of them is the floor yellow, which belongs to the floor only.
 */

import { hash32 } from "./avatar";

const KNOWN: Record<string, string> = {
  BTC: "#f7931a",
  SOL: "#9945ff",
  ETH: "#7f8bb8",
  USDC: "#2775ca",
  USDT: "#26a17b",
  DOGE: "#c2a633",
  PEPE: "#3d9b3a",
  WIF: "#b98a5e",
  BONK: "#e0662a",
  NVDA: "#76b900",
  FROG: "#2fae7e",
  NEAR: "#00a37a",
  WNEAR: "#00a37a",
};

/** For tokens without a brand colour: picked by hash so a symbol keeps its colour everywhere. */
const FALLBACK = ["#d0508a", "#3f8fd2", "#8d6e63", "#5c6bc0", "#00897b", "#c0712e", "#7e57c2", "#689f38"];

export function assetColor(symbol: string): string {
  const s = symbol.toUpperCase();
  return KNOWN[s] ?? FALLBACK[hash32(s) % FALLBACK.length]!;
}

/** A coin's own colour: a hue picked from its ticker, so a coin looks the same everywhere. */
export function coinHue(ticker: string): number {
  return hash32(`coin:${ticker.toUpperCase()}`) % 360;
}

/** The solid avatar colour behind a coin's white initials. */
export function coinColor(ticker: string): string {
  return `hsl(${coinHue(ticker)} 80% 52%)`;
}

/** The soft glow at the top of a coin's page. */
export function coinGlow(ticker: string): string {
  return `hsla(${coinHue(ticker)}, 85%, 62%, 0.32)`;
}
