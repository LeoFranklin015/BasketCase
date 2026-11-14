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
// Orders are kept in MongoDB (MONGODB_URI, for Vercel) or a JSON file on a long-running server; see the store below.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  buyIntent,
  checkPayloads,
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
import { fmtMin, minBuyUsd } from "../minbuy";
import { basketRows, buUsdE6, rawToUsd } from "../money";
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
export const MIN_USD = 0.5;
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
  /** The coin balance in NEAR Intents just before the buy or sell was relayed, and the relay transaction. */
  coinBefore?: string;
  /** The buyer's direct balance on the coin, and their basket balances in NEAR Intents, just before the relay. */
  directBefore?: string;
  basketBefore?: Record<string, string>;
  relayTx?: string;
  relayAt?: number;
  /** Consecutive failed polls (network, RPC, 1Click); the order only gives up after many. */
  attempts?: number;
  tokens?: string;
  txs: string[];
  error?: string;
  created: number;
  updated: number;
};

// ---------- store ----------
// Orders live in memory, backed by one of two stores:
//  - MongoDB (MONGODB_URI, optional MONGODB_DB, default "basketcase"), for serverless hosts such as Vercel, where each
//    request may run on a different instance with no shared disk; or
//  - a JSON file (XBUY_STORE, default ~/backed-ops/xbuy-orders.json) on a long-running server.
// Entry points `hydrate` an order before working on it and `flush` the writes before they return.

const STORE = process.env.XBUY_STORE ?? `${process.env.HOME ?? "/tmp"}/backed-ops/xbuy-orders.json`;
const MONGO_URI = process.env.MONGODB_URI;
const DB = !!MONGO_URI;
const KEEP_DAYS = 14;
let pending: Promise<unknown>[] = [];

type OrderDoc = { _id: string; order: XOrder; updatedAt: Date };
// One client per warm instance (Vercel reuses it between requests).
const g = globalThis as unknown as { __xbuyMongo?: Promise<import("mongodb").Collection<OrderDoc>> };
function orderCollection(): Promise<import("mongodb").Collection<OrderDoc>> {
  g.__xbuyMongo ??= (async () => {
    const { MongoClient } = await import("mongodb");
    const client = await new MongoClient(MONGO_URI!, { maxPoolSize: 5, serverSelectionTimeoutMS: 8_000 }).connect();
    const col = client.db(process.env.MONGODB_DB ?? "basketcase").collection<OrderDoc>("xbuy_orders");
    // Old orders expire on their own.
    await col.createIndex({ updatedAt: 1 }, { expireAfterSeconds: KEEP_DAYS * 86400 }).catch(() => undefined);
    return col;
  })().catch((e) => {
    g.__xbuyMongo = undefined;
    throw e;
  });
  return g.__xbuyMongo;
}

/** Pull the latest copy of an order from the shared store (no-op for the file store). */
async function hydrate(id: string): Promise<void> {
  if (!DB || !/^[0-9a-f-]{36}$/.test(id)) return;
  const doc = await (await orderCollection()).findOne({ _id: id });
  if (doc) load().set(id, doc.order);
}

/** Wait for this request's writes to reach the shared store. */
async function flush(): Promise<void> {
  const p = pending;
  pending = [];
  await Promise.all(p);
}

/** An order, fresh from the store: for routes that read one without moving it. */
export async function loadOrder(id: string): Promise<XOrder | null> {
  await hydrate(id);
  return getOrder(id);
}

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
  if (DB) {
    const doc: OrderDoc = { _id: o.id, order: o, updatedAt: new Date() };
    pending.push(orderCollection().then((c) => c.replaceOne({ _id: o.id }, doc, { upsert: true })));
    return o;
  }
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
/** Save a new order and wait until the store has it. */
async function persisted(o: XOrder): Promise<XOrder> {
  save(o);
  await flush();
  return o;
}

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

