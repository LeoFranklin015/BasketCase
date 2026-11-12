import { describe, expect, it } from "vitest";
import {
  auctionIn,
  buUsdNowE6,
  auctionOut,
  auctionRateAt,
  burnValueBu,
  epochStandings,
  floorPctOfCost,
  graduationProgress,
  tokensForBurnValue,
  type EpochView,
} from "../src/index.ts";

const E18 = 10n ** 18n;
const curve = { x0: (5_000n * E18).toString(), y0: (1_073_000_000n * E18).toString() };

describe("floorPctOfCost", () => {
  it("compares what the floor pays for your tokens with what you paid for them", () => {
    // 1,000 tokens bought for 10 BU; floor 0.005 BU per token -> 5 BU -> 50%.
    expect(floorPctOfCost([{ tokens: (1_000n * E18).toString(), bu: (10n * E18).toString() }], (5n * E18 / 1_000n).toString())).toBeCloseTo(50, 9);
  });

  it("adds up several buys", () => {
    const buys = [
      { tokens: (1_000n * E18).toString(), bu: (10n * E18).toString() },
      { tokens: (1_000n * E18).toString(), bu: (30n * E18).toString() },
    ];
    // 2,000 tokens at floor 0.01 = 20 BU vs 40 BU paid -> 50%.
    expect(floorPctOfCost(buys, (E18 / 100n).toString())).toBeCloseTo(50, 9);
  });

  it("is null without buys", () => {
    expect(floorPctOfCost([], "1")).toBeNull();
  });
});

describe("graduationProgress", () => {
  it("is the reserve as a share of the graduation reserve", () => {
    expect(graduationProgress({ mode: "curve", reserve: (5_000n * E18).toString() }, (20_000n * E18).toString())).toBeCloseTo(0.25, 9);
    expect(graduationProgress({ mode: "index", reserve: "1" }, (20_000n * E18).toString())).toBe(1);
  });
});

describe("burn value", () => {
  // State after the spec's two buys: R = 5,000 BU, sold = 536,500,000 tokens.
  const state = { mode: "curve" as const, reserve: (5_000n * E18).toString(), sold: "536500000000000000000000000", supply: "0" };

  it("in curve mode is what the curve would pay for the tokens (the spec's sell vector)", () => {
    expect(burnValueBu(state, curve, "178833333333333333333333333")).toBe((2_500n * E18 - 1n).toString());
  });

  it("finds the fewest tokens whose burn reaches a BU value", () => {
    const t = BigInt(tokensForBurnValue(state, curve, (2_500n * E18 - 1n).toString()));
    expect(BigInt(burnValueBu(state, curve, t.toString()))).toBeGreaterThanOrEqual(2_500n * E18 - 1n);
    expect(BigInt(burnValueBu(state, curve, (t - 1n).toString()))).toBeLessThan(2_500n * E18 - 1n);
  });

  it("in index mode is the tokens' share of the reserve", () => {
    const idx = { mode: "index" as const, reserve: (16_000n * E18).toString(), sold: "0", supply: (800_000_000n * E18).toString() };
    expect(burnValueBu(idx, curve, (1_000_000n * E18).toString())).toBe((20n * E18).toString());
    expect(tokensForBurnValue(idx, curve, (20n * E18).toString())).toBe((1_000_000n * E18).toString());
  });
});

describe("auction", () => {
  const view = { fair_rate: (2n * E18).toString(), start_ms: 1_000, ramp_end_ms: 1_100 };

  it("starts 20% above fair and falls linearly to fair, then stays (the curve-math vectors)", () => {
    expect(auctionRateAt(view, 2_000, 1_000)).toBe("2400000000000000000");
    expect(auctionRateAt(view, 2_000, 1_050)).toBe("2200000000000000000");
    expect(auctionRateAt(view, 2_000, 1_100)).toBe((2n * E18).toString());
    expect(auctionRateAt(view, 2_000, 9_999)).toBe((2n * E18).toString());
  });

  it("converts between replacement sent and target received at a rate, rounding toward the coin", () => {
    expect(auctionOut("1000", "2400000000000000000")).toBe("416");
    expect(auctionIn("416", "2400000000000000000")).toBe("999"); // 998.4 rounded up
  });
});

describe("epochStandings", () => {
  const epoch: EpochView = {
    index: 3,
    start_ms: 0,
    end_ms: 1,
    challenges: [
      { target: "usdc", replacement: "sol", burned_bu: "300", top_challenger: "a" },
      { target: "usdc", replacement: "doge", burned_bu: "500", top_challenger: "b" },
      { target: "eth", replacement: "pepe", burned_bu: "100", top_challenger: "c" },
    ],
    defenses: [
      { target: "usdc", burned_bu: "400" },
      { target: "eth", burned_bu: "0" },
    ],
    min_burn: [
      { target: "usdc", min_bu: "150" },
      { target: "eth", min_bu: "200" },
    ],
  };

  it("ranks challenges per target and says whether the leader beats the defense and the minimum", () => {
    const s = epochStandings(epoch);
    const usdc = s.targets.find((t) => t.target === "usdc")!;
    expect(usdc.challenges.map((c) => c.replacement)).toEqual(["doge", "sol"]);
    expect(usdc.defense).toBe("400");
    expect(usdc.min_bu).toBe("150");
    expect(usdc.leaderWins).toBe(true);
    const eth = s.targets.find((t) => t.target === "eth")!;
    expect(eth.leaderWins).toBe(false); // 100 < minimum of 200
    expect(s.winner).toEqual({ target: "usdc", replacement: "doge", burned_bu: "500", top_challenger: "b" });
  });

  it("has no winner when every leader is defended", () => {
    const s = epochStandings({ ...epoch, defenses: [{ target: "usdc", burned_bu: "500" }] });
    expect(s.winner).toBeNull(); // a tie goes to the defense: the tally must be greater
  });
});

describe("buUsdNowE6", () => {
  const basket = [
    { token_id: "btc", q: "5" },
    { token_id: "usdc", q: "5000" },
  ];

  it("values one BU at current prices from what a buyer sends per BU", () => {
    // 5 sats at $0.001 + 5,000 micro-USDC at $0.000001 = $0.01 -> 10,000 (x1e6).
    expect(buUsdNowE6(basket, { btc: (10n ** 33n).toString(), usdc: (10n ** 30n).toString() })).toBe(10_000);
    // BTC doubles: $0.015.
    expect(buUsdNowE6(basket, { btc: (2n * 10n ** 33n).toString(), usdc: (10n ** 30n).toString() })).toBe(15_000);
  });

  it("is null when any basket asset has no price", () => {
    expect(buUsdNowE6(basket, { btc: (10n ** 33n).toString() })).toBeNull();
  });
});
