import { describe, expect, it } from "vitest";
import { inferReplacement } from "./graves";

const tomb = (token_id: string, joined_epoch: number, removed_epoch: number) => ({ token_id, joined_epoch, removed_epoch, challenger: "t.testnet", rate: "1", ts_ms: 0 });

// Mirrors $CHIPS on testnet: BTC -> ETH (epoch 3), SOL -> DOGE (11), ETH -> SOL (14), DOGE -> ETH (19), SOL -> DOGE (23).
const tombs = [tomb("btc", 0, 3), tomb("sol", 0, 11), tomb("eth", 3, 14), tomb("doge", 11, 19), tomb("sol", 14, 23)];
const basket = [
  { token_id: "nvda", joined_epoch: 0 },
  { token_id: "eth", joined_epoch: 19 },
  { token_id: "doge", joined_epoch: 23 },
];

describe("inferReplacement", () => {
  it("finds a replacement still in the basket", () => {
    expect(inferReplacement(tombs[4]!, basket, tombs)).toBe("doge");
  });
  it("finds a replacement that was itself voted out later", () => {
    expect(inferReplacement(tombs[0]!, basket, tombs)).toBe("eth");
    expect(inferReplacement(tombs[1]!, basket, tombs)).toBe("doge");
    expect(inferReplacement(tombs[2]!, basket, tombs)).toBe("sol");
  });
  it("returns null when nothing joined that epoch", () => {
    expect(inferReplacement(tomb("x", 0, 99), basket, tombs)).toBeNull();
  });
});
