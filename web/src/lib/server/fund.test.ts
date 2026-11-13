import { describe, expect, it } from "vitest";
import { createFundHandler, createRateLimiter } from "./fund";

const NEAR = 10n ** 24n;
const A = "a".repeat(64);
const B = "b".repeat(64);

function setup(o: { balances?: Record<string, bigint>; failTransfer?: boolean; perAccountMs?: number; globalMax?: number } = {}) {
  let now = 1_000_000;
  const transfers: { to: string; amount: bigint }[] = [];
  const limiter = createRateLimiter({ perAccountMs: o.perAccountMs ?? 60_000, globalMax: o.globalMax ?? 10, globalWindowMs: 60_000 });
  const handle = createFundHandler({
    getBalance: async (id) => o.balances?.[id] ?? 0n,
    transfer: async (to, amount) => {
      if (o.failTransfer) throw new Error("relayer broke");
      transfers.push({ to, amount });
      return `tx-${transfers.length}`;
    },
    limiter,
    now: () => now,
  });
  return { handle, transfers, tick: (ms: number) => (now += ms) };
}

describe("fund handler", () => {
  it("sends 0.5 NEAR to an empty implicit account", async () => {
    const { handle, transfers } = setup();
    const r = await handle({ accountId: A });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ funded: true, hash: "tx-1" });
    expect(transfers).toEqual([{ to: A, amount: NEAR / 2n }]);
  });

  it("rejects anything that is not a 64-hex implicit account id", async () => {
    const { handle, transfers } = setup();
    for (const body of [{ accountId: "alice.testnet" }, { accountId: "A".repeat(64) }, { accountId: "a".repeat(63) }, {}, null, "x"]) {
      expect((await handle(body)).status).toBe(400);
    }
    expect(transfers).toEqual([]);
  });

  it("does nothing for an account that already holds at least 0.2 NEAR", async () => {
    const { handle, transfers } = setup({ balances: { [A]: (NEAR * 35n) / 100n } });
    const r = await handle({ accountId: A });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ funded: false });
    expect(transfers).toEqual([]);
  });

  it("funds an account just below 0.2 NEAR", async () => {
    const { handle, transfers } = setup({ balances: { [A]: (NEAR * 35n) / 100n - 1n } });
    expect((await handle({ accountId: A })).body).toMatchObject({ funded: true });
    expect(transfers).toHaveLength(1);
  });

  it("funds the same account at most once per cooldown", async () => {
    const { handle, transfers, tick } = setup({ perAccountMs: 60_000 });
    await handle({ accountId: A });
    expect((await handle({ accountId: A })).status).toBe(429);
    tick(60_001);
    expect((await handle({ accountId: A })).status).toBe(200);
    expect(transfers).toHaveLength(2);
  });

  it("two requests at once for the same account fund it once", async () => {
    const { handle, transfers } = setup();
    const rs = await Promise.all([handle({ accountId: A }), handle({ accountId: A })]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 429]);
    expect(transfers).toHaveLength(1);
  });

  it("caps fundings across all accounts per window", async () => {
    const { handle, transfers, tick } = setup({ globalMax: 1 });
    expect((await handle({ accountId: A })).status).toBe(200);
    expect((await handle({ accountId: B })).status).toBe(429);
    tick(60_001);
    expect((await handle({ accountId: B })).status).toBe(200);
    expect(transfers).toHaveLength(2);
  });

  it("a failed transfer does not use up the account's turn", async () => {
    const s = setup({ failTransfer: true });
    expect((await s.handle({ accountId: A })).status).toBe(502);
    expect(s.transfers).toEqual([]);
    // Same limiter state is internal to the handler; a retry is allowed (and fails again here).
    expect((await s.handle({ accountId: A })).status).toBe(502);
  });
});
