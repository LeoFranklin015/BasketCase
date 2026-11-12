import { describe, expect, it } from "vitest";
import { decimalToScaled, priceE36, qFor } from "../src/lib.js";

describe("unit conversions shared with the contracts", () => {
  it("scales decimal strings exactly", () => {
    expect(decimalToScaled("1.5", 6)).toBe(1_500_000n);
    expect(decimalToScaled("0.00001", 18)).toBe(10_000_000_000_000n);
  });

  it("prices USDC at $1 as 1e30 per micro-unit and BTC at $100k as 1e33 per sat", () => {
    expect(priceE36("1", 6)).toBe(10n ** 30n);
    expect(priceE36("100000", 8)).toBe(10n ** 33n);
    // PEPE: $0.00001 per token, 18 decimals -> 1e-23 USD per raw unit -> 1e13.
    expect(priceE36("0.00001", 18)).toBe(10n ** 13n);
  });

  it("sizes a basket unit: a $1 BU that is half BTC holds 500 sats", () => {
    expect(qFor(5_000, "1", "100000", 8)).toBe(500n);
    // Half USDC at $1, 6 dp: 500,000 micro-USDC.
    expect(qFor(5_000, "1", "1", 6)).toBe(500_000n);
    // A $0.01 BU that is half BTC: $0.005 = 5 sats. A $0.0001 BU needs 0.05 sats: rounds up to 1.
    expect(qFor(5_000, "0.01", "100000", 8)).toBe(5n);
    expect(qFor(5_000, "0.0001", "100000", 8)).toBe(1n);
  });
});
