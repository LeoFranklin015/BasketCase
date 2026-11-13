import { describe, expect, it } from "vitest";
import type { CoinSummary } from "../../../lib/data";
import { coinStatus, expectedFloor } from "./status";

describe("expectedFloor", () => {
  it("matches a real $DEGEN get_state before graduation (curve low price plus surplus per token)", () => {
    // degen-0.pad.backedlab.testnet get_state, Nov 13 2026.
    const st = {
      mode: "curve" as const,
      reserve: "428389084866971434855",
      surplus: "364618507196478513862",
      sold: "84677328923176267341215322",
      supply: "84677328923176267341215322",
    };
    expect(expectedFloor(st)).toBe(8965807786756n);
  });

  it("is reserve / supply after graduation", () => {
    const st = { mode: "index" as const, reserve: "1000000000000000000000", surplus: "0", sold: "0", supply: "2000000000000000000000000" };
    expect(expectedFloor(st)).toBe(500000000000000n);
  });

  it("is the curve's lowest price when nothing is sold", () => {
    const st = { mode: "launch" as const, reserve: "0", surplus: "0", sold: "0", supply: "0" };
    // 5,000 BU / 1.073B tokens, x 1e18.
    expect(expectedFloor(st)).toBe((5000n * 10n ** 36n) / (1073000000n * 10n ** 18n));
  });
});

describe("coinStatus", () => {
  // degen-0.pad.backedlab.testnet get_state, Nov 13 2026 (same numbers as above).
  const state = {
    mode: "curve" as const,
    reserve: "428389084866971434855",
    surplus: "364618507196478513862",
    creator_owed: "71360274823329433519",
    protocol_owed: "28544109929331773365",
    pool_bu: "0",
    pool_tokens: "0",
    sold: "84677328923176267341215322",
    supply: "84677328923176267341215322",
    circulating: "84677328923176267341215322",
    b_total: "892911976816111155601",
    price: "9798502671509",
    floor: "8965807786756",
    surplus_per_token: "4305975540717",
    launch: { ends_ms: 0, queued_accounts: 0, queued_bu: "0", settled: true },
    epoch: { index: 120, start_ms: 0, end_ms: 0 },
    auction_open: false,
    graduated_ms: null,
  };
  const summary = {
    info: { account_id: "degen-0.pad.backedlab.testnet", ticker: "DEGEN", name: "Degen", creator: "c.testnet", created_ms: 0 },
    config: { ticker: "DEGEN", bu_usd_e6: 1_000_000 } as CoinSummary["config"],
    state,
    basket: [{ token_id: "nep141:btc.mock", q: "1000", held: "0", anchored: true, weight_bps: 5000, joined_epoch: 0 }],
  } satisfies CoinSummary;

  it("reports stage, price, floor, vault, supply and backed share in plain units", () => {
    const c = coinStatus(summary, {}, 0, () => "BTC");
    expect(c).toMatchObject({ id: "degen-0.pad.backedlab.testnet", ticker: "DEGEN", stage: "Growing", access_keys: 0, basket: ["BTC"], usd_source: "launch" });
    expect(c.price).toBeCloseTo(9.798502671509e-6, 15);
    expect(c.floor).toBeCloseTo(8.965807786756e-6, 15);
    expect(c.vault_bu).toBeCloseTo(892.911976816111, 9);
    expect(c.supply).toBeCloseTo(84_677_328.923176, 3);
    expect(c.backed_pct).toBe(91.5);
    expect(c.floor_matches_formula).toBe(true);
    // Launch BU price is $1, so dollars equal BU here.
    expect(c.floor_usd).toBeCloseTo(c.floor, 15);
  });

  it("flags a floor that does not follow from the state", () => {
    const c = coinStatus({ ...summary, state: { ...state, floor: "1" } }, {}, null, () => "BTC");
    expect(c.floor_matches_formula).toBe(false);
    expect(c.access_keys).toBeNull();
  });
});
