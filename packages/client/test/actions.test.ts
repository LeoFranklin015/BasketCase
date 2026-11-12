import { describe, expect, it } from "vitest";
import {
  buyTx,
  challengeTx,
  claimFeesTx,
  closeEpochTx,
  createCoinTx,
  defendTx,
  faucetTx,
  fillAuctionTx,
  redeemTx,
  sellTx,
  settleLaunchTx,
  storageDepositTx,
  swapTx,
  withdrawOwedTx,
  type Transaction,
} from "../src/index.ts";

const TGAS = 10n ** 12n;
const VERIFIER = "intents.testnet";
const SWAPPER = "swapper.testnet";
const COIN = "degen-1.factory.testnet";

/** The single action of a one-action transaction, with `msg` parsed for comparison. */
function only(tx: Transaction) {
  expect(tx.actions).toHaveLength(1);
  const a = tx.actions[0]!;
  expect(a.type).toBe("FunctionCall");
  const args = { ...a.params.args };
  if (typeof args.msg === "string") args.msg = JSON.parse(args.msg);
  return { receiverId: tx.receiverId, method: a.params.methodName, args, gas: BigInt(a.params.gas), deposit: a.params.deposit };
}

describe("coin actions", () => {
  it("buys by sending the quoted basket to the coin through the verifier, 1 yocto and 250 TGas", () => {
    const tx = buyTx(VERIFIER, COIN, {
      token_ids: ["nep141:btc.mock", "nep141:usdc.mock"],
      amounts: ["500", "5000"],
      min_tokens_out: "100",
    });
    expect(only(tx)).toEqual({
      receiverId: VERIFIER,
      method: "mt_batch_transfer_call",
      args: {
        receiver_id: COIN,
        token_ids: ["nep141:btc.mock", "nep141:usdc.mock"],
        amounts: ["500", "5000"],
        approvals: null,
        memo: null,
        msg: { action: "buy", min_tokens_out: "100" },
      },
      gas: 250n * TGAS,
      deposit: "1",
    });
  });

  it("includes the recipient in the buy msg only when given", () => {
    const tx = buyTx(VERIFIER, COIN, { token_ids: ["a"], amounts: ["1"], min_tokens_out: "0", recipient: "bob.testnet" });
    expect(only(tx).args.msg).toEqual({ action: "buy", recipient: "bob.testnet", min_tokens_out: "0" });
  });

  it("sells, redeems, challenges and defends with 1 yocto on the coin", () => {
    expect(only(sellTx(COIN, { amount: "10", min_bu_out: "9" }))).toMatchObject({
      receiverId: COIN, method: "sell", args: { amount: "10", min_bu_out: "9" }, deposit: "1",
    });
    expect(only(sellTx(COIN, { amount: "10", min_bu_out: "9", receiver_id: "bob.testnet" })).args).toEqual({
      amount: "10", min_bu_out: "9", receiver_id: "bob.testnet",
    });
    expect(only(redeemTx(COIN, { amount: "7" }))).toMatchObject({ receiverId: COIN, method: "redeem", args: { amount: "7" }, deposit: "1" });
    expect(only(challengeTx(COIN, { target: "nep141:usdc.mock", replacement: "nep141:sol.mock", amount: "3" }))).toMatchObject({
      receiverId: COIN, method: "challenge", args: { target: "nep141:usdc.mock", replacement: "nep141:sol.mock", amount: "3" }, deposit: "1",
    });
    expect(only(defendTx(COIN, { target: "nep141:usdc.mock", amount: "4" }))).toMatchObject({
      receiverId: COIN, method: "defend", args: { target: "nep141:usdc.mock", amount: "4" }, deposit: "1",
    });
  });

  it("calls the permissionless maintenance methods with no deposit", () => {
    expect(only(closeEpochTx(COIN))).toMatchObject({ receiverId: COIN, method: "close_epoch", args: {}, deposit: "0" });
    expect(only(settleLaunchTx(COIN, 25))).toMatchObject({ receiverId: COIN, method: "settle_launch", args: { limit: 25 }, deposit: "0" });
    expect(only(claimFeesTx(COIN))).toMatchObject({ receiverId: COIN, method: "claim_fees", args: {}, deposit: "0" });
    expect(only(withdrawOwedTx(COIN, "bob.testnet"))).toMatchObject({ method: "withdraw_owed", args: { account_id: "bob.testnet" }, deposit: "0" });
  });

  it("registers storage with the coin's minimum deposit", () => {
    expect(only(storageDepositTx(COIN, { deposit: "1250000000000000000000", account_id: "bob.testnet" }))).toMatchObject({
      receiverId: COIN,
      method: "storage_deposit",
      args: { account_id: "bob.testnet", registration_only: true },
      deposit: "1250000000000000000000",
    });
  });

  it("fills an auction by sending the replacement asset to the coin through the verifier", () => {
    expect(only(fillAuctionTx(VERIFIER, COIN, { token_id: "nep141:sol.mock", amount: "1000", min_out: "990" }))).toMatchObject({
      receiverId: VERIFIER,
      method: "mt_transfer_call",
      args: {
        receiver_id: COIN,
        token_id: "nep141:sol.mock",
        amount: "1000",
        approval: null,
        memo: null,
        msg: { action: "fill_auction", min_out: "990" },
      },
      deposit: "1",
    });
  });
});

