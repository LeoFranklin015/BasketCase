import { describe, expect, it } from "vitest";
import { computeQ, usdToPriceE36, validateLaunch, type LaunchConfig } from "../src/index.ts";

describe("usdToPriceE36", () => {
  it("turns dollars per whole token into dollars per raw unit scaled by 1e36", () => {
    expect(usdToPriceE36("100000", 8)).toBe(10n ** 33n); // BTC: $100,000 / 1e8 sats
    expect(usdToPriceE36("1", 6)).toBe(10n ** 30n); // USDC
    expect(usdToPriceE36("0.00001", 18)).toBe(10n ** 13n); // PEPE
  });
});

describe("computeQ", () => {
  // 1 BU = $0.01 (bu_usd_e6 = 10,000).
  it("gives the raw amount of an asset a buyer sends per BU", () => {
    // 50% of $0.01 in BTC at $100,000 is 5e-8 BTC = 5 sats.
    expect(computeQ({ weight_bps: 5_000, bu_usd_e6: 10_000, price_e36: 10n ** 33n })).toBe("5");
    // 50% of $0.01 in USDC is $0.005 = 5,000 micro-USDC.
    expect(computeQ({ weight_bps: 5_000, bu_usd_e6: 10_000, price_e36: 10n ** 30n })).toBe("5000");
    // 25% of $0.01 in PEPE at $0.00001 is 250 PEPE.
    expect(computeQ({ weight_bps: 2_500, bu_usd_e6: 10_000, price_e36: 10n ** 13n })).toBe("250000000000000000000");
  });

  it("rounds up", () => {
    // 33.33% of $0.01 in SOL at $180 is 18,516.67 lamports-of-1e9 -> 18,517.
    expect(computeQ({ weight_bps: 3_333, bu_usd_e6: 10_000, price_e36: usdToPriceE36("180", 9) })).toBe("18517");
  });

  it("refuses a missing or zero price", () => {
    expect(() => computeQ({ weight_bps: 5_000, bu_usd_e6: 10_000, price_e36: 0n })).toThrow(/price/);
  });
});

describe("validateLaunch", () => {
  const good: LaunchConfig = {
    ticker: "DEGEN",
    name: "Degen",
    icon: null,
    basket: [
      { token_id: "nep141:btc.mock", weight_bps: 5_000, q: "5", anchored: true },
      { token_id: "nep141:usdc.mock", weight_bps: 5_000, q: "5000", anchored: false },
    ],
    fee_bps: 100,
    epoch_profile: "demo",
    bu_usd_e6: 10_000,
    creator: null,
  };

  it("accepts a config the factory accepts", () => {
    expect(validateLaunch(good)).toEqual([]);
  });

  it("reports each rule the factory checks", () => {
    expect(validateLaunch({ ...good, ticker: "degen" })).toContainEqual(expect.stringMatching(/ticker/i));
    expect(validateLaunch({ ...good, ticker: "D" })).toContainEqual(expect.stringMatching(/ticker/i));
    expect(validateLaunch({ ...good, ticker: "ABCDEFGHIJK" })).toContainEqual(expect.stringMatching(/ticker/i));
    expect(validateLaunch({ ...good, fee_bps: 20 })).toContainEqual(expect.stringMatching(/fee/i));
    expect(validateLaunch({ ...good, fee_bps: 101 })).toContainEqual(expect.stringMatching(/fee/i));
    expect(validateLaunch({ ...good, basket: [] })).toContainEqual(expect.stringMatching(/1 to 9/));
    expect(validateLaunch({ ...good, basket: [good.basket[0]!, { ...good.basket[0]!, weight_bps: 5_000 }] })).toContainEqual(
      expect.stringMatching(/twice/i),
    );
    expect(validateLaunch({ ...good, basket: [{ ...good.basket[0]!, weight_bps: 6_000 }, good.basket[1]!] })).toContainEqual(
      expect.stringMatching(/10,000/),
    );
    expect(validateLaunch({ ...good, basket: [{ ...good.basket[0]!, q: "0" }, good.basket[1]!] })).toContainEqual(expect.stringMatching(/q/));
    expect(validateLaunch({ ...good, name: " " })).toContainEqual(expect.stringMatching(/name/i));
  });
});
