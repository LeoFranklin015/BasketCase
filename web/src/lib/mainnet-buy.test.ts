import { describe, expect, it } from "vitest";
import { swapLegsViaOneClick } from "./mainnet-buy";

const leg = (want: string) => ({ token_in: "nep141:usdc", amount_in: "1000", want, amount_out: "5" });
const payload = { message: "{}", nonce: btoa(String.fromCharCode(...new Array(32).fill(1))), recipient: "intents.near" };

function deps(over: Partial<Parameters<typeof swapLegsViaOneClick>[1]> = {}) {
  const sent: string[] = [];
  const signed: unknown[] = [];
  return {
    sent,
    signed,
    d: {
      account: "alice.near",
      signNep413: async (p: typeof payload) => {
        signed.push(p);
        return { standard: "nep413" as const, payload: p, public_key: "ed25519:K", signature: "ed25519:S" };
      },
      send: async (_txs: unknown[], title: string) => void sent.push(title),
      swap: (async (o: { sign: (i: unknown) => Promise<object> }) => {
        await o.sign({ standard: "nep413", payload });
        return { depositAddress: "dep", intentHash: `ih-${signed.length}`, amountIn: "1000" };
      }) as never,
      wait: async () => "SUCCESS",
      hasPublicKey: async () => true,
      ...over,
    },
  };
}

describe("mainnet buy: basket legs through 1Click", () => {
  it("signs one NEP-413 intent per leg and returns their hashes", async () => {
    const { d, signed } = deps();
    const steps: string[] = [];
    expect(await swapLegsViaOneClick([leg("nep141:a"), leg("nep141:b")], d, (s) => steps.push(s))).toEqual(["ih-1", "ih-2"]);
    expect(signed).toHaveLength(2);
    expect(steps[0]).toMatch(/swap 1 of 2/);
  });

  it("registers a named account's key with NEAR Intents before its first intent", async () => {
    const { d, sent } = deps({ hasPublicKey: async () => false });
    await swapLegsViaOneClick([leg("nep141:a")], d, () => {});
    expect(sent).toEqual(["Let your key sign NEAR Intents swaps"]);
  });

  it("stops before the coin when a swap does not settle", async () => {
    const { d } = deps({ wait: async () => "REFUNDED" });
    await expect(swapLegsViaOneClick([leg("nep141:a"), leg("nep141:b")], d, () => {})).rejects.toThrow(/ended as REFUNDED. Nothing was sent to the coin/);
  });
});