describe("verifier and swapper actions", () => {
  it("mints test tokens from the verifier faucet", () => {
    expect(only(faucetTx(VERIFIER, { token_id: "nep141:usdc.mock", amount: "100000000" }))).toMatchObject({
      receiverId: VERIFIER, method: "faucet", args: { token_id: "nep141:usdc.mock", amount: "100000000" }, deposit: "0",
    });
  });

  it("puts one exact-output swap leg per asset in a single transaction within the 1 PGas transaction limit", () => {
    const legs = Array.from({ length: 9 }, (_, i) => ({
      token_in: "nep141:usdc.mock",
      amount_in: String(1000 + i),
      want: `nep141:t${i}.mock`,
      amount_out: String(10 + i),
    }));
    const tx = swapTx(VERIFIER, SWAPPER, legs);
    expect(tx.receiverId).toBe(VERIFIER);
    expect(tx.actions).toHaveLength(9);
    const total = tx.actions.reduce((s, a) => s + BigInt(a.params.gas), 0n);
    expect(total <= 900n * TGAS).toBe(true);
    expect(BigInt(tx.actions[0]!.params.gas)).toBe(100n * TGAS);
    const first = tx.actions[0]!.params;
    expect(first.methodName).toBe("mt_transfer_call");
    expect(first.deposit).toBe("1");
    expect({ ...first.args, msg: JSON.parse(first.args.msg as string) }).toEqual({
      receiver_id: SWAPPER,
      token_id: "nep141:usdc.mock",
      amount: "1000",
      approval: null,
      memo: null,
      msg: { want: "nep141:t0.mock", amount_out: "10" },
    });
  });

  it("refuses an empty swap", () => {
    expect(() => swapTx(VERIFIER, SWAPPER, [])).toThrow();
  });
});

describe("factory actions", () => {
  it("creates a coin with the factory's launch deposit and 300 TGas", () => {
    const config = {
      ticker: "DEGEN",
      name: "Degen",
      icon: null,
      basket: [{ token_id: "nep141:btc.mock", weight_bps: 10_000, q: "1", anchored: true }],
      fee_bps: 100,
      epoch_profile: "demo" as const,
      bu_usd_e6: 10_000,
      creator: null,
    };
    expect(only(createCoinTx("factory.testnet", config, "3500000000000000000000000"))).toEqual({
      receiverId: "factory.testnet",
      method: "create_coin",
      args: { config },
      gas: 300n * TGAS,
      deposit: "3500000000000000000000000",
    });
  });
});
