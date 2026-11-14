import type { Deployment, TokenInfo } from "@backed/client";
import testnetDeployment from "../../../deployments/testnet.json";
import mainnetDeployment from "../../../deployments/mainnet.json";
import constantsJson from "../../../constants.json";
import { NET, NETWORK } from "./network";

export { NET, NETWORK } from "./network";

/** Product name lives here only, so it can be swapped in one place. */
export const BRAND = {
  /** Shown in the header, titles and link cards. */
  name: "Basketcase",
  /** Lower-case codename used in storage keys and the NEP-297 standard. */
  codename: constantsJson.app.codename,
  tagline: "Buy the meme. Keep the index.",
  /** One sentence used wherever the floor appears. */
  floorSentence: "The floor is the least any sell pays per token before the fee: the curve's lowest price plus the backing each token has gained from fees and burns.",
  /** The same sentence for a graduated (Index mode) coin. */
  floorSentenceIndex: "The floor is the least any sell pays per token before the fee: the vault's reserve divided by every token in existence, which anyone can redeem for.",
} as const;

export const DATA_MODE: "fixture" | "rpc" = process.env.NEXT_PUBLIC_DATA === "fixture" ? "fixture" : "rpc";

/** The deployments file for NEXT_PUBLIC_NETWORK (see src/lib/network.ts). */
export const deployment = (NETWORK === "mainnet" ? mainnetDeployment : testnetDeployment) as Deployment;
export const constants = constantsJson;

/** True while the deployments file still holds placeholder account ids (mainnet until the owner says go). */
/** Rhea (NEAR's main DEX) pools of graduated coins, from deployments/<network>.json (scripts/src/rhea-list.ts). */
export const RHEA_POOLS: Record<string, number> = (deployment as { rhea_pools?: Record<string, number> }).rhea_pools ?? {};
/** The Rhea app's page for a coin's pool, or null when the coin isn't listed there. */
export function rheaPoolUrl(coin: string): string | null {
  const id = RHEA_POOLS[coin];
  if (id === undefined) return null;
  return `${NET.testTokens ? "https://testnet.rhea.finance" : "https://app.rhea.finance"}/pool/${id}`;
}

/** Coins deployed without a factory (the cheap mainnet demo: deployments/mainnet.json has factory "none"). */
export const DIRECT_COINS: { account_id: string; ticker: string; name: string; creator: string; created_ms: number }[] =
  (deployment as { coins?: { account_id: string; ticker: string; name: string; creator: string; created_ms: number }[] }).coins ?? [];
export const NOT_DEPLOYED =
  [deployment.factory, deployment.verifier].some((id) => id.startsWith("PLACEHOLDER")) || (deployment.factory === "none" && DIRECT_COINS.length === 0);

const payToken = deployment.tokens.find((t) => t.symbol === "USDC") ?? deployment.tokens[0]!;
export const PAY_TOKEN_ID = payToken.token_id;
/** 100 whole units of the pay token, for the faucet button. */
export const FAUCET_AMOUNT = (100n * 10n ** BigInt(payToken.decimals)).toString();
/** localStorage key for the light/dark choice. */
// "theme4": the default went dark with the Nov 14 redesign; older saved choices start fresh.
export const THEME_KEY = `${constantsJson.app.codename}:theme4`;
/** Fired when this browser records a buy. */
export const BUYS_EVENT = `${constantsJson.app.codename}:buys`;

export const EXPLORER_TX = (hash: string) => `${NET.explorer}/txns/${hash}`;
export const EXPLORER_ACCOUNT = (id: string) => `${NET.explorer}/address/${id}`;

/** Known tokens (deployments file), keyed by token id. Anything else is "unverified backing". */
const KNOWN = new Map<string, TokenInfo>(deployment.tokens.map((t) => [t.token_id, t]));

export function tokenInfo(token_id: string): TokenInfo & { known: boolean } {
  const t = KNOWN.get(token_id);
  if (t) return { ...t, known: true };
  // Unknown token: show a readable symbol from the id; assume 18 decimals for display only.
  const bare = token_id.replace(/^nep141:/, "").split(".")[0] ?? token_id;
  return { symbol: bare.toUpperCase().slice(0, 10), token_id, decimals: 18, known: false };
}

export const CURVE = {
  /** Virtual reserves and graduation reserve as plain numbers (BU, whole tokens), for charts. */
  float: { x0: Number(constantsJson.curve.virtual_bu), y0: Number(constantsJson.curve.virtual_tokens), grad: Number(constantsJson.curve.graduation_reserve_bu) },
  grad_reserve_bu: constantsJson.curve.graduation_reserve_bu,
  auction_premium_bps: constantsJson.auction.start_premium_bps,
  fee_min_bps: constantsJson.fees.trade_fee_bps.min,
  fee_max_bps: constantsJson.fees.trade_fee_bps.max,
  fee_default_bps: constantsJson.fees.trade_fee_bps.default,
  bu_usd_default: constantsJson.launch.bu_usd_default,
  max_assets: constantsJson.launch.basket_assets.max,
  window_s: constantsJson.launch.fair_launch_window_s,
  epoch_s: constantsJson.epochs.len_s,
};

/** Privy app id (public by design). Without it, or in fixture mode, the email/social sign-in is hidden. */
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";
export const PRIVY_ENABLED = PRIVY_APP_ID !== "" && DATA_MODE === "rpc";

const PRIVY_METHOD_LABELS = { email: "Email", google: "Google", twitter: "X" } as const;
export type PrivyLoginMethod = keyof typeof PRIVY_METHOD_LABELS;

/** Login methods for the Privy modal. Must match what the Privy dashboard has enabled; email is the safe default. */
export const PRIVY_LOGIN_METHODS: PrivyLoginMethod[] = (() => {
  const wanted = (process.env.NEXT_PUBLIC_PRIVY_LOGIN_METHODS || "email").split(",").map((s) => s.trim().toLowerCase());
  const known = wanted.filter((m): m is PrivyLoginMethod => m in PRIVY_METHOD_LABELS);
  return known.length ? [...new Set(known)] : ["email"];
})();

/** "Email", "Email or Google", "Email, Google or X". */
export const PRIVY_LOGIN_LABEL = (() => {
  const names = PRIVY_LOGIN_METHODS.map((m) => PRIVY_METHOD_LABELS[m]);
  return names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
})();
