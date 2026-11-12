import { describe, expect, it } from "vitest";
import { formatUnits, parseUnits, formatCompact, formatSig, formatTiny, buToUsd, priceUsd } from "../src/index.ts";

describe("parseUnits / formatUnits", () => {
  it("parses a decimal string into raw units with the given decimals", () => {
    expect(parseUnits("1.5", 18)).toBe(1_500_000_000_000_000_000n);
    expect(parseUnits("0.000001", 6)).toBe(1n);
    expect(parseUnits("42", 8)).toBe(4_200_000_000n);
  });

  it("rejects more fractional digits than the token has", () => {
    expect(() => parseUnits("0.0000001", 6)).toThrow(/decimals/);
  });

  it("rejects input that is not a plain non-negative decimal", () => {
    expect(() => parseUnits("-1", 18)).toThrow();
    expect(() => parseUnits("1e5", 18)).toThrow();
    expect(() => parseUnits("", 18)).toThrow();
  });

  it("formats raw units back to a trimmed decimal string", () => {
    expect(formatUnits(1_500_000_000_000_000_000n, 18)).toBe("1.5");
    expect(formatUnits("178833333333333333333333333", 18)).toBe("178833333.333333333333333333");
    expect(formatUnits(0n, 6)).toBe("0");
    expect(formatUnits(1n, 6)).toBe("0.000001");
  });

  it("can cut the fraction to a fixed number of digits, rounding down", () => {
    expect(formatUnits("178833333333333333333333333", 18, { maxFraction: 2 })).toBe("178833333.33");
    expect(formatUnits(1_999_999n, 6, { maxFraction: 2 })).toBe("1.99");
  });
});

describe("human-readable numbers", () => {
  it("formats large token amounts compactly", () => {
    expect(formatCompact(178_833_333.33)).toBe("178.8M");
    expect(formatCompact(858_400_000)).toBe("858.4M");
    expect(formatCompact(12_345)).toBe("12.3K");
    expect(formatCompact(999)).toBe("999");
    expect(formatCompact(0.5)).toBe("0.5");
  });

  it("formats tiny prices with significant digits instead of zeros", () => {
    // P0 = 5,000 / 1,073,000,000 BU per token.
    expect(formatSig(0.000004659832246039, 4)).toBe("0.000004660");
    expect(formatSig(1234.5678, 4)).toBe("1,235");
    expect(formatSig(0, 4)).toBe("0");
  });
});

describe("dollar estimates", () => {
  it("converts BU (1e18) to dollars with the coin's launch BU size", () => {
    // 20,000 BU at $0.01 per BU is $200.
    expect(buToUsd(20_000n * 10n ** 18n, 10_000)).toBeCloseTo(200, 9);
  });

  it("converts a BU-per-token price (1e18) to dollars per token", () => {
    // 4,659,832,246,039 is P0 scaled by 1e18; at $0.01 per BU that is $4.66e-8 per token.
    expect(priceUsd("4659832246039", 10_000)).toBeCloseTo(4.659832246039e-8, 18);
  });
});

describe("formatTiny", () => {
  it("writes the run of zeros as a subscript count, the way DEX screens do", () => {
    expect(formatTiny(4.659832246039e-8)).toBe("0.0₇4660");
    expect(formatTiny(0.000004659832)).toBe("0.0₅4660");
    expect(formatTiny(1.16495806150978e-4)).toBe("0.0₃1165");
  });

  it("leaves ordinary numbers alone", () => {
    expect(formatTiny(0.0123)).toBe("0.01230");
    expect(formatTiny(1.5)).toBe("1.5");
    expect(formatTiny(0)).toBe("0");
  });
});
