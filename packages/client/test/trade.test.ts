import { describe, expect, it } from "vitest";
import { planBuy, prepareBuy, planSell, usdToBu, type BackedReader, type BuyQuote } from "../src/index.ts";

const VERIFIER = "intents.testnet";
const SWAPPER = "swapper.testnet";
const COIN = "degen-1.factory.testnet";
const USDC = "nep141:usdc.mock";
const BTC = "nep141:btc.mock";
const E18 = 10n ** 18n;

const quote: BuyQuote = {
  bu_in: (500n * E18).toString(),
  fee: (5n * E18).toString(),
  net: (495n * E18).toString(),
  tokens_out: "1000000",
  unused: "0",
  graduates: false,
  queued: false,
  token_ids: [BTC, USDC],
  amounts: ["500", "5000000"],
};

const base = {
  verifier: VERIFIER,
  swapper: SWAPPER,
  coin: COIN,
  account_id: "alice.testnet",
  pay_token: USDC,
  quote,
  storage_min: "1250000000000000000000",
  slippage_bps: 100,
  swap_pad_bps: 100,
};

describe("usdToBu", () => {
  it("converts a dollar amount to BU at the coin's BU size", () => {
    expect(usdToBu("5", 10_000)).toBe((500n * E18).toString()); // $5 at $0.01 per BU
    expect(usdToBu("0.5", 5_000)).toBe((100n * E18).toString()); // $0.50 at $0.005 per BU
  });
});

describe("planBuy (two-step buy)", () => {
  it("swaps only the shortfall of each non-USDC asset, then registers and buys", () => {
    const plan = planBuy({
      ...base,
      balances: { [BTC]: "200", [USDC]: "10000000" },
      quoteIns: { [BTC]: "350000" },
      registered: false,
    });

    // Step 1: one exact-output leg for the 300 sats missing, paid in USDC with a 1% refundable pad.
    expect(plan.swapLegs).toEqual([{ token_in: USDC, amount_in: "353500", want: BTC, amount_out: "300" }]);
    expect(plan.step1?.receiverId).toBe(VERIFIER);
    expect(plan.step1?.actions).toHaveLength(1);

    // Step 2: storage_deposit on the coin, then the buy through the verifier with the quote's exact amounts.
    expect(plan.step2.map((t) => [t.receiverId, t.actions[0]!.params.methodName])).toEqual([
      [COIN, "storage_deposit"],
      [VERIFIER, "mt_batch_transfer_call"],
    ]);
    const buyArgs = plan.step2[1]!.actions[0]!.params.args;
    expect(buyArgs.token_ids).toEqual([BTC, USDC]);
    expect(buyArgs.amounts).toEqual(["500", "5000000"]);
    expect(JSON.parse(buyArgs.msg as string)).toEqual({ action: "buy", min_tokens_out: "990000" });

    // USDC needed: 353,500 for the swap + 5,000,000 sent directly.
    expect(plan.payTotal).toBe("5353500");
    expect(plan.payShortfall).toBe("0");
  });

  it("skips step 1 and storage when the user already holds the basket and is registered", () => {
    const plan = planBuy({
      ...base,
      balances: { [BTC]: "500", [USDC]: "5000000" },
      quoteIns: {},
      registered: true,
    });
    expect(plan.step1).toBeNull();
    expect(plan.step2.map((t) => t.actions[0]!.params.methodName)).toEqual(["mt_batch_transfer_call"]);
  });

  it("reports how much USDC is missing", () => {
    const plan = planBuy({ ...base, balances: {}, quoteIns: { [BTC]: "40000" }, registered: true });
    // 40,000 * 1.01 = 40,400 for the swap + 5,000,000 direct = 5,040,400, none held.
    expect(plan.payTotal).toBe("5040400");
    expect(plan.payShortfall).toBe("5040400");
  });

  it("sets no minimum output for a buy queued in the fair-launch window", () => {
    const plan = planBuy({ ...base, quote: { ...quote, queued: true }, balances: { [BTC]: "500", [USDC]: "5000000" }, quoteIns: {}, registered: true });
    expect(JSON.parse(plan.step2[0]!.actions[0]!.params.args.msg as string)).toEqual({ action: "buy", min_tokens_out: "0" });
  });

  it("throws when a needed swap has no quote", () => {
    expect(() => planBuy({ ...base, balances: {}, quoteIns: {}, registered: true })).toThrow(/quote/);
  });
});

describe("prepareBuy", () => {
  it("reads the quote, balances, registration and swap prices, then plans the buy", async () => {
    const seen: string[] = [];
    const reader = {
      coin: (id: string) => ({
        quoteBuy: async (bu_in: string) => (seen.push(`quote_buy ${id} ${bu_in}`), quote),
        storageBalanceOf: async (a: string) => (seen.push(`storage_balance_of ${a}`), null),
        storageBalanceBounds: async () => ({ min: "1250000000000000000000", max: null }),
      }),
      verifier: {
        mtBatchBalanceOf: async (a: string, ids: string[]) => (seen.push(`balances ${a} ${ids.join(",")}`), ids.map((i) => (i === BTC ? "200" : "10000000"))),
      },
      swapper: {
        quoteIn: async (tin: string, tout: string, out: string) => (seen.push(`quote_in ${tin} ${tout} ${out}`), "350000"),
      },
    } as unknown as BackedReader;

    const plan = await prepareBuy(reader, {
      verifier: VERIFIER,
      swapper: SWAPPER,
      coin: COIN,
      account_id: "alice.testnet",
      pay_token: USDC,
      bu_in: quote.bu_in,
      slippage_bps: 100,
    });

    expect(seen).toContain(`quote_buy ${COIN} ${quote.bu_in}`);
    expect(seen).toContain(`quote_in ${USDC} ${BTC} 300`);
    expect(plan.swapLegs[0]!.amount_out).toBe("300");
    expect(plan.step2[0]!.actions[0]!.params.methodName).toBe("storage_deposit");
  });
});

describe("planSell", () => {
  it("sells with a minimum BU out below the quote by the slippage", () => {
    const tx = planSell(COIN, { amount: "1000", gross_bu: "0", fee: "0", out_bu: "20000", path: "curve", token_ids: [], amounts: [] }, 50);
    expect(tx.actions[0]!.params.args).toEqual({ amount: "1000", min_bu_out: "19900" });
  });
});
