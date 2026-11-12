/** A BackedReader over the fixture world. Every view returns data shaped like docs/interface.md. */

import type { BackedReader, BasketEntry, BuyQuote, CoinReader, SellQuote } from "@backed/client";
import { curveBuy, curveSell, E18, feeOf, poolBuy, poolSell } from "./curve";
import { priceE36 } from "./sim";
import { FIXTURE_COINS, FIXTURE_FACTORY, FIXTURE_USER, queuedTokensEstimate, reporterPrices, type FixtureCoin } from "./world";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const delay = <T,>(v: T): Promise<T> => new Promise((r) => setTimeout(() => r(clone(v)), 60));

function find(id: string): FixtureCoin {
  const c = FIXTURE_COINS.find((x) => x.info.account_id === id);
  if (!c) throw new Error(`${id}.get_state: fixture has no such coin (UNKNOWN_ACCOUNT)`);
  return c;
}

function basket(c: FixtureCoin): BasketEntry[] {
  const b = c.sim.basketView(c.basketSpec, c.config.bu_usd_e6, c.heldOverride);
  const bTotal = c.sim.bTotal();
  return b.map((e) =>
    c.heldOverride?.[e.token_id] !== undefined ? { ...e, q: ((BigInt(e.held) * E18 + bTotal - 1n) / bTotal).toString() } : e,
  );
}

function state(c: FixtureCoin) {
  return c.sim.stateView({
    launch: c.launch,
    epoch: { index: c.epoch.index, start_ms: c.epoch.start_ms, end_ms: c.epoch.end_ms },
    auction_open: c.auction !== null,
  });
}

function quoteBuy(c: FixtureCoin, bu_in: string): BuyQuote {
  const buIn = BigInt(bu_in);
  const fee = feeOf(buIn, c.config.fee_bps);
  const net = buIn - fee;
  const sim = c.sim;
  let tokens = 0n;
  let unused = 0n;
  let graduates = false;
  const queued = sim.mode === "launch";
  if (queued) tokens = queuedTokensEstimate(BigInt(c.launch.queued_bu), net);
  else if (sim.mode === "index") tokens = poolBuy(sim.poolBu, sim.poolTokens, net);
  else {
    const b = curveBuy(sim.c, sim.st, net);
    tokens = b.tokens;
    unused = b.unused;
    graduates = b.graduates;
  }
  const entries = basket(c);
  return {
    bu_in,
    fee: fee.toString(),
    net: net.toString(),
    tokens_out: tokens.toString(),
    unused: unused.toString(),
    graduates,
    queued,
    token_ids: entries.map((e) => e.token_id),
    amounts: entries.map((e) => ((buIn * BigInt(e.q) + E18 - 1n) / E18).toString()),
  };
}

function quoteSell(c: FixtureCoin, amount: string): SellQuote {
  const t = BigInt(amount);
  const sim = c.sim;
  let gross: bigint;
  let path: SellQuote["path"] = "curve";
  let fee: bigint;
  if (sim.mode === "index") {
    const poolGross = poolSell(sim.poolBu, sim.poolTokens, t);
    const poolOut = poolGross - feeOf(poolGross, c.config.fee_bps);
    const redeemGross = (t * sim.st.reserve) / sim.supply;
    const redeemOut = redeemGross - feeOf(redeemGross, 50);
    if (poolOut >= redeemOut) {
      path = "pool";
      gross = poolGross;
      fee = poolGross - poolOut;
    } else {
      path = "redeem";
      gross = redeemGross;
      fee = redeemGross - redeemOut;
    }
  } else {
    const s = curveSell(sim.c, sim.st, t);
    gross = s.curveOut + s.surplusOut;
    fee = feeOf(gross, c.config.fee_bps);
  }
  const out = gross - fee;
  const bTotal = sim.bTotal();
  const entries = basket(c);
  return {
    amount,
    gross_bu: gross.toString(),
    fee: fee.toString(),
    out_bu: out.toString(),
    path,
    token_ids: entries.map((e) => e.token_id),
    amounts: entries.map((e) => ((BigInt(e.held) * out) / bTotal).toString()),
  };
}

