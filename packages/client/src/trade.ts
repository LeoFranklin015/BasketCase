/** Buy and sell planning: the two-step buy from interface.md, and sell with slippage. */

import { buyTx, sellTx, storageDepositTx, swapTx, type SwapLeg } from "./actions.ts";
import type { BackedReader } from "./reader.ts";
import type { BuyQuote, SellQuote, Transaction } from "./types.ts";
import { BPS, ceilDiv, E18, parseUnits } from "./units.ts";

/** Dollars -> BU (1e18) at the coin's BU size, rounded down. */
export function usdToBu(usd: string, bu_usd_e6: number): string {
  const usdE6 = parseUnits(usd, 6);
  return ((usdE6 * E18) / BigInt(bu_usd_e6)).toString();
}

/** `amount * (1 - bps)`, rounded down. */
export function minusBps(amount: string | bigint, bps: number): string {
  return ((BigInt(amount) * (BPS - BigInt(bps))) / BPS).toString();
}

export type BuyNeeds = { token_id: string; amount_out: string }[];

/** For each basket asset other than the pay token: how much the user still has to acquire. */
export function buyShortfalls(quote: BuyQuote, pay_token: string, balances: Record<string, string>): BuyNeeds {
  const out: BuyNeeds = [];
  quote.token_ids.forEach((token_id, i) => {
    if (token_id === pay_token) return;
    const need = BigInt(quote.amounts[i] ?? "0") - BigInt(balances[token_id] ?? "0");
    if (need > 0n) out.push({ token_id, amount_out: need.toString() });
  });
  return out;
}

export type PlanBuyInput = {
  verifier: string;
  swapper: string;
  coin: string;
  account_id: string;
  /** The token the user pays with, normally USDC. */
  pay_token: string;
  quote: BuyQuote;
  /** User's balances on the verifier. */
  balances: Record<string, string>;
  /** `swapper.quote_in(pay_token, token, shortfall)` per token that needs a swap. */
  quoteIns: Record<string, string>;
  registered: boolean;
  storage_min: string;
  /** Tolerance on tokens out. */
  slippage_bps: number;
  /** Extra input on each exact-output leg; the swapper refunds what it doesn't use. Default 1%. */
  swap_pad_bps?: number;
  recipient?: string;
};

export type BuyPlan = {
  swapLegs: SwapLeg[];
  /** Transaction 1: every swap leg, or null when the user already holds the basket. */
  step1: Transaction | null;
  /** Transaction(s) 2: storage_deposit if needed, then the buy. */
  step2: Transaction[];
  min_tokens_out: string;
  /** Pay token needed for both steps. */
  payTotal: string;
  /** Pay token the user is missing (0 when they hold enough). */
  payShortfall: string;
};

export function planBuy(p: PlanBuyInput): BuyPlan {
  const pad = BigInt(p.swap_pad_bps ?? 100);
  const swapLegs: SwapLeg[] = buyShortfalls(p.quote, p.pay_token, p.balances).map(({ token_id, amount_out }) => {
    const quoted = p.quoteIns[token_id];
    if (quoted === undefined) throw new Error(`no swap quote for ${token_id}`);
    return { token_in: p.pay_token, amount_in: ceilDiv(BigInt(quoted) * (BPS + pad), BPS).toString(), want: token_id, amount_out };
  });

  const payIdx = p.quote.token_ids.indexOf(p.pay_token);
  const payDirect = payIdx >= 0 ? BigInt(p.quote.amounts[payIdx] ?? "0") : 0n;
  const payTotal = swapLegs.reduce((s, l) => s + BigInt(l.amount_in), payDirect);
  const payHeld = BigInt(p.balances[p.pay_token] ?? "0");

  const min_tokens_out = p.quote.queued ? "0" : minusBps(p.quote.tokens_out, p.slippage_bps);
  const step2: Transaction[] = [];
  if (!p.registered) step2.push(storageDepositTx(p.coin, { deposit: p.storage_min, account_id: p.recipient ?? p.account_id }));
  step2.push(
    buyTx(p.verifier, p.coin, {
      token_ids: p.quote.token_ids,
      amounts: p.quote.amounts,
      min_tokens_out,
      ...(p.recipient ? { recipient: p.recipient } : {}),
    }),
  );

  return {
    swapLegs,
    step1: swapLegs.length ? swapTx(p.verifier, p.swapper, swapLegs) : null,
    step2,
    min_tokens_out,
    payTotal: payTotal.toString(),
    payShortfall: (payTotal > payHeld ? payTotal - payHeld : 0n).toString(),
  };
}

export type PrepareBuyInput = Omit<PlanBuyInput, "quote" | "balances" | "quoteIns" | "registered" | "storage_min"> & {
  bu_in: string;
  /** Price of an exact-output swap. Default: the testnet swapper's `quote_in`; mainnet passes 1Click's. */
  quoteIn?: (token_in: string, token_out: string, amount_out: string) => Promise<string>;
};

/** Read everything the two-step buy needs from chain and plan it. */
export async function prepareBuy(reader: BackedReader, p: PrepareBuyInput): Promise<BuyPlan & { quote: BuyQuote }> {
  const coin = reader.coin(p.coin);
  const recipient = p.recipient ?? p.account_id;
  const quote = await coin.quoteBuy(p.bu_in);
  const ids = Array.from(new Set([...quote.token_ids, p.pay_token]));
  const [bal, storage, bounds] = await Promise.all([
    reader.verifier.mtBatchBalanceOf(p.account_id, ids),
    coin.storageBalanceOf(recipient),
    coin.storageBalanceBounds(),
  ]);
  const balances = Object.fromEntries(ids.map((id, i) => [id, bal[i] ?? "0"]));
  const needs = buyShortfalls(quote, p.pay_token, balances);
  const quoteIn = p.quoteIn ?? reader.swapper.quoteIn;
  const ins = await Promise.all(needs.map((n) => quoteIn(p.pay_token, n.token_id, n.amount_out)));
  const quoteIns = Object.fromEntries(needs.map((n, i) => [n.token_id, ins[i]!]));
  const { quoteIn: _q, ...rest } = p;
  const plan = planBuy({ ...rest, quote, balances, quoteIns, registered: storage !== null, storage_min: bounds.min });
  return { ...plan, quote };
}

/** Sell with `min_bu_out` = quote minus slippage. */
export function planSell(coin: string, quote: SellQuote, slippage_bps: number, receiver_id?: string): Transaction {
  return sellTx(coin, { amount: quote.amount, min_bu_out: minusBps(quote.out_bu, slippage_bps), ...(receiver_id ? { receiver_id } : {}) });
}
