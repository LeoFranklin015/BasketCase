// Buy and sell a coin with a MetaMask (USDC on Base) or Phantom (USDC on Solana) wallet. Mainnet only.
//
// Nothing of the buyer's passes through an account of ours. Their wallet's own NEAR Intents account (the lowercase
// EVM address, or the hex of the Solana key) holds every asset at every step, and every step that moves an asset
// is a message their wallet signs:
//   1. start(): a 1Click quote brings their USDC from Base/Solana into NEAR Intents under their own account. They
//      send one ordinary token transfer to its deposit address.
//   2. prepare(): once it lands, 1Click generates one swap intent per basket asset, signed by the buyer, and we
//      build the buy: one `transfer` intent of the basket to the coin with a delivered-buy message. The coin mints
//      into NEAR Intents for the signer. The wallet signs all of them at once.
//   3. The swaps go to 1Click; when they settle, any relayer can submit the signed buy with `execute_intents`.
//      Our relayer account only pays the gas: it cannot change, redirect or spend what the buyer signed.
// Selling is one signed `ft_withdraw` of the coin to the coin with a sell message (the basket assets come back
// to the seller's NEAR Intents account), and cashing out is one signed 1Click swap per asset to USDC on their chain.
// Orders are kept in a JSON file so a restart doesn't lose them.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  buyIntent,
  checkPayload,
  functionCall,
  intentsIdFor,
  intentsSwapQuote,
  minusBps,
  oneClickQuoteIn,
  payloadString,
  prepareBuy,
  sellIntent,
  versionedNonce,
  viewFunction,
  type SignedIntent,
  type SigningRules,
  type XChain,
} from "@backed/client";
import { KeyPair, type KeyPairString } from "near-api-js";
import { deployment, tokenInfo } from "../config";
import { getReader } from "../data";
import { minBuyUsd } from "../minbuy";
import { basketRows, buUsdE6 } from "../money";
import { sendWithRawSigner } from "../near-signer";
import { failoverFetch, rpcProvider } from "../rpc";

export { intentsIdFor, type XChain };
export { base58Decode } from "@backed/client";