function coinReader(id: string): CoinReader {
  return {
    accountId: id,
    getConfig: async () => delay(find(id).config),
    getState: async () => delay(state(find(id))),
    getBasket: async () => delay(basket(find(id))),
    quoteBuy: async (bu_in) => delay(quoteBuy(find(id), bu_in)),
    quoteSell: async (amount) => delay(quoteSell(find(id), amount)),
    getEpoch: async () => delay(find(id).epoch),
    getAuction: async () => delay(find(id).auction),
    getPrices: async () => delay(reporterPrices()),
    getTombstones: async (from, limit) => delay(find(id).tombstones.slice(from, from + limit)),
    getLog: async () => delay(find(id).sim.log.slice(0, 100)),
    getLaunchQueue: async (from, limit) => delay(find(id).queue.slice(from, from + limit)),
    getOwed: async () => delay([]),
    ftBalanceOf: async (account) => delay((find(id).sim.balances.get(account) ?? 0n).toString()),
    ftTotalSupply: async () => delay(find(id).sim.supply.toString()),
    ftMetadata: async () => {
      const c = find(id);
      return delay({ spec: "ft-1.0.0", name: c.config.name, symbol: c.config.ticker, icon: null, reference: null, reference_hash: null, decimals: 18 });
    },
    storageBalanceOf: async (account) => delay(find(id).registered.has(account) ? { total: "1250000000000000000000", available: "0" } : null),
    storageBalanceBounds: async () => delay({ min: "1250000000000000000000", max: "1250000000000000000000" }),
  };
}

const USER_BALANCES: Record<string, string> = {
  "nep141:usdc.mock": "25000000", // 25 USDC
  "nep141:sol.mock": "300000000", // 0.3 SOL
};

const KNOWN_TOKENS = [
  "nep141:usdc.mock", "nep141:btc.mock", "nep141:eth.mock", "nep141:sol.mock", "nep141:pepe.mock",
  "nep141:doge.mock", "nep141:wif.mock", "nep141:bonk.mock", "nep141:nvda.mock",
];

export const fixtureReader: BackedReader = {
  listCoins: async (from, limit) => delay(FIXTURE_COINS.slice(from, from + limit).map((c) => c.info)),
  listAllCoins: async () => delay(FIXTURE_COINS.map((c) => c.info)),
  getCoin: async (account_id) => delay(FIXTURE_COINS.find((c) => c.info.account_id === account_id)?.info ?? null),
  getFactoryConfig: async () =>
    delay({
      reporter: "reporter.fixture.testnet",
      protocol: "protocol.fixture.testnet",
      verifier: "intents.fixture.testnet",
      launch_deposit: "3500000000000000000000000",
      coin_count: FIXTURE_COINS.length,
    }),
  coin: coinReader,
  verifier: {
    mtBalanceOf: async (account, token_id) => delay(account === FIXTURE_USER ? (USER_BALANCES[token_id] ?? "0") : "0"),
    mtBatchBalanceOf: async (account, ids) => delay(ids.map((i) => (account === FIXTURE_USER ? (USER_BALANCES[i] ?? "0") : "0"))),
  },
  swapper: {
    getPrices: async () => delay(KNOWN_TOKENS.map((id) => [id, priceE36(id).toString()] as [string, string])),
    quoteOut: async (tin, tout, amount_in) => delay(((BigInt(amount_in) * priceE36(tin) * 997n) / (priceE36(tout) * 1000n)).toString()),
    quoteIn: async (tin, tout, amount_out) => {
      const num = BigInt(amount_out) * priceE36(tout) * 1000n;
      const den = priceE36(tin) * 997n;
      return delay(((num + den - 1n) / den).toString());
    },
  },
};

export { FIXTURE_FACTORY, FIXTURE_USER };
