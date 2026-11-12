/**
 * Fixture world: four coins at different stages, built by replaying operations through the
 * curve math so every number agrees. Times are relative to when the module loads.
 */

import type { AuctionView, CoinConfig, CoinInfo, EpochView, LaunchQueueEntry, PriceReport, Tombstone } from "@backed/client";
import { E18, curveBuy, feeOf, SPEC_CURVE } from "./curve";
import { priceE36, SimCoin, type FixtureBasketSpec, type Op } from "./sim";

export const FIXTURE_FACTORY = "fixture-factory.testnet";
export const FIXTURE_USER = "demo-visitor.testnet";

const NOW = Date.now();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const T = {
  USDC: "nep141:usdc.mock",
  BTC: "nep141:btc.mock",
  ETH: "nep141:eth.mock",
  SOL: "nep141:sol.mock",
  PEPE: "nep141:pepe.mock",
  DOGE: "nep141:doge.mock",
  WIF: "nep141:wif.mock",
  BONK: "nep141:bonk.mock",
  NVDA: "nep141:nvda.mock",
  FROG: "nep141:frog.coin-maker.testnet",
};

export type FixtureCoin = {
  info: CoinInfo;
  config: CoinConfig;
  sim: SimCoin;
  basketSpec: FixtureBasketSpec[];
  heldOverride?: Record<string, bigint>;
  epoch: EpochView;
  auction: AuctionView | null;
  tombstones: Tombstone[];
  queue: LaunchQueueEntry[];
  launch: { ends_ms: number; queued_accounts: number; queued_bu: string; settled: boolean };
  registered: Set<string>;
};

function makeConfig(p: {
  ticker: string;
  name: string;
  creator: string;
  fee_bps: number;
  profile: "demo" | "prod";
  bu_usd_e6: number;
  launch_ms: number;
}): CoinConfig {
  const demo = p.profile === "demo";
  return {
    ticker: p.ticker,
    name: p.name,
    icon: null,
    factory: FIXTURE_FACTORY,
    creator: p.creator,
    protocol: "protocol.fixture.testnet",
    verifier: "intents.fixture.testnet",
    reporter: "reporter.fixture.testnet",
    fee_bps: p.fee_bps,
    redeem_fee_bps: 50,
    epoch_profile: p.profile,
    epoch_len_ms: (demo ? 600 : 604_800) * 1000,
    window_ms: (demo ? 120 : 600) * 1000,
    auction_len_ms: (demo ? 120 : 3_600) * 1000,
    staleness_ms: (demo ? 600 : 3_600) * 1000,
    bu_usd_e6: p.bu_usd_e6,
    x0: SPEC_CURVE.x0.toString(),
    y0: SPEC_CURVE.y0.toString(),
    grad_reserve: SPEC_CURVE.grad.toString(),
    launch_ms: p.launch_ms,
  };
}

function epochClock(cfg: CoinConfig) {
  const start0 = cfg.launch_ms + cfg.window_ms;
  const of = (ms: number) => Math.max(0, Math.floor((ms - start0) / cfg.epoch_len_ms));
  const index = of(NOW);
  return { of, index, start_ms: start0 + index * cfg.epoch_len_ms, end_ms: start0 + (index + 1) * cfg.epoch_len_ms };
}

