/**
 * Which logo each basket asset, chain and wallet wears. The SVGs live in `public/icons/`
 * (sources and licenses in `public/icons/README.md`); nothing is hotlinked.
 * Pure data, no React: safe on the server (the link card), the client and in unit tests.
 */

export type ChainId = "bitcoin" | "ethereum" | "solana" | "dogecoin" | "near" | "base" | "arbitrum" | "bsc";
export type WalletKind = "near" | "email" | "guest" | "metamask" | "phantom";

/** Each token's official logo (from its CoinGecko listing; see public/icons/README.md), by file in public/icons/tokens. */
const TOKEN_LOGOS: Record<string, string> = {
  BTC: "btc.png",
  ETH: "eth.png",
  SOL: "sol.png",
  USDC: "usdc.png",
  USDT: "usdt.png",
  NEAR: "near.jpg",
  DOGE: "doge.png",
  PEPE: "pepe.jpeg",
  WIF: "wif.jpg",
  BONK: "bonk.jpg",
  SHIB: "shib.png",
  MOG: "mog.png",
  TURBO: "turbo.png",
  TRUMP: "trump.png",
  BRETT: "brett.png",
  BLACKDRAGON: "blackdragon.png",
  SHITZU: "shitzu.jpg",
  JAMBO: "jambo.png",
  NVDA: "nvda.png",
  ARB: "arb.jpg",
  KAITO: "kaito.jpg",
  VVV: "vvv.png",
  PUBLIC: "public.jpg",
  RHEA: "rhea.png",
};
/** Chain logos in public/icons/chains (a chain's logo is its native coin's, except Base). */
const CHAIN_LOGO: Record<ChainId, string> = {
  bitcoin: "bitcoin.png",
  ethereum: "ethereum.png",
  solana: "solana.png",
  dogecoin: "dogecoin.png",
  near: "near.jpg",
  base: "base.svg",
  arbitrum: "arbitrum.jpg",
  bsc: "bsc.png",
};

/** Symbols that are the same coin under another name. */
const ALIAS: Record<string, string> = { WNEAR: "NEAR", NBTC: "BTC", WBTC: "BTC", WETH: "ETH", NVDAON: "NVDA" };

/** Where each asset comes from before NEAR Intents carries it into a vault (see deployments/mainnet.json). */
const ORIGIN: Record<string, ChainId> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  PEPE: "ethereum",
  SHIB: "ethereum",
  MOG: "ethereum",
  TURBO: "ethereum",
  BRETT: "base",
  NVDA: "bsc",
  KAITO: "base",
  VVV: "base",
  PUBLIC: "near",
  ITLX: "near",
  RHEA: "near",
  SOL: "solana",
  TRUMP: "solana",
  BLACKDRAGON: "near",
  SHITZU: "near",
  JAMBO: "near",
  WIF: "solana",
  BONK: "solana",
  DOGE: "dogecoin",
  USDC: "near",
  USDT: "near",
  NEAR: "near",
};

export const CHAIN_NAME: Record<ChainId, string> = {
  bitcoin: "Bitcoin",
  ethereum: "Ethereum",
  solana: "Solana",
  dogecoin: "Dogecoin",
  near: "NEAR",
  base: "Base",
  arbitrum: "Arbitrum",
  bsc: "BNB Chain",
};

/** The pay-from options of the cross-chain preview (`ORIGINS` in @backed/client), as token + chain. */
export const ORIGIN_ICON: Record<string, { symbol: string; chain: ChainId }> = {
  sol: { symbol: "SOL", chain: "solana" },
  "base-usdc": { symbol: "USDC", chain: "base" },
  eth: { symbol: "ETH", chain: "ethereum" },
  "arb-usdc": { symbol: "USDC", chain: "arbitrum" },
};

export const WALLET_ICON: Record<WalletKind, string> = {
  near: "/icons/wallets/near.svg",
  email: "/icons/wallets/email.svg",
  guest: "/icons/wallets/guest.svg",
  metamask: "/icons/wallets/metamask.svg",
  phantom: "/icons/wallets/phantom.svg",
};

function canon(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  return ALIAS[s] ?? s;
}

/** `/icons/tokens/btc.png`, or null when there is no logo (the caller draws a lettered disc). */
export function tokenIconPath(symbol: string): string | null {
  const s = canon(symbol);
  const f = TOKEN_LOGOS[s];
  return f ? `/icons/tokens/${f}` : null;
}

/** The chain an asset comes from, or null when it is not known (a test-only stock, say). */
export function originChain(symbol: string): ChainId | null {
  return ORIGIN[canon(symbol)] ?? null;
}

/** A chain's own coin (BTC on Bitcoin, SOL on Solana): its logo already says the chain, so it gets no badge. */
const NATIVE: Record<string, ChainId> = { BTC: "bitcoin", ETH: "ethereum", SOL: "solana", DOGE: "dogecoin", NEAR: "near" };
export function isNativeCoin(symbol: string): boolean {
  return canon(symbol) in NATIVE;
}

export function chainIconPath(chain: ChainId): string {
  return `/icons/chains/${CHAIN_LOGO[chain]}`;
}

/** Ondo's tokenized stocks (NVDAon, TSLAon, AAPLon): shown with Ondo's eligibility note. */
export function isOndoStock(symbol: string): boolean {
  return /^[A-Z]{1,5}ON$/.test(symbol.trim().toUpperCase()) && symbol.trim().endsWith("on");
}
