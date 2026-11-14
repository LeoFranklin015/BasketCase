import { describe, expect, it } from "vitest";
import { routableSet, topGraduated, type RawMeme } from "./memecooking";

const row = (o: Partial<RawMeme>): RawMeme => ({ meme_id: 1, symbol: "X", name: "X", image: "Qm", deposit_token_id: "wrap.near", total_deposit: "0", staker_count: 1, token_id: null, pool_id: null, ...o });

describe("meme.cooking", () => {
  it("keeps graduated memes only, biggest raise first, in NEAR", () => {
    const out = topGraduated(
      [
        row({ meme_id: 1, symbol: "A", total_deposit: "5000000000000000000000000", token_id: "a-1.meme-cooking.near", pool_id: 7 }),
        row({ meme_id: 2, symbol: "B", total_deposit: "82554694081586914685182791736", token_id: "b-2.meme-cooking.near", pool_id: 8 }),
        row({ meme_id: 3, symbol: "C", total_deposit: "999999999999999999999999999999", token_id: null, pool_id: null }),
      ],
      new Set(["nep141:a-1.meme-cooking.near"]),
    );
    expect(out.map((m) => m.symbol)).toEqual(["B", "A"]);
    expect(out[0]!.raisedNear).toBeCloseTo(82554.69, 1);
    expect(out[1]!.raisedNear).toBe(5);
    expect(out[0]!.url).toBe("https://meme.cooking/meme/2");
    expect(out.map((m) => m.routable)).toEqual([false, true]);
  });

  it("always includes routable memes beyond the top n", () => {
    const rows = [1, 2, 3].map((i) => row({ meme_id: i, symbol: `M${i}`, total_deposit: String(10 - i), token_id: `m-${i}.meme-cooking.near`, pool_id: i }));
    const out = topGraduated(rows, new Set(["nep141:m-3.meme-cooking.near"]), 1);
    expect(out.map((m) => m.symbol)).toEqual(["M1", "M3"]);
  });

  it("counts a token as routable only with a price above zero", () => {
    const s = routableSet([{ assetId: "nep141:a", price: 0.5 }, { assetId: "nep141:b", price: 0 }, { assetId: "nep141:c", price: "0" }]);
    expect([...s]).toEqual(["nep141:a"]);
  });
});