function epochView(sim: SimCoin, clock: ReturnType<typeof epochClock>, targets: string[], basketValueShare: Record<string, number>): EpochView {
  const now = sim.burns.filter((b) => b.epoch === clock.index);
  const pairs = new Map<string, { target: string; replacement: string; total: bigint; by: Map<string, bigint> }>();
  const defenses = new Map<string, bigint>();
  for (const b of now) {
    if (b.replacement) {
      const key = `${b.target}|${b.replacement}`;
      const p = pairs.get(key) ?? { target: b.target, replacement: b.replacement, total: 0n, by: new Map() };
      p.total += b.bu;
      p.by.set(b.who, (p.by.get(b.who) ?? 0n) + b.bu);
      pairs.set(key, p);
    } else {
      defenses.set(b.target, (defenses.get(b.target) ?? 0n) + b.bu);
    }
  }
  const bTotal = sim.bTotal();
  return {
    index: clock.index,
    start_ms: clock.start_ms,
    end_ms: clock.end_ms,
    challenges: [...pairs.values()].map((p) => ({
      target: p.target,
      replacement: p.replacement,
      burned_bu: p.total.toString(),
      top_challenger: [...p.by.entries()].sort((a, b) => (b[1] > a[1] ? 1 : -1))[0]![0],
    })),
    defenses: [...defenses.entries()].map(([target, bu]) => ({ target, burned_bu: bu.toString() })),
    min_burn: targets.map((target) => ({
      target,
      min_bu: ((bTotal * BigInt(basketValueShare[target] ?? 0) * 300n + 10n ** 8n - 1n) / 10n ** 8n).toString(),
    })),
  };
}

/** Deterministic PRNG (mulberry32), so fixture numbers are stable between loads and tests. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Background trading between `from` and `to`: small buys and partial sells by holders. */
function noise(seed: number, p: { from: number; to: number; n: number; buyers: string[]; sellers: string[]; buMin: number; buMax: number; sellShare: number }): Op[] {
  const r = rng(seed);
  const ops: Op[] = [];
  for (let i = 0; i < p.n; i++) {
    // Bursty arrival: cluster trades the way real flow clusters.
    const u = (i + r() * 0.9) / p.n;
    const at = Math.round(p.from + (p.to - p.from) * Math.pow(u, 0.92));
    if (r() < p.sellShare) {
      ops.push({ kind: "sell", who: p.sellers[Math.floor(r() * p.sellers.length)]!, pct: 4 + Math.round(r() * 30), at });
    } else {
      const bu = Math.round(Math.exp(Math.log(p.buMin) + r() * (Math.log(p.buMax) - Math.log(p.buMin))));
      ops.push({ kind: "buy", who: p.buyers[Math.floor(r() * p.buyers.length)]!, bu, at });
    }
  }
  return ops;
}

const byTime = (a: { at: number }, b: { at: number }) => a.at - b.at;

