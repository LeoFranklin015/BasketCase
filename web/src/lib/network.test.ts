import { afterEach, describe, expect, it, vi } from "vitest";
import { parseNetwork } from "./network";

describe("testnet / mainnet switch (NEXT_PUBLIC_NETWORK)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("defaults to testnet and only accepts mainnet explicitly", () => {
    expect(parseNetwork(undefined)).toBe("testnet");
    expect(parseNetwork("")).toBe("testnet");
    expect(parseNetwork("MAINNET")).toBe("mainnet");
    expect(parseNetwork("main")).toBe("testnet");
  });

  it("testnet reads deployments/testnet.json with free test tokens and the stand-in swapper", async () => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK", "testnet");
    const c = await import("./config");
    expect(c.deployment.network).toBe("testnet");
    expect(c.NET.testTokens).toBe(true);
    expect(c.NET.swapRoute).toBe("mock-swapper");
    expect(c.EXPLORER_TX("abc")).toBe("https://testnet.nearblocks.io/txns/abc");
    expect(c.NOT_DEPLOYED).toBe(false);
  });

  it("mainnet reads deployments/mainnet.json: intents.near, real assets, 1Click swaps, no faucet", async () => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK", "mainnet");
    const c = await import("./config");
    expect(c.deployment.network).toBe("mainnet");
    expect(c.deployment.verifier).toBe("intents.near");
    expect(c.PAY_TOKEN_ID).toBe("nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1");
    expect(c.NET.testTokens).toBe(false);
    expect(c.NET.swapRoute).toBe("oneclick");
    expect(c.EXPLORER_ACCOUNT("x.near")).toBe("https://nearblocks.io/address/x.near");
    // Mainnet runs one coin deployed directly (no factory): the app lists it instead of "not live yet".
    expect(c.NOT_DEPLOYED).toBe(false);
    expect(c.DIRECT_COINS.map((x) => x.account_id)).toContain("degen.basketcase.near");
  });
});
