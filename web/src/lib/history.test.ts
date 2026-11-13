import type { LogEntry } from "@backed/client";
import { describe, expect, it } from "vitest";
import { FIXTURE_COINS } from "./fixture/world";
import { autoLogScale, changeLabel, changeOver, mergeSources, parseEventLog, pickTimeframe, rebuildFloor, sparkPoints, toCandles, tradesFromEvents, tradesFromLog, type Trade } from "./history";

// A real log line from demo1283-0.pad.backedlab.testnet (pool sell, Nov 12 2026).
const SELL_LOG =
  'EVENT_JSON:{"standard":"backed","version":"1.0.0","event":"sell","data":[{"account_id":"alice.backedlab.testnet","tokens":"1000000000000000000000000","bu_out":"114035694551332155135","fee":"1151875702538708638","path":"pool","price_after":"112060092928507"}]}';
const NEP141_LOG = 'EVENT_JSON:{"standard":"nep141","version":"1.0.0","event":"ft_transfer","data":[{"old_owner_id":"a","new_owner_id":"b","amount":"1"}]}';

function trade(p: Partial<Trade> & Pick<Trade, "ts" | "kind" | "price">): Trade {
  return { seq: 0, account: "a.testnet", tokens: 1, bu: 1, fee: null, floor: null, ...p };
}

describe("parseEventLog", () => {
  it("reads backed events and ignores other standards and plain logs", () => {
    expect(parseEventLog(SELL_LOG)).toEqual([
      { event: "sell", data: expect.objectContaining({ account_id: "alice.backedlab.testnet", path: "pool", price_after: "112060092928507" }) },
    ]);
    expect(parseEventLog(NEP141_LOG)).toEqual([]);
    expect(parseEventLog("Transfer 1 from a to b")).toEqual([]);
    expect(parseEventLog("EVENT_JSON:{not json")).toEqual([]);
  });
});

describe("tradesFromEvents", () => {
  it("turns a sell into a trade with gross BU, whole tokens and the price after", () => {
    const [t] = tradesFromEvents(parseEventLog(SELL_LOG).map((e, i) => ({ ...e, ts: 1_000, seq: i, tx: "DGid" })));
    expect(t).toMatchObject({ kind: "sell", path: "pool", account: "alice.backedlab.testnet", tokens: 1_000_000, tx: "DGid" });
    expect(t!.bu).toBeCloseTo(114.035694551 + 1.151875702, 6);
    expect(t!.price).toBeCloseTo(0.000112060092928507, 15);
  });

  it("sorts newest first and keeps event order inside one block", () => {
    const ev = (event: string, ts: number, seq: number) => ({ event, ts, seq, data: { account_id: "x", tokens: "1", tokens_out: "1", bu: "1", bu_in: "1", price_after: "1" } });
    const out = tradesFromEvents([ev("buy", 5, 1), ev("burn", 5, 2), ev("sell", 9, 3), ev("auction_opened", 9, 4), ev("auction_fill", 10, 5)]);
    expect(out.map((t) => t.kind)).toEqual(["fill", "sell", "burn", "buy"]);
    expect(out[0]).toMatchObject({ tokens: 0, bu: 0, price: null });
  });
});

describe("rebuildFloor", () => {
  // The fixture simulator emits the same events as the contract and knows the exact floor after each.
  for (const c of FIXTURE_COINS.filter((x) => x.sim.history.length > 5)) {
    it(`matches the exact floor through every trade of $${c.config.ticker}`, () => {
      const st = c.sim.stateView({ launch: c.launch, epoch: { index: 0, start_ms: 0, end_ms: 0 }, auction_open: false });
      const trades = rebuildFloor(tradesFromEvents(c.sim.history.map((h) => h.ev)), st, c.config);
      const exact = new Map(c.sim.history.map((h) => [h.ev.seq, Number(h.floor) / 1e18]));
      let checked = 0;
      for (const t of trades) {
        const want = exact.get(t.seq)!;
        expect(t.floor, `${t.kind} at seq ${t.seq}`).not.toBeNull();
        expect(Math.abs(t.floor! - want) / want).toBeLessThan(1e-6);
        expect(t.price).not.toBeNull();
        // On the curve no price is below the floor; a graduated pool can trade under it (sells then redeem).
        if (t.path !== "pool" && t.kind !== "redeem" && !(t.kind === "burn" && t.ts > (c.sim.graduatedMs ?? Infinity))) {
          expect(t.floor!).toBeLessThanOrEqual(t.price! * (1 + 1e-9));
        }
        checked++;
      }
      expect(checked).toBe(c.sim.history.length);
    });
  }

  it("never lets the floor fall over time in a fixture coin", () => {
    const c = FIXTURE_COINS.find((x) => x.config.ticker === "DEGEN")!;
    const st = c.sim.stateView({ launch: c.launch, epoch: { index: 0, start_ms: 0, end_ms: 0 }, auction_open: false });
    const asc = rebuildFloor(tradesFromEvents(c.sim.history.map((h) => h.ev)), st, c.config).reverse();
    for (let i = 1; i < asc.length; i++) expect(asc[i]!.floor! / asc[i - 1]!.floor!).toBeGreaterThan(1 - 1e-9);
  });
});

