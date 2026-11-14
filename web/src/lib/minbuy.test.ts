import { describe, expect, it } from "vitest";
import { minBuyUsd } from "./minbuy";

const NV = "nep141:bnb-0xa9ee28c80f960b889dfbd1902055218cba016f75.omdep.near";
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

describe("smallest buy", () => {
  it("is the largest leg minimum divided by that leg's share", () => {
    expect(minBuyUsd([{ token_id: NV, share: 1 }], "mainnet")).toBe(7); // 6.5 → $7
    expect(minBuyUsd([{ token_id: NV, share: 0.5 }, { token_id: "nep141:vvv", share: 0.5 }], "mainnet")).toBe(13);
    expect(minBuyUsd([{ token_id: NV, share: 0.25 }, { token_id: "x", share: 0.75 }], "mainnet")).toBe(26);
  });
  it("ignores USDC (no swap), uses measured minimums, and never goes below $1", () => {
    // $DEGEN: 50% BTC (fills from $0.10) + 50% USDC → $1.
    expect(minBuyUsd([{ token_id: "nep141:nbtc.bridge.near", share: 0.5 }, { token_id: USDC, share: 0.5 }], "mainnet")).toBe(1);
    expect(minBuyUsd([{ token_id: USDC, share: 1 }], "mainnet")).toBe(1);
    // Unmeasured assets keep about $1.15 per swap: half the basket → $3.
    expect(minBuyUsd([{ token_id: "nep141:unmeasured", share: 0.5 }, { token_id: USDC, share: 0.5 }], "mainnet")).toBe(3);
  });
  it("is zero on testnet", () => {
    expect(minBuyUsd([{ token_id: NV, share: 0.5 }], "testnet")).toBe(0);
  });
});
