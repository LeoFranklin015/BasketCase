// Gas money for new Privy (implicit) accounts: pure logic behind POST /api/fund.
// The route wires real RPC calls into createFundHandler; tests pass fakes.

const NEAR = 10n ** 24n;
/** Sent to an account that is below MIN_BALANCE. */
export const FUND_AMOUNT = NEAR / 2n; // 0.5 NEAR: the first buy alone costs ~0.25 (storage deposit with the coin + gas)
/** Accounts at or above this need nothing. Gas is prepaid per transaction (up to ~0.03 NEAR for 300 TGas) and mostly refunded. */
export const MIN_BALANCE = (NEAR * 35n) / 100n; // 0.35 NEAR

const IMPLICIT = /^[0-9a-f]{64}$/;

export type RateLimiter = {
  /** Reserve a funding for this account now. False when the account or the whole faucet is over its limit. */
  take: (accountId: string, now: number) => boolean;
  /** Give back a reservation whose transfer failed. */
  release: (accountId: string, now: number) => void;
};

/** In-memory limits: one funding per account per `perAccountMs`, at most `globalMax` per `globalWindowMs`. */
export function createRateLimiter(o: { perAccountMs: number; globalMax: number; globalWindowMs: number }): RateLimiter {
  const lastByAccount = new Map<string, number>();
  let recent: number[] = [];
  return {
    take(accountId, now) {
      recent = recent.filter((t) => now - t < o.globalWindowMs);
      const last = lastByAccount.get(accountId);
      if (last !== undefined && now - last < o.perAccountMs) return false;
      if (recent.length >= o.globalMax) return false;
      lastByAccount.set(accountId, now);
      recent.push(now);
      return true;
    },
    release(accountId, now) {
      if (lastByAccount.get(accountId) === now) lastByAccount.delete(accountId);
      const i = recent.lastIndexOf(now);
      if (i >= 0) recent.splice(i, 1);
    },
  };
}

export type FundDeps = {
  /** Balance in yoctoNEAR; 0 for an account that does not exist yet. */
  getBalance: (accountId: string) => Promise<bigint>;
  /** Send `amount` yoctoNEAR and return the transaction hash. */
  transfer: (accountId: string, amount: bigint) => Promise<string>;
  limiter: RateLimiter;
  now: () => number;
};

export type FundResponse = { status: number; body: Record<string, unknown> };

export function createFundHandler(d: FundDeps) {
  return async function handle(input: unknown): Promise<FundResponse> {
    const accountId = (input as { accountId?: unknown } | null)?.accountId;
    if (typeof accountId !== "string" || !IMPLICIT.test(accountId)) {
      return { status: 400, body: { error: "accountId must be a NEAR implicit account (64 lowercase hex characters)." } };
    }
    const balance = await d.getBalance(accountId);
    if (balance >= MIN_BALANCE) return { status: 200, body: { funded: false, balance: balance.toString() } };

    const now = d.now();
    if (!d.limiter.take(accountId, now)) {
      return { status: 429, body: { error: "This account was funded recently, or the faucet is busy. Try again later." } };
    }
    try {
      const hash = await d.transfer(accountId, FUND_AMOUNT);
      return { status: 200, body: { funded: true, hash, amount: FUND_AMOUNT.toString() } };
    } catch (e) {
      d.limiter.release(accountId, now);
      return { status: 502, body: { error: `Funding failed: ${e instanceof Error ? e.message : String(e)}` } };
    }
  };
}