// One relay at a time: each reads the relayer's access-key nonce, so two at once would collide.
let relayQueue: Promise<unknown> = Promise.resolve();

/** One function call from the relayer (gas only, no deposit), queued behind any other. Returns the transaction id. */
function relayerSend(contract: string, method: string, args: Record<string, unknown>, tgas: number): Promise<string> {
  const run = relayQueue.then(async () => {
    const r = relayerConfig();
    if (!r) throw new Error("No relayer is configured on this server.");
    const rpc = await rpcProvider();
    const out = (await sendWithRawSigner({ rpc, accountId: r.id, publicKey: r.key.getPublicKey(), sign: async (h) => r.key.sign(h).signature }, [
      { receiverId: contract, actions: [functionCall(method, args, tgas)] },
    ])) as { transaction_outcome?: { id: string }; status?: { Failure?: unknown } }[];
    const o = out[0];
    if (!o || o.status?.Failure) throw new Error(`${method} failed: ${JSON.stringify(o?.status?.Failure ?? "no outcome")}`);
    return o.transaction_outcome?.id ?? "";
  });
  relayQueue = run.catch(() => undefined);
  return run;
}

/**
 * Run signed payloads through `simulate_intents` (a view), then submit them with the relayer. Returns the
 * transaction id, or "" when NEAR Intents says the payload's nonce is already used (an earlier relay of it landed).
 */
async function relay(signed: SignedIntent[]): Promise<string> {
  try {
    await view(deployment.verifier, "simulate_intents", { signed });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (/nonce.*(used|already)|already.*nonce/i.test(m)) return "";
    throw new Error(`NEAR Intents would reject this: ${m}`, { cause: "rejected" });
  }
  return relayerSend(deployment.verifier, "execute_intents", { signed }, 300);
}

/**
 * Coins of a delivered buy that NEAR Intents didn't take sit parked under the wallet's own account on the coin;
 * `redeliver` (anyone may call it) moves them into NEAR Intents. Returns how many are still parked.
 */
