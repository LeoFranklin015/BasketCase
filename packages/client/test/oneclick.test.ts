import { describe, expect, it } from "vitest";
import { generateIntentBody, intentsSwapQuote, submitIntentBody } from "../src/oneclick.ts";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

describe("1Click swaps paid from an Intents balance (mainnet)", () => {
  it("asks for an exact basket amount, paid and delivered inside NEAR Intents", () => {
    const q = intentsSwapQuote({ from: USDC, to: "nep141:nbtc.bridge.near", amountOut: "1500", account: "alice.near", now: new Date("2026-11-12T19:00:00Z") });
    expect(q).toEqual({
      dry: false,
      swapType: "EXACT_OUTPUT",
      slippageTolerance: 100,
      originAsset: USDC,
      depositType: "INTENTS",
      destinationAsset: "nep141:nbtc.bridge.near",
      amount: "1500",
      refundTo: "alice.near",
      refundType: "INTENTS",
      recipient: "alice.near",
      recipientType: "INTENTS",
      deadline: "2026-11-12T19:10:00.000Z",
    });
  });

  it("generates the intent for a NEAR wallet (NEP-413) or an EVM wallet (ERC-191)", () => {
    expect(generateIntentBody("dep-1", "alice.near", "nep413")).toEqual({ type: "swap_transfer", standard: "nep413", signerId: "alice.near", depositAddress: "dep-1" });
    expect(generateIntentBody("dep-1", "0xabc", "erc191").standard).toBe("erc191");
  });

  it("submits the signed payload exactly as signed", () => {
    const signed = { standard: "nep413", payload: { message: "{}", nonce: "AA==", recipient: "intents.near" }, public_key: "ed25519:x", signature: "ed25519:y" };
    expect(submitIntentBody(signed)).toEqual({ type: "swap_transfer", signedData: signed });
  });
});

describe("1Click price for a basket leg (mainnet quote_in)", () => {
  it("asks for a dry exact-output quote and returns the input it needs", async () => {
    const { oneClickQuoteIn } = await import("../src/oneclick.ts");
    const calls: { url: string; body: any }[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ quote: { depositAddress: "d", amountIn: "20450000", amountOut: "30000", deadline: "x" } }), { status: 200 });
    }) as typeof fetch;
    try {
      expect(await oneClickQuoteIn(USDC, "nep141:nbtc.bridge.near", "30000", "alice.near")).toBe("20450000");
    } finally {
      globalThis.fetch = orig;
    }
    expect(calls[0]!.url).toMatch(/\/v0\/quote$/);
    expect(calls[0]!.body).toMatchObject({ dry: true, swapType: "EXACT_OUTPUT", depositType: "INTENTS", amount: "30000", recipientType: "INTENTS" });
  });
});

describe("checking a 1Click intent before anyone signs it", () => {
  const dep = "e7699997474e7e5b8d8e2bf5ed970f80632c136d067f87d00cf5e009bcaea332";
  const me = "5b61d5ca436c03fa8d7c0b0ec2125aaeb201469b8beb99d19bed37167f124c52";
  const msg = (o: object) => JSON.stringify({ deadline: "2026-11-16T16:58:13.139Z", intents: [{ intent: "transfer", receiver_id: dep, tokens: { [USDC]: "3478432" } }], signer_id: me, ...o });
  const payload = (message: string, recipient = "intents.near") => ({ message, nonce: "AA==", recipient });
  const want = { account: me, depositAddress: dep, from: USDC, maxIn: "3478432", verifier: "intents.near" };

  it("accepts exactly one transfer of at most the quoted input to the deposit address (real 1Click shape)", async () => {
    const { checkSwapIntent } = await import("../src/oneclick.ts");
    expect(() => checkSwapIntent(payload(msg({})), want)).not.toThrow();
  });

  it("rejects anything else", async () => {
    const { checkSwapIntent } = await import("../src/oneclick.ts");
    const bad = [
      payload(msg({}), "evil.near"),
      payload(msg({ signer_id: "someone.near" })),
      payload(msg({ intents: [{ intent: "transfer", receiver_id: "thief.near", tokens: { [USDC]: "3478432" } }] })),
      payload(msg({ intents: [{ intent: "transfer", receiver_id: dep, tokens: { [USDC]: "3478433" } }] })),
      payload(msg({ intents: [{ intent: "transfer", receiver_id: dep, tokens: { [USDC]: "1", "nep141:other": "5" } }] })),
      payload(msg({ intents: [{ intent: "ft_withdraw", receiver_id: dep, tokens: { [USDC]: "1" } }] })),
      payload(msg({ intents: [] })),
      payload("not json"),
    ];
    for (const p of bad) expect(() => checkSwapIntent(p, want)).toThrow(/refusing to sign/);
  });
});
