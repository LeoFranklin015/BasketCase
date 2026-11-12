/** Raw-unit arithmetic and display helpers. Amounts are bigint or decimal strings (U128). */

export type Amount = bigint | string | number;

export const E18 = 10n ** 18n;
export const BPS = 10_000n;

export function toBig(v: Amount): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") {
    if (!Number.isInteger(v)) throw new Error(`not an integer amount: ${v}`);
    return BigInt(v);
  }
  if (!/^\d+$/.test(v)) throw new Error(`not a raw amount: "${v}"`);
  return BigInt(v);
}

export function ceilDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error("division by zero");
  return (a + b - 1n) / b;
}

/** "1.5" with 18 decimals -> 1500000000000000000n. Throws on more fraction digits than `decimals`. */
export function parseUnits(value: string, decimals: number): bigint {
  const s = value.trim().replace(/,/g, "");
  const m = /^(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || s === "" || s === ".") throw new Error(`not a decimal amount: "${value}"`);
  const whole = m[1] || "0";
  const frac = m[2] ?? "";
  if (frac.length > decimals) throw new Error(`too many decimals: at most ${decimals}`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

/** Raw units -> trimmed decimal string. `maxFraction` cuts (rounds down) the fraction. */
export function formatUnits(raw: Amount, decimals: number, opts: { maxFraction?: number } = {}): string {
  const v = toBig(raw);
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  let frac = decimals > 0 ? (v % base).toString().padStart(decimals, "0") : "";
  if (opts.maxFraction !== undefined) frac = frac.slice(0, opts.maxFraction);
  frac = frac.replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** Raw units -> JS number (for display and charts only). */
export function toNumber(raw: Amount, decimals: number): number {
  return Number(formatUnits(raw, decimals));
}

const compactFmt = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** 178833333.33 -> "178.8M". */
export function formatCompact(n: number): string {
  return compactFmt.format(n);
}

/** `sig` significant digits, never scientific notation: 4.659e-6 -> "0.000004659". */
export function formatSig(n: number, sig = 4): string {
  if (n === 0 || !Number.isFinite(n)) return n === 0 ? "0" : String(n);
  const abs = Math.abs(n);
  if (abs >= 1) {
    return new Intl.NumberFormat("en-US", { maximumSignificantDigits: sig }).format(n);
  }
  const digits = sig - 1 - Math.floor(Math.log10(abs));
  return n.toFixed(Math.min(digits, 100));
}

/** BU amount (18 decimals) -> dollars, given the coin's launch BU size `bu_usd_e6`. */
export function buToUsd(bu: Amount, bu_usd_e6: number): number {
  return (toNumber(bu, 18) * bu_usd_e6) / 1e6;
}

/** BU-per-token price (scaled 1e18) -> dollars per token. */
export function priceUsd(price_e18: Amount, bu_usd_e6: number): number {
  return buToUsd(price_e18, bu_usd_e6);
}

/** Dollars, formatted for the UI: "$1,234", "$0.42", "$0.00004660". */
export function formatUsd(n: number): string {
  if (n === 0) return "$0";
  if (Math.abs(n) >= 1) {
    return "$" + new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, minimumFractionDigits: Math.abs(n) < 100 ? 2 : 0 }).format(n);
  }
  return "$" + formatSig(n, 4);
}

/** Tokens (18 decimals) for the UI: compact above 10k, otherwise up to 4 decimals. */
export function formatTokens(raw: Amount): string {
  const n = toNumber(raw, 18);
  if (n >= 10_000) return formatCompact(n);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(n);
}

/** BU (18 decimals) for the UI. */
export function formatBu(raw: Amount): string {
  const n = toNumber(raw, 18);
  if (n >= 10_000) return formatCompact(n);
  if (n !== 0 && n < 0.01) return formatSig(n, 3);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);
}

/** BU-per-token price (1e18) as a short number string. */
export function formatPriceBu(price_e18: Amount): string {
  return formatSig(toNumber(price_e18, 18), 4);
}

const SUB = "₀₁₂₃₄₅₆₇₈₉";

/** Like formatSig, but a run of 3+ leading zeros is written as a subscript count: 4.66e-8 -> "0.0₇4660". */
export function formatTiny(n: number, sig = 4): string {
  const abs = Math.abs(n);
  if (n === 0 || abs >= 0.001 || !Number.isFinite(n)) return formatSig(n, sig);
  let zeros = -Math.floor(Math.log10(abs)) - 1;
  let digits = Math.round(abs * 10 ** (zeros + sig));
  if (digits >= 10 ** sig) {
    // Rounding carried into a new digit (e.g. 9.9996e-8 -> 1.000e-7).
    zeros -= 1;
    digits = Math.round(digits / 10);
  }
  const sub = String(zeros).split("").map((d) => SUB[Number(d)]).join("");
  return `${n < 0 ? "-" : ""}0.0${sub}${digits}`;
}