export async function redeliverParked(coin: string, intentsId: string): Promise<bigint> {
  const direct = BigInt(await view<string>(coin, "ft_balance_of", { account_id: intentsId }));
  if (direct === 0n) return 0n;
  await relayerSend(coin, "redeliver", { account_id: intentsId }, 100).catch(() => undefined);
  return BigInt(await view<string>(coin, "ft_balance_of", { account_id: intentsId }));
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
  if (input.usd < min) throw new Error(`Smallest buy for this coin is $${fmtMin(min)}.`);
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
  return persisted({
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
  checkPayloads(toSign.map((t) => t.payload), { ...rules, latest: new Date(rules.latest) });
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
  checkPayloads([payload], { ...rules, latest: new Date(rules.latest) });
  return persisted({
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
  checkPayloads(toSign.map((t) => t.payload), { ...rules, latest: new Date(rules.latest) });
  return persisted({
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
  await hydrate(id);
  try {
    return await submitSignaturesNow(id, signed);
  } finally {
    await flush();
  }
}

async function submitSignaturesNow(id: string, signed: SignedIntent[]): Promise<XOrder> {
  const o = getOrder(id);
  if (!o) throw new Error("No such order.");
  if (o.status !== "sign" || !o.toSign) throw new Error("This order isn't waiting for signatures.");
  if (!Array.isArray(signed) || signed.length !== o.toSign.length) throw new Error("Wrong number of signatures.");
  signed.forEach((s, i) => {
    if (s?.payload !== o.toSign![i]!.payload || s.standard !== STANDARD[o.chain]) throw new Error("A signature doesn't match its message.");
  });
  patch(id, { signed, status: "swapping", step: "Sending your signed swaps", error: undefined });
  const swaps = o.toSign.map((t, i) => [t, signed[i]!] as const).filter(([t]) => t.kind === "swap" || t.kind === "cashout");
  let accepted = 0;
  try {
    for (const [, s] of swaps) {
      await oneClick("/v0/submit-intent", { type: "swap_transfer", signedData: s });
      accepted++;
    }
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    if (accepted === 0 && o.kind === "buy") {
      // A quote expired while the wallet was open and 1Click took none of them: build fresh ones (nothing moved).
      patch(id, { status: "funded", step: "Prices moved; preparing fresh messages", error: why });
    } else {
      patch(id, {
        status: "error",
        error:
          accepted === 0
            ? `1Click didn't take the signed messages (${why}). Nothing moved; start again.`
            : `1Click took ${accepted} of ${swaps.length} swaps and refused the rest (${why}). What it took still fills; everything stays in your own NEAR Intents account. Use Cash out to send it home.`,
      });
    }
    return getOrder(id)!;
  }
  patch(id, { status: swaps.length ? "swapping" : "executing", step: swaps.length ? "1Click is filling your swaps" : "Submitting to NEAR Intents" });
  return getOrder(id)!;
}

// ---------- the poller ----------

const running = new Set<string>();

/** Move an order forward as far as it can go now; safe to call repeatedly (the page polls it). */
export async function advance(id: string): Promise<XOrder | null> {
  await hydrate(id);
  try {
    return await advanceNow(id);
  } finally {
    await flush();
  }
}

async function advanceNow(id: string): Promise<XOrder | null> {
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
    if (getOrder(id)!.status === "executing") await execute(id);
    if (getOrder(id)!.attempts) patch(id, { attempts: 0 });
    return getOrder(id);
  } catch (e) {
    const latest = getOrder(id)!;
    const msg = e instanceof Error ? e.message : String(e);
    const attempts = (latest.attempts ?? 0) + 1;
    // NEAR Intents refusing the payload is final; anything else (RPC, 1Click, network) is retried on the next poll.
    const final = (e instanceof Error && e.cause === "rejected") || attempts >= 15;
    if (!final || latest.status === "awaiting_deposit") return patch(id, { attempts, step: `${(latest.step ?? "Working").replace(/ \(retrying.*$/, "")} (retrying: ${msg.slice(0, 120)})` });
    return patch(id, {
      status: "error",
      attempts,
      error: `${msg}. Nothing of yours is lost: whatever arrived is in your own NEAR Intents account; use Cash out to send it back to your wallet.`,
    });
  } finally {
    running.delete(id);
  }
}

/**
 * Relay the signed buy or sell once, then confirm from balances what the coin did: a fill (coins or basket assets
 * arrive) or a refusal (what was sent comes back). NEAR Intents debits the sender as soon as the relay runs, so a
 * drop in what was sent proves nothing on its own.
 */
async function execute(id: string) {
  const cur = getOrder(id)!;
  const i = cur.toSign!.findIndex((t) => t.kind === "buy" || t.kind === "sell");
  const basketIds = (await getReader().coin(cur.coin).getBasket()).map((b) => b.token_id);
  const ids = Array.from(new Set([NEAR_USDC, ...basketIds]));
  if (cur.relayTx === undefined) {
    if (cur.coinBefore === undefined) {
      const [coinBefore, directBefore, basketBefore] = await Promise.all([
        heldInIntents(cur.coin, cur.intentsId),
        view<string>(cur.coin, "ft_balance_of", { account_id: cur.intentsId }),
        held(cur.intentsId, ids),
      ]);
      patch(id, { coinBefore, directBefore, basketBefore });
    }
    const tx = await relay([cur.signed![i]!]);
    patch(id, { relayTx: tx, relayAt: Date.now(), txs: tx ? [...cur.txs, tx] : cur.txs, step: "Waiting for the coin to fill it" });
  }
  const o = getOrder(id)!;
  const [after, direct, basket] = await Promise.all([
    heldInIntents(o.coin, o.intentsId).then(BigInt),
    view<string>(o.coin, "ft_balance_of", { account_id: o.intentsId }).then(BigInt),
    held(o.intentsId, ids),
  ]);
  const coinBefore = BigInt(o.coinBefore ?? "0");
  const directBefore = BigInt(o.directBefore ?? "0");
  const before = o.basketBefore ?? {};
  const grew = (t: string) => BigInt(basket[t] ?? "0") > BigInt(before[t] ?? "0");
  const backToBefore = (t: string) => BigInt(basket[t] ?? "0") >= BigInt(before[t] ?? "0");
  const late = Date.now() - (o.relayAt ?? Date.now()) > 4 * 60_000;
  if (o.kind === "buy") {
    // Done only when the coins are where the wallet controls them: inside NEAR Intents.
    if (after > coinBefore && direct <= directBefore) return void patch(id, { status: "done", step: "Done", tokens: (after - coinBefore).toString() });
    if (direct > directBefore) {
      // NEAR Intents didn't take the delivery, so the coin parked them under the buyer's own account: deliver again.
      const left = await redeliverParked(o.coin, o.intentsId);
      if (left <= directBefore) return void patch(id, { status: "done", step: "Done", tokens: (BigInt(await heldInIntents(o.coin, o.intentsId)) - coinBefore).toString() });
      if (late) {
        return void patch(id, {
          status: "error",
          error: `Bought, but NEAR Intents hasn't accepted the coins yet. They are held for you on the coin under your own address (${o.intentsId.slice(0, 10)}…), and anyone can retry the delivery with the coin's redeliver method; this page retries each time you check your balance.`,
        });
      }
      return void patch(id, { step: "Bought; delivering the coins to your NEAR Intents account" });
    }
    const sent = Object.keys(JSON.parse(o.toSign![i]!.payload).intents[0].tokens as Record<string, string>);
    if (sent.every(backToBefore)) {
      return void patch(id, {
        status: "error",
        error: "The coin turned the buy down (the price moved past your limit), so nothing was bought. The basket is back in your NEAR Intents account; use Cash out to send it to your wallet.",
      });
    }
  } else {
    if (basketIds.some(grew)) return void patch(id, { status: "done", step: "Done", tokens: o.sellAmount });
    // A payout the coin couldn't make is recorded in its `owed` map; withdraw_owed (anyone may call it) retries it.
    const owed = await view<unknown[]>(o.coin, "get_owed", { account_id: o.intentsId }).catch(() => []);
    if (Array.isArray(owed) && owed.length) await relayerSend(o.coin, "withdraw_owed", { account_id: o.intentsId }, 150).catch(() => undefined);
    if (after >= coinBefore) {
      return void patch(id, { status: "error", error: "The coin turned the sell down (the price moved past your limit). Your coins are back in your NEAR Intents account; try the sell again." });
    }
  }
  if (late) {
    patch(id, {
      status: "error",
      error: "We couldn't confirm the result within 4 minutes. Check your balances below in a minute; nothing can leave your NEAR Intents account without your signature.",
    });
  }
}

/** Everything the wallet holds in NEAR Intents that a cash-out can send home: USDC and the coin's basket assets. */
export async function assetsInIntents(coin: string, intentsId: string): Promise<Record<string, string>> {
  const reader = getReader();
  const [basket, prices] = await Promise.all([reader.coin(coin).getBasket(), reader.swapper.getPrices()]);
  const usd = Object.fromEntries(prices);
  const ids = Array.from(new Set([NEAR_USDC, ...basket.map((b) => b.token_id)]));
  // Only amounts 1Click will take: cash-outs to Base fill from $0.10 per asset (dry quotes, Nov 14, 2026). Smaller
  // dust stays in NEAR Intents and isn't offered.
  return Object.fromEntries(Object.entries(await held(intentsId, ids)).filter(([t, a]) => BigInt(a) > 0n && (rawToUsd(t, a, usd) ?? 0) >= 0.1));
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
