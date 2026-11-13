import { describe, expect, it } from "vitest";
import { backedByLabel, backing, fill, splitBuy } from "./backing";

describe("backing", () => {
  it("splits the market cap into backed and hype", () => {
    const b = backing({ priceUsd: 0.00001, floorUsd: 0.000009, circulating: 50_000_000 });
    expect(b.mcapUsd).toBeCloseTo(500);
    expect(b.backedUsd).toBeCloseTo(450);
    expect(b.hypeUsd).toBeCloseTo(50);
    expect(b.share).toBeCloseTo(0.9);
  });
  it("never shows more backed than the price (a stale snapshot can put the floor above it)", () => {
    const b = backing({ priceUsd: 1, floorUsd: 1.2, circulating: 10 });
    expect(b.share).toBe(1);
    expect(b.hypeUsd).toBe(0);
  });
  it("is all zeros for a coin with nothing sold or no price", () => {
    expect(backing({ priceUsd: 0, floorUsd: 0, circulating: 0 })).toEqual({ mcapUsd: 0, backedUsd: 0, hypeUsd: 0, share: 0 });
    expect(backing({ priceUsd: NaN, floorUsd: 1, circulating: 5 }).share).toBe(0);
  });
});

describe("splitBuy", () => {
  it("says how much of a buy the floor backs", () => {
    const s = splitBuy(20, 17.8);
    expect(s.backed).toBeCloseTo(17.8);
    expect(s.above).toBeCloseTo(2.2);
    expect(s.share).toBeCloseTo(0.89);
  });
  it("caps the backed part at what was paid", () => {
    expect(splitBuy(10, 12)).toEqual({ backed: 10, above: 0, share: 1 });
  });
  it("handles an empty amount", () => {
    expect(splitBuy(0, 5)).toEqual({ backed: 0, above: 0, share: 0 });
    expect(splitBuy(5, NaN)).toEqual({ backed: 0, above: 5, share: 0 });
  });
});

describe("backedByLabel", () => {
  const r = (symbol: string, share: number) => ({ symbol, share });
  it("names assets biggest first", () => {
    expect(backedByLabel([r("SOL", 0.3), r("BTC", 0.7)])).toBe("BTC + SOL");
    expect(backedByLabel([r("A", 0.2), r("B", 0.5), r("C", 0.3)])).toBe("B + C + A");
  });
  it("shortens long baskets", () => {
    expect(backedByLabel([r("A", 0.1), r("B", 0.4), r("C", 0.3), r("D", 0.1), r("E", 0.1)])).toBe("B + C + 3 more");
  });
  it("handles an empty basket", () => {
    expect(backedByLabel([])).toBe("nothing yet");
  });
});

describe("fill", () => {
  it("clips a full-width bar to its share from either side", () => {
    expect(fill(90)).toEqual({ clipPath: "inset(0 10% 0 0)" });
    expect(fill(25, "right", 999)).toEqual({ clipPath: "inset(0 0 0 75% round 999px)" });
  });
  it("clamps out-of-range and missing values", () => {
    expect(fill(140).clipPath).toBe("inset(0 0% 0 0)");
    expect(fill(-5).clipPath).toBe("inset(0 100% 0 0)");
    expect(fill(NaN).clipPath).toBe("inset(0 100% 0 0)");
  });
});