function build(): FixtureCoin[] {
  // ---------- $DEGEN: 50% BTC (anchored) + 50% open seat, curve mode, live challenge ----------
  const degenCfg = makeConfig({ ticker: "DEGEN", name: "Degen", creator: "leo-backed.testnet", fee_bps: 100, profile: "demo", bu_usd_e6: 10_000, launch_ms: NOW - 2 * HOUR - 10 * MIN });
  const degenClock = epochClock(degenCfg);
  const degen = new SimCoin(`degen-1.${FIXTURE_FACTORY}`, 100, degenClock.of);
  const dl = degenCfg.launch_ms + degenCfg.window_ms;
  const degenOps: Op[] = [
    { kind: "fairlaunch", at: dl + 5_000, deposits: [
      { who: "mira.testnet", bu: 400 }, { who: "0xkoi.testnet", bu: 250 }, { who: "dune-whale.testnet", bu: 1_200 },
      { who: "lotus-eater.testnet", bu: 150 }, { who: FIXTURE_USER, bu: 300 }, { who: "ape-lord.testnet", bu: 600 },
    ] },
    { kind: "buy", who: "sato-chan.testnet", bu: 320, at: dl + 9 * MIN },
    { kind: "buy", who: "mira.testnet", bu: 180, at: dl + 14 * MIN },
    { kind: "sell", who: "dune-whale.testnet", pct: 30, at: dl + 22 * MIN },
    { kind: "burn", who: "ape-lord.testnet", tokens: 4_000_000, at: dl + 31 * MIN, reason: "challenge", target: T.USDC, replacement: T.ETH },
    { kind: "burn", who: "lotus-eater.testnet", tokens: 6_000_000, at: dl + 38 * MIN, reason: "defend", target: T.USDC },
    { kind: "buy", who: "gm-gn.testnet", bu: 900, at: dl + 44 * MIN },
    { kind: "buy", who: "0xkoi.testnet", bu: 260, at: dl + 58 * MIN },
    { kind: "buy", who: FIXTURE_USER, bu: 200, at: dl + 63 * MIN },
    { kind: "sell", who: "sato-chan.testnet", pct: 100, at: dl + 71 * MIN },
    { kind: "buy", who: "pixel-monk.testnet", bu: 1_400, at: dl + 80 * MIN },
    { kind: "buy", who: "dune-whale.testnet", bu: 700, at: dl + 92 * MIN },
    { kind: "buy", who: "nightjar.testnet", bu: 450, at: dl + 101 * MIN },
  ];
  const degenHolders = ["mira.testnet", "0xkoi.testnet", "dune-whale.testnet", "lotus-eater.testnet", "ape-lord.testnet", "gm-gn.testnet", "pixel-monk.testnet"];
  const degenNoise = noise(7, {
    from: dl + 2 * MIN, to: NOW - 30_000, n: 170,
    buyers: [...degenHolders, "sato-chan.testnet", "nightjar.testnet", "frog-prince.testnet", "cope-seeker.testnet", "wifhat.testnet"],
    sellers: degenHolders, buMin: 8, buMax: 160, sellShare: 0.36,
  });
  // Burns in the current epoch.
  const de = degenClock.start_ms;
  [
    ...degenOps,
    ...degenNoise,
    { kind: "burn", who: "mira.testnet", tokens: 5_000_000, at: de + 40_000, reason: "challenge", target: T.USDC, replacement: T.SOL },
    { kind: "burn", who: "ape-lord.testnet", tokens: 2_500_000, at: de + 70_000, reason: "challenge", target: T.USDC, replacement: T.DOGE },
    { kind: "buy", who: "frog-prince.testnet", bu: 120, at: de + 95_000 },
    { kind: "burn", who: "lotus-eater.testnet", tokens: 4_000_000, at: de + 110_000, reason: "defend", target: T.USDC },
    { kind: "burn", who: "0xkoi.testnet", tokens: 3_000_000, at: de + 150_000, reason: "challenge", target: T.USDC, replacement: T.SOL },
  ]
    .sort(byTime)
    .forEach((o) => degen.apply(o as Op));
  const degenBasket: FixtureBasketSpec[] = [
    { token_id: T.BTC, share_bps: 5_000, weight_bps: 5_000, anchored: true, joined_epoch: 0 },
    { token_id: T.USDC, share_bps: 5_000, weight_bps: 5_000, anchored: false, joined_epoch: 0 },
  ];

  // ---------- $TRENCH: meme basket, graduated to Index mode, auction open ----------
  const trenchCfg = makeConfig({ ticker: "TRENCH", name: "Trench Index", creator: "trench-lord.testnet", fee_bps: 75, profile: "prod", bu_usd_e6: 5_000, launch_ms: NOW - 23 * DAY - 3 * HOUR });
  const trenchClock = epochClock(trenchCfg);
  const trench = new SimCoin(`trench-2.${FIXTURE_FACTORY}`, 75, trenchClock.of);
  const tl = trenchCfg.launch_ms + trenchCfg.window_ms;
  const whos = ["wifhat.testnet", "bonkbonk.testnet", "pepe-maxi.testnet", "degen-dad.testnet", "mira.testnet", "0xkoi.testnet", "nightjar.testnet", "cope-seeker.testnet", "gm-gn.testnet", FIXTURE_USER];
  trench.apply({ kind: "fairlaunch", at: tl + 4_000, deposits: whos.slice(0, 8).map((who, i) => ({ who, bu: 200 + i * 90 })) });
  let t = tl + 2 * HOUR;
  for (let i = 0; i < 46 && trench.mode === "curve"; i++) {
    t += 7 * HOUR;
    const who = whos[i % whos.length]!;
    if (i % 9 === 4) trench.apply({ kind: "sell", who, pct: 40, at: t });
    else trench.apply({ kind: "buy", who, bu: 300 + ((i * 137) % 900), at: t });
    if (i === 17) trench.apply({ kind: "burn", who: "wifhat.testnet", tokens: 9_000_000, at: t + MIN, reason: "challenge", target: T.BTC, replacement: T.WIF });
    if (i === 30) trench.apply({ kind: "burn", who: "bonkbonk.testnet", tokens: 7_000_000, at: t + MIN, reason: "challenge", target: T.ETH, replacement: T.BONK });
  }
  // Index mode: pool trades (not in the mint and burn log), redeems and burns.
  const ti = (trench.graduatedMs ?? t) + 6 * HOUR;
  const trenchNoise = noise(11, {
    from: ti + HOUR, to: NOW - 20 * MIN, n: 90,
    buyers: whos, sellers: whos.slice(0, 8), buMin: 60, buMax: 900, sellShare: 0.28,
  });
  [
    ...trenchNoise,
    { kind: "buy", who: "cope-seeker.testnet", bu: 400, at: ti },
    { kind: "sell", who: "pepe-maxi.testnet", pct: 50, at: ti + 9 * HOUR },
    { kind: "redeem", who: "degen-dad.testnet", pct: 60, at: ti + DAY },
    { kind: "burn", who: "nightjar.testnet", tokens: 3_000_000, at: ti + 2 * DAY, reason: "challenge", target: T.DOGE, replacement: T.SOL },
    { kind: "buy", who: FIXTURE_USER, bu: 250, at: ti + 3 * DAY },
    { kind: "redeem", who: "0xkoi.testnet", pct: 25, at: ti + 4 * DAY },
    // This epoch's tallies.
    { kind: "burn", who: "eth-maxi.testnet", tokens: 2_000_000, at: trenchClock.start_ms + 3 * HOUR, reason: "challenge", target: T.BONK, replacement: T.ETH },
    { kind: "burn", who: "bonkbonk.testnet", tokens: 3_000_000, at: trenchClock.start_ms + 5 * HOUR, reason: "defend", target: T.BONK },
  ]
    .sort(byTime)
    .forEach((o) => {
      if (o.kind === "burn" && o.who === "eth-maxi.testnet") trench.balances.set("eth-maxi.testnet", 5_000_000n * E18);
      trench.apply(o as Op);
    });
  const trenchBasket: FixtureBasketSpec[] = [
    { token_id: T.PEPE, share_bps: 2_500, weight_bps: 2_500, anchored: false, joined_epoch: 0 },
    { token_id: T.DOGE, share_bps: 2_500, weight_bps: 2_500, anchored: false, joined_epoch: 0 },
    { token_id: T.WIF, share_bps: 2_500, weight_bps: 2_500, anchored: false, joined_epoch: 1 },
    { token_id: T.BONK, share_bps: 2_500, weight_bps: 2_500, anchored: false, joined_epoch: 2 },
    { token_id: T.SOL, share_bps: 1, weight_bps: 0, anchored: false, joined_epoch: trenchClock.index },
  ];
  // Auction: DOGE -> SOL, 42% filled, 25 minutes into a 60-minute ramp.
  const bT = trench.bTotal();
  const dogeTotal = (bT * BigInt(computeShareQ(2_500, 5_000, T.DOGE))) / E18;
  const dogeLeft = (dogeTotal * 58n) / 100n;
  const fair = (priceE36(T.DOGE) * E18 + priceE36(T.SOL) - 1n) / priceE36(T.SOL);
  const auctionStart = NOW - 25 * MIN;
  const solReceived = ((dogeTotal - dogeLeft) * ((fair * 11_200n) / 10_000n)) / E18;
  const trenchAuction: AuctionView = {
    id: 3,
    target: T.DOGE,
    replacement: T.SOL,
    target_total: dogeTotal.toString(),
    target_left: dogeLeft.toString(),
    replacement_received: solReceived.toString(),
    fair_rate: fair.toString(),
    rate_now: ((fair * (10_000n + (2_000n * 35n) / 60n)) / 10_000n).toString(),
    start_ms: auctionStart,
    ramp_end_ms: auctionStart + trenchCfg.auction_len_ms,
    challenger: "nightjar.testnet",
  };
  const trenchTombs: Tombstone[] = [
    { token_id: T.BTC, joined_epoch: 0, removed_epoch: 1, challenger: "wifhat.testnet", rate: "666666666666666666667", ts_ms: trenchCfg.launch_ms + 8 * DAY },
    { token_id: T.ETH, joined_epoch: 0, removed_epoch: 2, challenger: "bonkbonk.testnet", rate: "17500000000000", ts_ms: trenchCfg.launch_ms + 15 * DAY },
  ];

  // ---------- $CHIPS: stocks + majors, in the fair-launch window ----------
  const chipsCfg = makeConfig({ ticker: "CHIPS", name: "Chips", creator: "silicon-sam.testnet", fee_bps: 50, profile: "demo", bu_usd_e6: 10_000, launch_ms: NOW - 40_000 });
  const chipsClock = epochClock(chipsCfg);
  const chips = new SimCoin(`chips-3.${FIXTURE_FACTORY}`, 50, chipsClock.of);
  chips.mode = "launch";
  const queue: LaunchQueueEntry[] = [
    { who: "silicon-sam.testnet", bu: 500 }, { who: "mira.testnet", bu: 220 }, { who: "gm-gn.testnet", bu: 90 },
    { who: "pixel-monk.testnet", bu: 640 }, { who: "nightjar.testnet", bu: 75 }, { who: "dune-whale.testnet", bu: 1_100 },
  ].map(({ who, bu }) => {
    const buIn = BigInt(bu) * E18;
    const fee = feeOf(buIn, 50);
    chips.creatorOwed += (fee * 5_000n) / 10_000n;
    chips.protocolOwed += fee - (fee * 5_000n) / 10_000n;
    return { account_id: who, bu: (buIn - fee).toString() };
  });
  const queuedBu = queue.reduce((s, q) => s + BigInt(q.bu), 0n);
  // Queued deposits sit in the vault until settle; count them so held amounts are right.
  chips.queuedBu = queuedBu;
  const chipsBasket: FixtureBasketSpec[] = [
    { token_id: T.NVDA, share_bps: 4_000, weight_bps: 4_000, anchored: true, joined_epoch: 0 },
    { token_id: T.BTC, share_bps: 3_000, weight_bps: 3_000, anchored: false, joined_epoch: 0 },
    { token_id: T.SOL, share_bps: 3_000, weight_bps: 3_000, anchored: false, joined_epoch: 0 },
  ];

  // ---------- $FROGS: early curve coin with an unverified asset ----------
  const frogsCfg = makeConfig({ ticker: "FROGS", name: "Frog Fund", creator: "frog-prince.testnet", fee_bps: 25, profile: "prod", bu_usd_e6: 10_000, launch_ms: NOW - 3 * DAY });
  const frogsClock = epochClock(frogsCfg);
  const frogs = new SimCoin(`frogs-4.${FIXTURE_FACTORY}`, 25, frogsClock.of);
  const fl = frogsCfg.launch_ms + frogsCfg.window_ms;
  frogs.apply({ kind: "fairlaunch", at: fl + 3_000, deposits: [{ who: "frog-prince.testnet", bu: 200 }, { who: "lily-pad.testnet", bu: 60 }] });
  [
    { kind: "buy", who: "tadpole.testnet", bu: 45, at: fl + 5 * HOUR },
    { kind: "buy", who: "lily-pad.testnet", bu: 130, at: fl + DAY },
    { kind: "sell", who: "tadpole.testnet", pct: 100, at: fl + DAY + 6 * HOUR },
    { kind: "buy", who: "ribbit.testnet", bu: 85, at: fl + 2 * DAY },
    ...noise(23, { from: fl + 2 * HOUR, to: NOW - 2 * HOUR, n: 34, buyers: ["lily-pad.testnet", "ribbit.testnet", "tadpole.testnet", "bog-king.testnet"], sellers: ["frog-prince.testnet", "lily-pad.testnet"], buMin: 5, buMax: 60, sellShare: 0.3 }),
  ]
    .sort(byTime)
    .forEach((o) => frogs.apply(o as Op));
  const frogsBasket: FixtureBasketSpec[] = [
    { token_id: T.ETH, share_bps: 7_000, weight_bps: 7_000, anchored: false, joined_epoch: 0 },
    { token_id: T.FROG, share_bps: 3_000, weight_bps: 3_000, anchored: false, joined_epoch: 0 },
  ];

  const info = (sim: SimCoin, cfg: CoinConfig): CoinInfo => ({ account_id: sim.account, ticker: cfg.ticker, name: cfg.name, creator: cfg.creator, created_ms: cfg.launch_ms });
  const settled = (cfg: CoinConfig) => ({ ends_ms: cfg.launch_ms + cfg.window_ms, queued_accounts: 0, queued_bu: "0", settled: true });
  const shares = (b: FixtureBasketSpec[]) => Object.fromEntries(b.filter((x) => !x.anchored).map((x) => [x.token_id, x.share_bps]));

  return [
    {
      info: info(degen, degenCfg), config: degenCfg, sim: degen, basketSpec: degenBasket,
      epoch: epochView(degen, degenClock, [T.USDC], shares(degenBasket)), auction: null, tombstones: [], queue: [],
      launch: settled(degenCfg), registered: new Set([FIXTURE_USER]),
    },
    {
      info: info(trench, trenchCfg), config: trenchCfg, sim: trench, basketSpec: trenchBasket,
      heldOverride: { [T.DOGE]: dogeLeft, [T.SOL]: solReceived },
      epoch: epochView(trench, trenchClock, [T.PEPE, T.WIF, T.BONK], shares(trenchBasket)), auction: trenchAuction, tombstones: trenchTombs, queue: [],
      launch: settled(trenchCfg), registered: new Set([FIXTURE_USER]),
    },
    {
      info: info(chips, chipsCfg), config: chipsCfg, sim: chips, basketSpec: chipsBasket,
      epoch: epochView(chips, chipsClock, [T.BTC, T.SOL], shares(chipsBasket)), auction: null, tombstones: [],
      queue, launch: { ends_ms: chipsCfg.launch_ms + chipsCfg.window_ms, queued_accounts: queue.length, queued_bu: queuedBu.toString(), settled: false },
      registered: new Set(),
    },
    {
      info: info(frogs, frogsCfg), config: frogsCfg, sim: frogs, basketSpec: frogsBasket,
      epoch: epochView(frogs, frogsClock, [T.ETH, T.FROG], shares(frogsBasket)), auction: null, tombstones: [], queue: [],
      launch: settled(frogsCfg), registered: new Set(),
    },
  ];
}

/** q for a share of the basket at the fixture USD price (dollars per raw unit). */
function computeShareQ(share_bps: number, bu_usd_e6: number, token_id: string): string {
  const num = BigInt(share_bps) * BigInt(bu_usd_e6) * 10n ** 36n;
  const den = 10_000n * 1_000_000n * priceE36(token_id);
  return ((num + den - 1n) / den).toString();
}

export const FIXTURE_COINS: FixtureCoin[] = build();

export function reporterPrices(): PriceReport[] {
  return Object.values(T)
    .filter((id) => id !== T.FROG)
    .map((token_id) => ({ token_id, price: priceE36(token_id).toString(), ts_ms: NOW - 40_000 }));
}

/** Tokens out for a fair-launch deposit if the window closed with it included (an estimate). */
export function queuedTokensEstimate(queuedNet: bigint, net: bigint): bigint {
  const D = queuedNet + net;
  if (D === 0n) return 0n;
  const b = curveBuy(SPEC_CURVE, { reserve: 0n, surplus: 0n, sold: 0n }, D);
  return (b.tokens * net) / D;
}
