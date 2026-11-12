/**
 * Wallet-agnostic transaction builders. Each returns `{ receiverId, actions }` in the
 * NEAR Connect / wallet-selector FunctionCall format. Account ids always come from the caller.
 */

import type { FunctionCallAction, LaunchConfig, Transaction } from "./types.ts";

const TGAS = 10n ** 12n;
export const ONE_YOCTO = "1";

/** Gas per call, in TGas. */
export const GAS_TGAS = {
  faucet: 30,
  storageDeposit: 30,
  buy: 250,
  sell: 150,
  redeem: 150,
  challenge: 50,
  defend: 50,
  fillAuction: 200,
  closeEpoch: 150,
  settleLaunch: 300,
  claimFees: 150,
  withdrawOwed: 150,
  createCoin: 300,
  /** Total budget for one transaction (protocol limit). */
  txLimit: 900, // protocol 88 allows 1 PGas per transaction
  /** Most gas one swap leg gets when it has the transaction to itself. */
  swapLegMax: 100,
} as const;

function gas(tgas: number): string {
  return (BigInt(tgas) * TGAS).toString();
}

export function functionCall(methodName: string, args: Record<string, unknown>, tgas: number, deposit = "0"): FunctionCallAction {
  return { type: "FunctionCall", params: { methodName, args, gas: gas(tgas), deposit } };
}

function tx(receiverId: string, ...actions: FunctionCallAction[]): Transaction {
  return { receiverId, actions };
}

// ---------- verifier (mock-intents) ----------

export function faucetTx(verifier: string, a: { token_id: string; amount: string; receiver_id?: string }): Transaction {
  const args: Record<string, unknown> = { token_id: a.token_id, amount: a.amount };
  if (a.receiver_id) args.receiver_id = a.receiver_id;
  return tx(verifier, functionCall("faucet", args, GAS_TGAS.faucet));
}

export type SwapLeg = {
  /** What the user pays with (usually USDC). */
  token_in: string;
  /** Upper bound sent; the swapper refunds the excess of an exact-output swap. */
  amount_in: string;
  want: string;
  amount_out: string;
  recipient?: string;
};

/** One exact-output swap: `verifier.mt_transfer_call` to the swapper with `{want, amount_out}`. */
export function swapLegAction(swapper: string, leg: SwapLeg, tgas: number): FunctionCallAction {
  const msg: Record<string, string> = { want: leg.want, amount_out: leg.amount_out };
  if (leg.recipient) msg.recipient = leg.recipient;
  return functionCall(
    "mt_transfer_call",
    { receiver_id: swapper, token_id: leg.token_in, amount: leg.amount_in, approval: null, memo: null, msg: JSON.stringify(msg) },
    tgas,
    ONE_YOCTO,
  );
}

/** Every swap leg in one transaction, gas split evenly within the 300 TGas limit. */
export function swapTx(verifier: string, swapper: string, legs: SwapLeg[]): Transaction {
  if (legs.length === 0) throw new Error("swapTx needs at least one leg");
  const per = Math.min(GAS_TGAS.swapLegMax, Math.floor(GAS_TGAS.txLimit / legs.length));
  return tx(verifier, ...legs.map((l) => swapLegAction(swapper, l, per)));
}

// ---------- coin ----------

export function storageDepositTx(coin: string, a: { deposit: string; account_id?: string }): Transaction {
  const args: Record<string, unknown> = { registration_only: true };
  if (a.account_id) args.account_id = a.account_id;
  return tx(coin, functionCall("storage_deposit", args, GAS_TGAS.storageDeposit, a.deposit));
}

export type BuyArgs = { token_ids: string[]; amounts: string[]; min_tokens_out: string; recipient?: string };

/** `verifier.mt_batch_transfer_call` to the coin with `{action: "buy"}`. */
export function buyTx(verifier: string, coin: string, a: BuyArgs): Transaction {
  if (a.token_ids.length !== a.amounts.length) throw new Error("token_ids and amounts differ in length");
  const msg: Record<string, string> = { action: "buy" };
  if (a.recipient) msg.recipient = a.recipient;
  msg.min_tokens_out = a.min_tokens_out;
  return tx(
    verifier,
    functionCall(
      "mt_batch_transfer_call",
      { receiver_id: coin, token_ids: a.token_ids, amounts: a.amounts, approvals: null, memo: null, msg: JSON.stringify(msg) },
      GAS_TGAS.buy,
      ONE_YOCTO,
    ),
  );
}

export function sellTx(coin: string, a: { amount: string; min_bu_out: string; receiver_id?: string }): Transaction {
  const args: Record<string, unknown> = { amount: a.amount, min_bu_out: a.min_bu_out };
  if (a.receiver_id) args.receiver_id = a.receiver_id;
  return tx(coin, functionCall("sell", args, GAS_TGAS.sell, ONE_YOCTO));
}

export function redeemTx(coin: string, a: { amount: string; receiver_id?: string }): Transaction {
  const args: Record<string, unknown> = { amount: a.amount };
  if (a.receiver_id) args.receiver_id = a.receiver_id;
  return tx(coin, functionCall("redeem", args, GAS_TGAS.redeem, ONE_YOCTO));
}

export function challengeTx(coin: string, a: { target: string; replacement: string; amount: string }): Transaction {
  return tx(coin, functionCall("challenge", { target: a.target, replacement: a.replacement, amount: a.amount }, GAS_TGAS.challenge, ONE_YOCTO));
}

export function defendTx(coin: string, a: { target: string; amount: string }): Transaction {
  return tx(coin, functionCall("defend", { target: a.target, amount: a.amount }, GAS_TGAS.defend, ONE_YOCTO));
}

/** `verifier.mt_transfer_call` of the replacement asset to the coin with `{action: "fill_auction"}`. */
export function fillAuctionTx(verifier: string, coin: string, a: { token_id: string; amount: string; min_out: string }): Transaction {
  return tx(
    verifier,
    functionCall(
      "mt_transfer_call",
      {
        receiver_id: coin,
        token_id: a.token_id,
        amount: a.amount,
        approval: null,
        memo: null,
        msg: JSON.stringify({ action: "fill_auction", min_out: a.min_out }),
      },
      GAS_TGAS.fillAuction,
      ONE_YOCTO,
    ),
  );
}

export function closeEpochTx(coin: string): Transaction {
  return tx(coin, functionCall("close_epoch", {}, GAS_TGAS.closeEpoch));
}

export function settleLaunchTx(coin: string, limit: number): Transaction {
  return tx(coin, functionCall("settle_launch", { limit }, GAS_TGAS.settleLaunch));
}

export function claimFeesTx(coin: string): Transaction {
  return tx(coin, functionCall("claim_fees", {}, GAS_TGAS.claimFees));
}

export function withdrawOwedTx(coin: string, account_id: string): Transaction {
  return tx(coin, functionCall("withdraw_owed", { account_id }, GAS_TGAS.withdrawOwed));
}

// ---------- factory ----------

export function createCoinTx(factory: string, config: LaunchConfig, launch_deposit: string): Transaction {
  return tx(factory, functionCall("create_coin", { config }, GAS_TGAS.createCoin, launch_deposit));
}
