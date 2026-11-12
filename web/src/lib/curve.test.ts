import { describe, expect, it } from "vitest";
import { curvePriceAt, reserveAt, soldAtGraduation, tokensForNet } from "./curve";

const C = { x0: 5_000, y0: 1_073_000_000, grad: 20_000 };

describe("curve floats", () => {
  it("graduates at 858.4M tokens sold and 20,000 BU", () => {
    expect(soldAtGraduation(C)).toBeCloseTo(858_400_000, 0);
    expect(reserveAt(C, soldAtGraduation(C))).toBeCloseTo(20_000, 6);
  });
  it("matches the spec vector: 1,000 BU buys 178,833,333.33 tokens from zero", () => {
    expect(tokensForNet(C, 0, 0, 1_000).tokens).toBeCloseTo(178_833_333.33, 1);
  });
  it("prices the first token at x0 / y0 and caps a buy at graduation", () => {
    expect(curvePriceAt(C, 0)).toBeCloseTo(5_000 / 1_073_000_000, 15);
    expect(tokensForNet(C, 0, 0, 1e9)).toEqual({ tokens: soldAtGraduation(C), capped: true });
  });
  it("charges s per token on top of the curve", () => {
    expect(tokensForNet(C, 0, 1e-6, 1_000).tokens).toBeLessThan(tokensForNet(C, 0, 0, 1_000).tokens);
  });
});
