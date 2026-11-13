import { describe, expect, it } from "vitest";
import { AVATAR_SHAPES, avatarSpec, displayName, hash32, isTestTrader } from "./avatar";

describe("hash32", () => {
  it("is FNV-1a", () => {
    expect(hash32("")).toBe(0x811c9dc5);
    expect(hash32("a")).toBe(0xe40c292c);
  });
});

describe("avatarSpec", () => {
  it("is stable per account and ignores case", () => {
    expect(avatarSpec("trader2.backedlab.testnet")).toEqual(avatarSpec("Trader2.backedlab.testnet"));
  });
  it("varies across accounts", () => {
    const specs = ["trader1", "trader2", "trader3", "alice", "bob", "keeper"].map((n) => JSON.stringify(avatarSpec(`${n}.backedlab.testnet`)));
    expect(new Set(specs).size).toBeGreaterThan(3);
  });
  it("only uses known shapes and 45-degree turns", () => {
    for (let i = 0; i < 50; i++) {
      const s = avatarSpec(`user${i}.testnet`);
      expect(AVATAR_SHAPES).toContain(s.shape);
      expect(s.rotate % 45).toBe(0);
      expect(s.bg).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("displayName", () => {
  it("uses the first part of a named account", () => {
    expect(displayName("trader2.backedlab.testnet")).toBe("trader2");
    expect(displayName("leo.testnet")).toBe("leo");
  });
  it("shortens implicit accounts and long names", () => {
    expect(displayName("a".repeat(60) + "beef")).toBe("aaaaaa…beef");
    expect(displayName("averyveryverylongaccountname.testnet")).toBe("averyveryverylon…");
  });
});

describe("isTestTrader", () => {
  it("flags our own testnet accounts only", () => {
    expect(isTestTrader("trader1.backedlab.testnet")).toBe(true);
    expect(isTestTrader("keeper.backedlab.testnet")).toBe(true);
    expect(isTestTrader("bob.testnet")).toBe(false);
    expect(isTestTrader("someone.backedlab.testnet")).toBe(false);
  });
});
