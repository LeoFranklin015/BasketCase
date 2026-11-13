import { describe, expect, it } from "vitest";
import { assetColor } from "./assets";

describe("assetColor", () => {
  it("uses each asset's own colour", () => {
    expect(assetColor("BTC")).toBe("#f7931a");
    expect(assetColor("sol")).toBe("#9945ff");
  });
  it("gives unknown symbols a stable colour that is never the floor yellow", () => {
    expect(assetColor("ZZZ")).toBe(assetColor("zzz"));
    for (const s of ["ABC", "QQ", "MOON", "XYZ1"]) expect(assetColor(s).toLowerCase()).not.toBe("#ffd400");
  });
});