describe("tradesFromLog and mergeSources", () => {
  const log: LogEntry[] = [
    { ts_ms: 300, kind: "burn", account_id: "b", tokens: "2000000000000000000", bu: "1", reason: "challenge", price_after: "5" },
    { ts_ms: 200, kind: "burn", account_id: "a", tokens: "1000000000000000000", bu: "1", reason: "sell", price_after: "4" },
    { ts_ms: 100, kind: "mint", account_id: "a", tokens: "3000000000000000000", bu: "1", reason: "buy", price_after: "6" },
  ];
  it("maps reasons to kinds", () => {
    expect(tradesFromLog(log).map((t) => [t.kind, t.reason ?? null])).toEqual([
      ["burn", "challenge"],
      ["sell", null],
      ["buy", null],
    ]);
  });
  it("keeps log trades only outside the range the events cover", () => {
    const chain = [trade({ ts: 200, kind: "sell", price: 4, tx: "h" })];
    const merged = mergeSources(chain, { from: 150, to: 250 }, tradesFromLog(log));
    expect(merged.map((t) => [t.ts, t.tx ?? null])).toEqual([
      [300, null],
      [200, "h"],
      [100, null],
    ]);
    expect(mergeSources([], null, tradesFromLog(log))).toHaveLength(3);
  });
});

describe("toCandles", () => {
  const newestFirst = [
    trade({ ts: 185_000, kind: "sell", price: 9, bu: 2, floor: 3 }),
    trade({ ts: 125_000, kind: "burn", price: 11, bu: 50, floor: 3 }),
    trade({ ts: 70_000, kind: "buy", price: 12, bu: 4, floor: 2 }),
    trade({ ts: 61_000, kind: "buy", price: 10, bu: 1, floor: 2 }),
    trade({ ts: 5_000, kind: "redeem", price: null, bu: 9 }),
  ];
  it("opens each bucket at the previous close and counts only trades as volume", () => {
    expect(toCandles(newestFirst, 60)).toEqual([
      { time: 60, open: 10, high: 12, low: 10, close: 12, volume: 5, buyVolume: 5, floor: 2, trades: 2, burns: 0 },
      { time: 120, open: 12, high: 12, low: 11, close: 11, volume: 0, buyVolume: 0, floor: 3, trades: 0, burns: 1 },
      { time: 180, open: 11, high: 11, low: 9, close: 9, volume: 2, buyVolume: 0, floor: 3, trades: 1, burns: 0 },
    ]);
  });
  it("picks a timeframe that fits the span", () => {
    expect(pickTimeframe(newestFirst)).toBe("1m");
    expect(pickTimeframe([trade({ ts: 30 * 86_400_000, kind: "buy", price: 1 }), trade({ ts: 0, kind: "buy", price: 1 })])).toBe("1D");
  });
});

describe("changeOver and sparkPoints", () => {
  const day = 86_400_000;
  const t = [trade({ ts: 2 * day, kind: "buy", price: 3 }), trade({ ts: day / 2, kind: "buy", price: 2 }), trade({ ts: 0, kind: "buy", price: 1 })];
  it("compares against the last trade before the window", () => {
    expect(changeOver(t, 2 * day, 3)).toEqual({ pct: 50, sinceLaunch: false });
  });
  it("falls back to the first trade for a coin younger than the window", () => {
    expect(changeOver(t.slice(1), day / 2 + 1000, 2)).toEqual({ pct: 100, sinceLaunch: true });
    expect(changeOver([], 0, 1)).toBeNull();
  });
  it("with a partial history, measures from the oldest loaded trade and says how long ago that was", () => {
    // Only the newest trades loaded: the oldest one loaded is not the launch price.
    expect(changeOver(t.slice(1), day / 2 + 1000, 2, day, false)).toEqual({ pct: 100, sinceLaunch: false, fromMs: 0 });
    // A trade before the window is enough, even from a partial history.
    expect(changeOver(t, 2 * day, 3, day, false)).toEqual({ pct: 50, sinceLaunch: false });
  });
  it("labels the change in plain words", () => {
    const h = 3_600_000;
    expect(changeLabel({ pct: 1, sinceLaunch: true }, 0)).toBe("since launch");
    expect(changeLabel({ pct: 1, sinceLaunch: false }, 0)).toBe("in 24h");
    expect(changeLabel({ pct: 1, sinceLaunch: false, fromMs: 0 }, 14 * h + 5)).toBe("in 14h");
    expect(changeLabel({ pct: 1, sinceLaunch: false, fromMs: 0 }, 20 * 60_000)).toBe("in 20m");
    expect(changeLabel(null, 0)).toBe("in 24h");
  });
  it("samples the last price in each bucket", () => {
    const pts = sparkPoints(t, 2 * day, day, 4);
    expect(pts.map((p) => p.p)).toEqual([2, 2, 2, 3]);
  });
});

describe("axisPrices", async () => {
  const { axisPrices } = await import("./money");
  it("shares one subscript count across ticks and blanks negatives", () => {
    expect(axisPrices([2.4e-7, 1.6e-7, 8e-8, -2e-8], "usd")).toEqual(["$0.0₆2400", "$0.0₆1600", "$0.0₆0800", ""]);
    expect(axisPrices([1.5, 0.25], "bu")).toEqual(["1.5", "0.2500"]);
  });
});

describe("autoLogScale", () => {
  const c = (low: number, high: number, floor: number | null = null) => ({ low, high, floor });
  it("stays linear for an ordinary range", () => {
    expect(autoLogScale([c(1, 2, 0.9), c(1.5, 3, 1)])).toBe(false);
  });
  it("switches to log when prices span more than 20x, floor included", () => {
    expect(autoLogScale([c(1, 2), c(30, 40)])).toBe(true);
    expect(autoLogScale([c(10, 12, 0.3)])).toBe(true);
  });
  it("ignores empty, zero and missing values", () => {
    expect(autoLogScale([])).toBe(false);
    expect(autoLogScale([c(0, 5, null)])).toBe(false);
  });
});
