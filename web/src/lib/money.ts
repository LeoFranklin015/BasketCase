import { buUsdNowE6, formatTiny, toNumber, type BasketEntry, type CoinConfig } from "@backed/client";
import { tokenInfo } from "./config";

/** Dollar value of one BU: from current swapper prices when every asset has one, else the launch size. */
export function buUsdE6(config: Pick<CoinConfig, "bu_usd_e6">, basket?: BasketEntry[], usdPrices?: Record<string, string>): { e6: number; live: boolean } {
  if (basket && usdPrices && Object.keys(usdPrices).length) {
    const now = buUsdNowE6(basket, usdPrices);
    if (now !== null && now > 0) return { e6: now, live: true };
  }
  return { e6: config.bu_usd_e6, live: false };
}

/** "$0.0₇4660", "$12.40", "$1,234". */
export function usd(n: number): string {
  if (!Number.isFinite(n)) return "–";
  if (n === 0) return "$0";
  const abs = Math.abs(n);
  if (abs >= 1000) return "$" + new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
  if (abs >= 1) return "$" + new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  if (abs >= 0.01) return "$" + n.toFixed(abs >= 0.1 ? 2 : 3);
  return "$" + formatTiny(n, 4);
}

/** BU-per-token (1e18) -> dollars per token. */
export function priceToUsd(price_e18: string, bu_e6: number): number {
  return (toNumber(price_e18, 18) * bu_e6) / 1e6;
}

/** BU amount (1e18) -> dollars. */
export function buToUsdN(bu: string, bu_e6: number): number {
  return (toNumber(bu, 18) * bu_e6) / 1e6;
}

/** Raw token amount -> dollars at the swapper price (dollars per raw unit, 1e36). */
export function rawToUsd(token_id: string, raw: string, usdPrices: Record<string, string>): number | null {
  const p = usdPrices[token_id];
  if (!p) return null;
  return Number((BigInt(raw) * BigInt(p)) / 10n ** 30n) / 1e6;
}

/** Human amount of a basket asset. */
export function assetAmount(token_id: string, raw: string): string {
  const t = tokenInfo(token_id);
  const n = toNumber(raw, t.decimals);
  if (n === 0) return "0";
  if (n >= 1e6) return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n);
  if (n >= 1) return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(n);
  return formatTiny(n, 4);
}

export type BasketRow = BasketEntry & { symbol: string; known: boolean; usd: number | null; share: number | null };

/** Basket with dollar values and each asset's share of the vault by value. */
export function basketRows(basket: BasketEntry[], usdPrices: Record<string, string>): BasketRow[] {
  const rows = basket.map((b) => {
    const t = tokenInfo(b.token_id);
    return { ...b, symbol: t.symbol, known: t.known, usd: rawToUsd(b.token_id, b.held, usdPrices), share: null as number | null };
  });
  const total = rows.reduce((s, r) => s + (r.usd ?? 0), 0);
  const allPriced = rows.every((r) => r.usd !== null);
  return rows.map((r) => ({ ...r, share: allPriced && total > 0 ? (r.usd ?? 0) / total : r.weight_bps / 10_000 }));
}

/** A plain quantity: compact when large, subscript zeros when tiny. */
export function fmtQty(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e4) return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n);
  if (a >= 1) return new Intl.NumberFormat("en-US", { maximumSignificantDigits: 4 }).format(n);
  return formatTiny(n, 4);
}

export type PriceUnit = "usd" | "bu";

/** A BU-per-token float in dollars (at the BU's current value) or in BU. */
export function unitPrice(buPerToken: number, unit: PriceUnit, bu_e6: number): number {
  return unit === "usd" ? (buPerToken * bu_e6) / 1e6 : buPerToken;
}

/** "$0.0₇4660" or "0.0₅4660 BU". */
export function fmtUnit(v: number, unit: PriceUnit, opts: { suffix?: boolean } = {}): string {
  if (!Number.isFinite(v)) return "–";
  if (unit === "usd") return usd(v);
  return `${formatTiny(v, 4)}${opts.suffix === false ? "" : " BU"}`;
}

/** Axis label for a price: short, subscript zeros for tiny values. */
export function axisPrice(v: number, unit: PriceUnit): string {
  if (!Number.isFinite(v)) return "";
  const s = Math.abs(v) >= 1000 ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(v) : formatTiny(v, 4);
  return unit === "usd" ? `$${s}` : s;
}

/** Dollars for a BU float. */
export function buFloatUsd(bu: number, bu_e6: number): number {
  return (bu * bu_e6) / 1e6;
}

const SUBSCRIPT = "₀₁₂₃₄₅₆₇₈₉";

/**
 * Labels for a set of axis ticks that share one zero count, so a scale reads 0.0₆2400, 0.0₆1600,
 * 0.0₆0800 rather than mixing 0.0₆ and 0.0₇. Negative ticks (below a zero floor) are blank.
 */
export function axisPrices(values: number[], unit: PriceUnit): string[] {
  const pos = values.filter((v) => v > 0 && Number.isFinite(v));
  const max = pos.length ? Math.max(...pos) : 0;
  const pre = unit === "usd" ? "$" : "";
  if (max === 0 || max >= 0.001) return values.map((v) => (v < 0 ? "" : axisPrice(v, unit)));
  const zeros = -Math.floor(Math.log10(max)) - 1;
  const sub = String(zeros)
    .split("")
    .map((d) => SUBSCRIPT[Number(d)])
    .join("");
  return values.map((v) => {
    if (v < 0 || !Number.isFinite(v)) return "";
    if (v === 0) return `${pre}0`;
    const digits = Math.round(v * 10 ** (zeros + 4));
    return `${pre}0.0${sub}${String(Math.min(digits, 99_999)).padStart(4, "0")}`;
  });
}

/**
 * A friendlier unit for a tiny per-token price: per 1M or per 1K tokens, so "$0.0₅9818" reads as
 * "$9.82 per 1M". Pick it once from the price and use the same unit for the floor beside it.
 */
export function priceUnit(priceUsd: number): { mult: number; label: string } {
  if (!(priceUsd > 0) || priceUsd >= 0.01) return { mult: 1, label: "per token" };
  if (priceUsd >= 0.00001) return { mult: 1_000, label: "per 1K tokens" };
  return { mult: 1_000_000, label: "per 1M tokens" };
}