export const ONECLICK = "https://1click.chaindefuser.com";
/** USDC on each chain as NEAR Intents names it (1Click /v0/tokens), and the token contract the wallet transfers. */
export const USDC_ON: Record<XChain, { asset: string; contract: string; decimals: number }> = {
  base: { asset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", contract: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: 6 },
  solana: { asset: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", contract: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
};
export const NEAR_USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
export const MIN_USD = 1;
export const MAX_USD = 25;
const STANDARD: Record<XChain, "erc191" | "raw_ed25519"> = { base: "erc191", solana: "raw_ed25519" };

export type ToSign = { kind: "swap" | "buy" | "sell" | "cashout"; payload: string; depositAddress?: string; label: string };

export type XOrder = {
  id: string;
  kind: "buy" | "sell" | "cashout";
  coin: string;
  chain: XChain;
  user: string;
  /** The wallet's account inside NEAR Intents. */
  intentsId: string;
  usd?: number;
  amountIn?: string;
  /** 1Click deposit address for the USDC coming in from Base/Solana (buys only). */
  depositAddress?: string;
  status: "awaiting_deposit" | "funded" | "sign" | "swapping" | "executing" | "done" | "refunded" | "error";
  step?: string;
  usdcReceived?: string;
  /** Payloads waiting for the wallet, with the limits the browser re-checks before signing. */
  toSign?: ToSign[];
  rules?: Omit<SigningRules, "latest"> & { latest: string };
  signed?: SignedIntent[];
  sellAmount?: string;
  tokens?: string;
  txs: string[];
  error?: string;
  created: number;
  updated: number;
};

// ---------- store ----------

const STORE = process.env.XBUY_STORE ?? `${process.env.HOME ?? "/tmp"}/backed-ops/xbuy-orders.json`;
let orders: Map<string, XOrder> | null = null;
function load(): Map<string, XOrder> {
  if (!orders) {
    orders = new Map();
    try {
      if (existsSync(STORE)) for (const o of JSON.parse(readFileSync(STORE, "utf8")) as XOrder[]) orders.set(o.id, o);
    } catch {
      // start empty
    }
  }
  return orders;
}
function save(o: XOrder): XOrder {
  o.updated = Date.now();
  load().set(o.id, o);
  try {
    mkdirSync(dirname(STORE), { recursive: true });
    writeFileSync(STORE, JSON.stringify([...load().values()].slice(-500), null, 1));
  } catch {
    // keep going in memory
  }
  return o;
}
export function getOrder(id: string): XOrder | null {
  return load().get(id) ?? null;
}
const patch = (id: string, p: Partial<XOrder>) => save({ ...getOrder(id)!, ...p });

// ---------- chain access ----------

/** The relayer: submits signed intents and pays their gas. It never holds or controls a buyer's assets. */
export function relayerConfig(): { id: string; key: KeyPair } | null {
  const id = process.env.ROUTER_ACCOUNT_ID;
  const secret = process.env.ROUTER_PRIVATE_KEY as KeyPairString | undefined;
  if (!id || !secret) return null;
  return { id, key: KeyPair.fromString(secret) };
}

async function view<T>(contract: string, method: string, args: Record<string, unknown>): Promise<T> {
  return viewFunction<T>(deployment.rpc, contract, method, args, { fetch: failoverFetch });
}

async function oneClick<T>(path: string, body?: object): Promise<T> {
  const res = await fetch(`${ONECLICK}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", ...(process.env.ONECLICK_API_KEY ? { authorization: `Bearer ${process.env.ONECLICK_API_KEY}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(`1Click: ${json.message ?? res.status}`);
  return json;
}

/** Run signed payloads through `simulate_intents` (a view), then submit them with the relayer. */
async function relay(signed: SignedIntent[]): Promise<string> {
  const r = relayerConfig();
  if (!r) throw new Error("No relayer is configured on this server.");
  try {
    await view(deployment.verifier, "simulate_intents", { signed });
  } catch (e) {
    throw new Error(`NEAR Intents would reject this: ${e instanceof Error ? e.message : String(e)}`);
  }
  const rpc = await rpcProvider();
  const out = (await sendWithRawSigner({ rpc, accountId: r.id, publicKey: r.key.getPublicKey(), sign: async (h) => r.key.sign(h).signature }, [
    { receiverId: deployment.verifier, actions: [functionCall("execute_intents", { signed }, 300)] },
  ])) as { transaction_outcome?: { id: string }; status?: { Failure?: unknown } }[];
  const o = out[0];
  if (!o || o.status?.Failure) throw new Error(`execute_intents failed: ${JSON.stringify(o?.status?.Failure ?? "no outcome")}`);
  return o.transaction_outcome?.id ?? "";
}

async function nonceFor(deadline: Date): Promise<string> {
  return versionedNonce(await view<string>(deployment.verifier, "current_salt", {}), deadline);
}

async function held(intentsId: string, tokenIds: string[]): Promise<Record<string, string>> {
  const bal = await view<string[]>(deployment.verifier, "mt_batch_balance_of", { account_id: intentsId, token_ids: tokenIds });
  return Object.fromEntries(tokenIds.map((t, i) => [t, bal[i] ?? "0"]));
}

/** Tokens of `coin` the wallet holds inside NEAR Intents. */
export async function heldInIntents(coin: string, intentsId: string): Promise<string> {
  return view<string>(deployment.verifier, "mt_balance_of", { account_id: intentsId, token_id: `nep141:${coin}` });
}

// ---------- buy ----------

export async function start(input: { coin: string; chain: XChain; user: string; usd: number }): Promise<XOrder> {
  if (!relayerConfig()) throw new Error("Cross-chain buys are not configured on this server.");
  if (!(input.chain in USDC_ON)) throw new Error("Pay with USDC on Base or Solana.");
  if (!(input.usd >= MIN_USD && input.usd <= MAX_USD)) throw new Error(`Between $${MIN_USD} and $${MAX_USD} per buy.`);
  const intentsId = intentsIdFor(input.chain, input.user);
  const reader = getReader();
  if (!(await reader.getCoin(input.coin))) throw new Error("Unknown coin.");
  const [basket, prices] = await Promise.all([reader.coin(input.coin).getBasket(), reader.swapper.getPrices()]);
  const min = minBuyUsd(basketRows(basket, Object.fromEntries(prices)), "mainnet");
  if (input.usd < min) throw new Error(`Smallest buy for this coin is $${min}.`);
  const usdc = USDC_ON[input.chain];
  const amountIn = BigInt(Math.round(input.usd * 10 ** usdc.decimals)).toString();
  const q = await oneClick<{ quote?: { depositAddress?: string } }>("/v0/quote", {
    dry: false,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: usdc.asset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: NEAR_USDC,
    amount: amountIn,
    refundTo: input.user,
    refundType: "ORIGIN_CHAIN",
    // Straight into the buyer's own NEAR Intents account.
    recipient: intentsId,
    recipientType: "INTENTS",
    deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
  });
  if (!q.quote?.depositAddress) throw new Error("1Click returned no deposit address.");
  return save({
    id: crypto.randomUUID(),
    kind: "buy",
    coin: input.coin,
    chain: input.chain,
    user: input.user,
    intentsId,
    usd: input.usd,
    amountIn,
    depositAddress: q.quote.depositAddress,
    status: "awaiting_deposit",
    step: "Waiting for your USDC",
    txs: [],
    created: Date.now(),
    updated: Date.now(),
  });
}

/** Build everything the wallet signs for the buy: one 1Click swap per missing basket asset, then the buy itself. */
async function prepareBuySigning(o: XOrder) {
  const reader = getReader();
  const usdcHeld = BigInt((await held(o.intentsId, [NEAR_USDC]))[NEAR_USDC] ?? "0");
  if (usdcHeld === 0n) throw new Error("No USDC in your NEAR Intents balance yet.");
  const [config, basket, prices] = await Promise.all([reader.coin(o.coin).getConfig(), reader.coin(o.coin).getBasket(), reader.swapper.getPrices()]);
  const buUsd = buUsdE6(config, basket, Object.fromEntries(prices)).e6 / 1e6;
  // Spend 96% of the USDC: 1Click's prices move a little between this quote and the fill.
  const buIn = BigInt(Math.floor(((Number(usdcHeld) / 1e6) * 0.96 * 1e18) / buUsd)).toString();
  const plan = await prepareBuy(reader, {
    verifier: deployment.verifier,
    swapper: deployment.swapper,
    quoteIn: (a, b, out) => oneClickQuoteIn(a, b, out, o.intentsId),
    coin: o.coin,
    account_id: o.intentsId,
    pay_token: NEAR_USDC,
    bu_in: buIn,
    slippage_bps: 200,
  });
  if (BigInt(plan.payShortfall) > 0n) throw new Error("Prices moved more than expected; try again.");
  const deadline = new Date(Date.now() + 30 * 60_000);
  const toSign: ToSign[] = [];
  let usdcForSwaps = 0n;
  for (const leg of plan.swapLegs) {
    const q = await oneClick<{ quote: { depositAddress: string; amountIn: string } }>("/v0/quote", intentsSwapQuote({ from: leg.token_in, to: leg.want, amountOut: leg.amount_out, account: o.intentsId, slippageBps: 100 }));
    if (BigInt(q.quote.amountIn) > BigInt(leg.amount_in)) throw new Error("1Click's price moved; try again.");
    const gen = await oneClick<{ intent: { standard?: string; payload?: unknown } }>("/v0/generate-intent", {
      type: "swap_transfer",
      standard: STANDARD[o.chain],
      signerId: o.intentsId,
      depositAddress: q.quote.depositAddress,
    });
    if (gen.intent?.standard !== STANDARD[o.chain] || typeof gen.intent.payload !== "string") throw new Error("1Click returned an intent in an unexpected format.");
    usdcForSwaps += BigInt(q.quote.amountIn);
    toSign.push({ kind: "swap", payload: gen.intent.payload, depositAddress: q.quote.depositAddress, label: `Swap USDC into ${symbolOf(leg.want)}` });
  }
  const tokens = Object.fromEntries(plan.quote.token_ids.map((t, i) => [t, plan.quote.amounts[i]!]));
  toSign.push({
    kind: "buy",
    payload: payloadString({ signer_id: o.intentsId, verifier: deployment.verifier, deadline, nonce: await nonceFor(deadline), intents: [buyIntent(o.coin, tokens, plan.min_tokens_out)] }),
    label: `Buy $${config.ticker} with the basket`,
  });
  const maxSpend: Record<string, string> = { ...tokens };
  maxSpend[NEAR_USDC] = (BigInt(tokens[NEAR_USDC] ?? "0") + usdcForSwaps).toString();
  const rules = {
    signer: o.intentsId,
    verifier: deployment.verifier,
    receivers: [o.coin, ...toSign.flatMap((t) => (t.depositAddress ? [t.depositAddress] : []))],
    coin: o.coin,
    maxSpend,
    latest: new Date(Date.now() + 3 * 86400_000 + 10 * 60_000).toISOString(),
  };
  // Each swap only spends its own leg; the whole set is checked against the totals.
  for (const t of toSign) checkPayload(t.payload, { ...rules, latest: new Date(rules.latest) });
  patch(o.id, { status: "sign", step: `Sign ${toSign.length} message${toSign.length > 1 ? "s" : ""} in your wallet`, toSign, rules, signed: undefined, error: undefined });
}

const symbolOf = (tokenId: string) => tokenInfo(tokenId).symbol;

// ---------- sell and cash out ----------

/** Sell `amount` (raw, or "all") of the coin the wallet holds in NEAR Intents. */
export async function startSell(input: { coin: string; chain: XChain; user: string; amount: string }): Promise<XOrder> {
  if (!relayerConfig()) throw new Error("Selling from another chain's wallet is not configured on this server.");
  const intentsId = intentsIdFor(input.chain, input.user);
  const have = BigInt(await heldInIntents(input.coin, intentsId));
  const amount = input.amount === "all" ? have : BigInt(input.amount);
  if (amount <= 0n || amount > have) throw new Error("You don't hold that many in NEAR Intents.");
  const q = await getReader().coin(input.coin).quoteSell(amount.toString());
  const deadline = new Date(Date.now() + 15 * 60_000);
  const payload = payloadString({
    signer_id: intentsId,
    verifier: deployment.verifier,
    deadline,
    nonce: await nonceFor(deadline),
    intents: [sellIntent(input.coin, amount.toString(), minusBps(q.out_bu, 200), intentsId)],
  });
  const rules = { signer: intentsId, verifier: deployment.verifier, receivers: [input.coin], coin: input.coin, maxSpend: { [`nep141:${input.coin}`]: amount.toString() }, latest: new Date(Date.now() + 20 * 60_000).toISOString() };
  checkPayload(payload, { ...rules, latest: new Date(rules.latest) });
  return save({
    id: crypto.randomUUID(),
    kind: "sell",
    coin: input.coin,
    chain: input.chain,
    user: input.user,
    intentsId,
    status: "sign",
    step: "Sign the sell in your wallet",
    toSign: [{ kind: "sell", payload, label: "Sell back to the coin" }],
    rules,
    sellAmount: amount.toString(),
    txs: [],
    created: Date.now(),
    updated: Date.now(),
  });
}

/** Swap the coin's basket assets (and USDC) the wallet holds in NEAR Intents to USDC on its own chain. */
export async function startCashout(input: { coin: string; chain: XChain; user: string }): Promise<XOrder> {
  const intentsId = intentsIdFor(input.chain, input.user);
  const basket = await getReader().coin(input.coin).getBasket();
  const ids = Array.from(new Set([NEAR_USDC, ...basket.map((b) => b.token_id)]));
  const bal = await held(intentsId, ids);
  const toSign: ToSign[] = [];
  const maxSpend: Record<string, string> = {};
  const skipped: string[] = [];
  for (const id of ids) {
    const amount = bal[id] ?? "0";
    if (BigInt(amount) === 0n) continue;
    try {
      const q = await oneClick<{ quote: { depositAddress: string } }>("/v0/quote", {
        dry: false,
        swapType: "EXACT_INPUT",
        slippageTolerance: 150,
        originAsset: id,
        depositType: "INTENTS",
        destinationAsset: USDC_ON[input.chain].asset,
        amount,
        refundTo: intentsId,
        refundType: "INTENTS",
        recipient: input.user,
        recipientType: "DESTINATION_CHAIN",
        deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
      });
      const gen = await oneClick<{ intent: { standard?: string; payload?: unknown } }>("/v0/generate-intent", {
        type: "swap_transfer",
        standard: STANDARD[input.chain],
        signerId: intentsId,
        depositAddress: q.quote.depositAddress,
      });
      if (typeof gen.intent?.payload !== "string") throw new Error("unexpected intent");
      toSign.push({ kind: "cashout", payload: gen.intent.payload, depositAddress: q.quote.depositAddress, label: `${symbolOf(id)} → USDC on ${input.chain === "base" ? "Base" : "Solana"}` });
      maxSpend[id] = amount;
    } catch {
      skipped.push(symbolOf(id)); // too small for 1Click; it stays in NEAR Intents
    }
  }
  if (!toSign.length) throw new Error(skipped.length ? `Too little to cash out (${skipped.join(", ")} stays in NEAR Intents).` : "Nothing to cash out.");
  const rules = { signer: intentsId, verifier: deployment.verifier, receivers: toSign.map((t) => t.depositAddress!), coin: input.coin, maxSpend, latest: new Date(Date.now() + 3 * 86400_000 + 10 * 60_000).toISOString() };
  for (const t of toSign) checkPayload(t.payload, { ...rules, latest: new Date(rules.latest) });
  return save({
    id: crypto.randomUUID(),
    kind: "cashout",
    coin: input.coin,
    chain: input.chain,
    user: input.user,
    intentsId,
    status: "sign",
    step: `Sign ${toSign.length} message${toSign.length > 1 ? "s" : ""} in your wallet${skipped.length ? ` (${skipped.join(", ")} is too small for 1Click and stays in NEAR Intents)` : ""}`,
    toSign,
    rules,
    txs: [],
    created: Date.now(),
    updated: Date.now(),
  });
}

// ---------- signatures ----------

/** The wallet's signatures, in the order of `toSign`. Swaps go to 1Click now; the buy or sell waits its turn. */
export async function submitSignatures(id: string, signed: SignedIntent[]): Promise<XOrder> {
  const o = getOrder(id);
  if (!o) throw new Error("No such order.");
  if (o.status !== "sign" || !o.toSign) throw new Error("This order isn't waiting for signatures.");
  if (!Array.isArray(signed) || signed.length !== o.toSign.length) throw new Error("Wrong number of signatures.");
  signed.forEach((s, i) => {
    if (s?.payload !== o.toSign![i]!.payload || s.standard !== STANDARD[o.chain]) throw new Error("A signature doesn't match its message.");
  });
  patch(id, { signed, status: "swapping", step: "Sending your signed swaps", error: undefined });
  const swaps = o.toSign.map((t, i) => [t, signed[i]!] as const).filter(([t]) => t.kind === "swap" || t.kind === "cashout");
  try {
    for (const [, s] of swaps) await oneClick("/v0/submit-intent", { type: "swap_transfer", signedData: s });
  } catch (e) {
    // A quote expired while the wallet was open: build fresh ones (nothing moved).
    patch(id, { status: o.kind === "buy" ? "funded" : "error", step: "Prices moved; preparing fresh messages", error: e instanceof Error ? e.message : String(e) });
    return getOrder(id)!;
  }
  patch(id, { status: swaps.length ? "swapping" : "executing", step: swaps.length ? "1Click is filling your swaps" : "Submitting to NEAR Intents" });
  return getOrder(id)!;
}

// ---------- the poller ----------

const running = new Set<string>();

/** Move an order forward as far as it can go now; safe to call repeatedly (the page polls it). */
export async function advance(id: string): Promise<XOrder | null> {
  const o = getOrder(id);
  if (!o || running.has(id)) return o;
  running.add(id);
  try {
    if (o.status === "awaiting_deposit") {
      const st = await oneClick<{ status?: string; swapDetails?: { amountOut?: string } }>(`/v0/status?depositAddress=${encodeURIComponent(o.depositAddress!)}`);
      if (st.status === "REFUNDED") return patch(id, { status: "refunded", step: "1Click refunded your USDC" });
      if (st.status !== "SUCCESS") return patch(id, { step: st.status === "PENDING_DEPOSIT" || !st.status ? "Waiting for your USDC" : `1Click: ${st.status.toLowerCase().replace(/_/g, " ")}` });
      patch(id, { status: "funded", usdcReceived: st.swapDetails?.amountOut, step: "Your USDC is in your NEAR Intents account" });
    }
    if (getOrder(id)!.status === "funded") await prepareBuySigning(getOrder(id)!);
    if (getOrder(id)!.status === "swapping") {
      const cur = getOrder(id)!;
      const deps = cur.toSign!.flatMap((t) => (t.depositAddress ? [t.depositAddress] : []));
      const states = await Promise.all(deps.map((d) => oneClick<{ status?: string }>(`/v0/status?depositAddress=${encodeURIComponent(d)}`).then((s) => s.status ?? "PENDING")));
      if (states.some((s) => s === "REFUNDED" || s === "FAILED")) {
        return patch(id, {
          status: "error",
          error: cur.kind === "buy" ? "A swap didn't fill. Nothing reached the coin: your USDC and anything swapped stay in your own NEAR Intents account." : "A swap didn't fill; the asset stays in your NEAR Intents account.",
        });
      }
      if (!states.every((s) => s === "SUCCESS")) return patch(id, { step: `1Click is filling your swaps (${states.filter((s) => s === "SUCCESS").length} of ${states.length})` });
      patch(id, cur.kind === "cashout" ? { status: "done", step: "Done" } : { status: "executing", step: "Submitting to NEAR Intents" });
    }
    if (getOrder(id)!.status === "executing") {
      const cur = getOrder(id)!;
      const i = cur.toSign!.findIndex((t) => t.kind === "buy" || t.kind === "sell");
      const before = BigInt(await heldInIntents(cur.coin, cur.intentsId));
      const tx = await relay([cur.signed![i]!]);
      const after = BigInt(await heldInIntents(cur.coin, cur.intentsId));
      patch(id, {
        status: "done",
        step: "Done",
        txs: [...cur.txs, tx],
        tokens: cur.kind === "buy" ? (after - before).toString() : cur.sellAmount,
      });
    }
    return getOrder(id);
  } catch (e) {
    const latest = getOrder(id)!;
    const keep = latest.status === "awaiting_deposit" || latest.status === "funded";
    patch(id, { status: keep ? latest.status : "error", error: e instanceof Error ? e.message : String(e) });
    return getOrder(id);
  } finally {
    running.delete(id);
  }
}

/** What the browser sees. */
export function publicOrder(o: XOrder) {
  return {
    id: o.id,
    kind: o.kind,
    status: o.status,
    step: o.step,
    error: o.error,
    tokens: o.tokens,
    txs: o.txs,
    intentsId: o.intentsId,
    toSign: o.status === "sign" ? o.toSign : undefined,
    rules: o.status === "sign" ? o.rules : undefined,
  };
}
