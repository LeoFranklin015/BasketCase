import { describe, expect, it } from "vitest";
import { base58Decode, intentsIdFor } from "./xbuy";
import { erc20TransferData, utf8Hex } from "../xwallets";

describe("cross-chain buy helpers", () => {
  it("maps a wallet address to its NEAR Intents account id", () => {
    expect(intentsIdFor("base", "0xAbCdEf0123456789abcdef0123456789ABCDEF01")).toBe("0xabcdef0123456789abcdef0123456789abcdef01");
    // The System Program's address is 32 zero bytes.
    expect(intentsIdFor("solana", "11111111111111111111111111111111")).toBe("0".repeat(64));
    expect(intentsIdFor("solana", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")).toMatch(/^[0-9a-f]{64}$/);
    expect(() => intentsIdFor("base", "0x123")).toThrow();
    expect(() => intentsIdFor("solana", "0OIl")).toThrow();
  });
  it("decodes base58 with leading zeros", () => {
    expect(Array.from(base58Decode("1112"))).toEqual([0, 0, 0, 1]);
  });
  it("builds ERC-20 transfer calldata", () => {
    const d = erc20TransferData("0x1111111111111111111111111111111111111111", 2_000_000n);
    expect(d).toBe("0xa9059cbb" + "0".repeat(24) + "1".repeat(40) + (2_000_000).toString(16).padStart(64, "0"));
  });
  it("hex-encodes the exact UTF-8 bytes MetaMask signs", () => {
    expect(utf8Hex('{"a":"é"}')).toBe("0x7b2261223a22c3a9227d");
  });
});
