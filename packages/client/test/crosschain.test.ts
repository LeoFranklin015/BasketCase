import { describe, expect, it } from "vitest";
import { ORIGINS, mainnetAssetFor, planLegs, quoteRequest, summarizeQuote } from "../src/crosschain.ts";

describe("cross-chain preview (live 1Click dry quotes)", () => {
  it("maps testnet basket tokens to their mainnet NEAR Intents assets, or none", () => {
    expect(mainnetAssetFor("nep141:btc.mock")).toBe("nep141:nbtc.bridge.near");
    expect(mainnetAssetFor("nep141:sol.mock")).toBe("nep141:sol.omft.near");
    expect(mainnetAssetFor("nep141:bonk.mock")).toBeNull();
    expect(mainnetAssetFor("nep141:unknown.mock")).toBeNull();
  });

  it("splits a dollar amount across the basket by each asset's share of value", () => {
    // $20 from SOL at $80: 0.25 SOL = 250,000,000 lamports. A 50/50 basket gets half each.
    const legs = planLegs(20, 80, 9, [
      { token_id: "nep141:btc.mock", share: 0.5 },
      { token_id: "nep141:usdc.mock", share: 0.5 },
    ]);
    expect(legs.map((l) => l.amount)).toEqual(["125000000", "125000000"]);
    expect(legs[0]!.destination).toBe("nep141:nbtc.bridge.near");
  });

  it("builds a dry quote that pays from the origin chain into a NEAR Intents balance", () => {
    const origin = ORIGINS.find((o) => o.id === "sol")!;
    const r = quoteRequest(origin, "nep141:nbtc.bridge.near", "125000000", new Date("2026-11-12T19:00:00Z"));
    expect(r).toMatchObject({
      dry: true,
      swapType: "EXACT_INPUT",
      originAsset: "nep141:sol.omft.near",
      depositType: "ORIGIN_CHAIN",
      destinationAsset: "nep141:nbtc.bridge.near",
      amount: "125000000",
      refundType: "ORIGIN_CHAIN",
      recipientType: "INTENTS",
      deadline: "2026-11-12T19:10:00.000Z",
    });
  });

  it("reads a quote or names why there is no route", () => {
    expect(summarizeQuote({ quote: { amountOutFormatted: "0.0011", amountOutUsd: "81.3", timeEstimate: 20 } })).toEqual({
      status: "ok",
      amountOut: "0.0011",
      usdOut: 81.3,
      seconds: 20,
    });
    expect(summarizeQuote({ message: "No liquidity available" })).toEqual({ status: "no_liquidity", message: "No liquidity available" });
    expect(summarizeQuote({ message: "tokenIn is not valid" })).toEqual({ status: "error", message: "tokenIn is not valid" });
  });
});

describe("1Click prices in the contracts' unit (mainnet reporter and dollar figures)", () => {
  it("turns USD per whole token into USD per raw unit x 1e36", async () => {
    const { oneClickPricesE36 } = await import("../src/crosschain.ts");
    const rows = oneClickPricesE36(
      [
        { assetId: "nep141:usdc", decimals: 6, price: 1 },
        { assetId: "nep141:btc", decimals: 8, price: 100000 },
        { assetId: "nep141:junk", decimals: 6, price: 0 },
      ],
      ["nep141:btc", "nep141:usdc", "nep141:missing", "nep141:junk"],
    );
    // 1 USDC raw unit = 1e-6 USD -> 1e30; 1 BTC raw unit (1e-8 BTC) = 1e-3 USD -> 1e33.
    expect(rows).toEqual([
      ["nep141:btc", (10n ** 33n).toString()],
      ["nep141:usdc", (10n ** 30n).toString()],
    ]);
  });
});
