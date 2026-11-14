// End-to-end on testnet: every product action once, each with an explorer link.
// Usage: pnpm --filter scripts demo <master.testnet>   (takes about 15 minutes: real windows and epochs)
// PRESET=memes: a NEAR-memes basket instead: JAMBO from meme.cooking (anchored), BLACKDRAGON and SHITZU; holders
// vote SHITZU out for PEPE. The default is half BTC (anchored), half USDC, voted out for SOL.
import { KeyPair } from "near-api-js";
import { ONE_YOCTO, account, call, callBatch, exists, loadDeployment, near, qFor, saveKey, sleep, tokenBySymbol, txLink, view } from "./lib.js";
import { buyWithFaucet, buyWithUsdc, faucet, fmt, register, reportPrices } from "./chain.js";

const master = process.argv[2];
if (!master) throw new Error("usage: demo <master.testnet>");
const m = account(master);
const d = loadDeployment();
const E18 = 10n ** 18n;

async function user(prefix: string) {
  const id = `${prefix}.${master}`;
  if (!(await exists(id))) {
    const key = KeyPair.fromRandom("ed25519");
    saveKey(id, key);
    const res = await m.createSubAccount({ accountOrPrefix: prefix, publicKey: key.getPublicKey(), nearToTransfer: near(3) });
    console.log(`  created ${id}\n    ${txLink(res.transaction_outcome.id)}`);
  }
  return account(id);
}

const step = (n: number, s: string) => console.log(`\n${n}. ${s}`);
type State = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const state = (coin: string) => view<State>(coin, "get_state");
async function waitUntil(ms: number, why: string) {
  const left = ms - Date.now();
  if (left > 0) {
    console.log(`  waiting ${Math.ceil(left / 1000)}s for ${why}`);
    await sleep(left + 3_000);
  }
}

step(1, "Accounts");
const alice = await user("alice");
const bob = await user("bob");
const keeper = account(`keeper.${master}`);
const reporter = account(d.reporter);

const MEMES = process.env.PRESET === "memes";
const LEGS: [string, number, boolean][] = MEMES
  ? [["JAMBO", 3_400, true], ["BLACKDRAGON", 3_300, false], ["SHITZU", 3_300, false]]
  : [["BTC", 5_000, true], ["USDC", 5_000, false]];
step(2, MEMES ? "Launch a coin of NEAR memes: JAMBO from meme.cooking (anchored), BLACKDRAGON, SHITZU" : "Launch a coin: half BTC (anchored), half USDC (the seat), 10-minute epochs");
const ticker = MEMES ? `COOK${Date.now() % 1_000}` : `DEMO${Date.now() % 10_000}`;
const btc = tokenBySymbol("BTC"), usdc = tokenBySymbol("USDC");
/** The non-anchored asset holders vote out, and what they vote in. */
const seat = tokenBySymbol(MEMES ? "SHITZU" : "USDC"), replacement = tokenBySymbol(MEMES ? "PEPE" : "SOL");
const cfg = await view<{ launch_deposit: string }>(d.factory, "get_config");
const launched = await call<string>(
  m,
  d.factory,
  "create_coin",
  {
    config: {
      ticker, name: MEMES ? `Cooked ${ticker}` : `Demo ${ticker}`, icon: null, fee_bps: 100, epoch_profile: "demo", bu_usd_e6: 1_000_000, creator: null,
      basket: LEGS.map(([sym, w, anchored]) => {
        const t = tokenBySymbol(sym);
        return { token_id: t.token_id, weight_bps: w, q: qFor(w, "1", t.usd, t.decimals).toString(), anchored };
      }),
    },
  },
  { deposit: BigInt(cfg.launch_deposit), tgas: 300, label: `launch $${ticker}` },
);
const coin = launched.result;
console.log(`  coin account: ${coin}`);
const launchState = await state(coin);

step(3, "Fair-launch window: two buyers pay with test USDC (swap legs, then one batch transfer)");
await faucet(alice, [{ token_id: usdc.token_id, amount: 5_000n * 10n ** 6n }]);
await faucet(bob, [{ token_id: usdc.token_id, amount: 5_000n * 10n ** 6n }]);
await buyWithUsdc(alice, coin, 100n * E18);
await buyWithUsdc(bob, coin, 300n * E18);
console.log(`  queued: ${fmt((await state(coin)).launch.queued_bu)} BU from ${(await state(coin)).launch.queued_accounts} deposits`);

step(4, "Settle the window: everyone pays the same average price");
await waitUntil(launchState.launch.ends_ms, "the window to close");
await call(keeper, coin, "settle_launch", { limit: 50 }, { tgas: 300, label: "settle_launch" });
const aBal = await view<string>(coin, "ft_balance_of", { account_id: alice.accountId });
const bBal = await view<string>(coin, "ft_balance_of", { account_id: bob.accountId });
console.log(`  alice ${fmt(aBal)} and bob ${fmt(bBal)} tokens (1 : 3, like their deposits)`);

step(5, "Curve buy and sell (two-part price: curve + surplus per token)");
await buyWithUsdc(alice, coin, 50n * E18);
const sellAmt = BigInt(bBal) / 10n;
const quote = await view<{ out_bu: string }>(coin, "quote_sell", { amount: sellAmt.toString() });
await call(bob, coin, "sell", { amount: sellAmt.toString(), min_bu_out: "0", receiver_id: null }, { deposit: ONE_YOCTO, tgas: 100, label: `bob sells ${fmt(sellAmt)} tokens for ${fmt(quote.out_bu)} BU` });
let s = await state(coin);
console.log(`  price ${fmt(s.price, 18 - 6)}e-6 BU, floor ${fmt(s.floor, 18 - 6)}e-6 BU, surplus per token ${s.surplus_per_token}`);

step(6, `Seat challenge: alice burns to swap ${MEMES ? "SHITZU for PEPE" : "USDC for SOL"}, bob defends with less`);
const epoch = await view<State>(coin, "get_epoch");
const minBu = BigInt(epoch.min_burn.find((x: State) => x.target === seat.token_id).min_bu);
const aliceNow = BigInt(await view<string>(coin, "ft_balance_of", { account_id: alice.accountId }));
await call(alice, coin, "challenge", { target: seat.token_id, replacement: replacement.token_id, amount: (aliceNow / 2n).toString() }, { deposit: ONE_YOCTO, tgas: 100, label: `alice challenges ${MEMES ? "SHITZU -> PEPE" : "USDC -> SOL"}` });
await call(bob, coin, "defend", { target: seat.token_id, amount: (BigInt(bBal) / 50n).toString() }, { deposit: ONE_YOCTO, tgas: 100, label: `bob defends ${MEMES ? "SHITZU" : "USDC"}` });
const e2 = await view<State>(coin, "get_epoch");
console.log(`  challenge ${fmt(e2.challenges[0].burned_bu)} BU vs defense ${fmt(e2.defenses[0].burned_bu)} BU (minimum ${fmt(minBu)} BU)`);
s = await state(coin);
console.log(`  surplus per token after burns: ${s.surplus_per_token}`);

step(7, "Epoch ends: prices posted, close_epoch opens the auction");
await waitUntil(s.epoch.end_ms, "the epoch to end");
await reportPrices(reporter, coin, [...LEGS.map(([sym]) => tokenBySymbol(sym).token_id), replacement.token_id]);
const closed = await call<string>(keeper, coin, "close_epoch", {}, { tgas: 100, label: "close_epoch" });
console.log(`  outcome: ${closed.result}`);

step(8, `The Dutch auction falls to fair; a filler swaps ${MEMES ? "PEPE in for the SHITZU" : "SOL in for the USDC"}`);
const auction = await view<State>(coin, "get_auction");
if (auction) {
  await waitUntil(auction.ramp_end_ms, "the auction to reach the fair rate");
  const a2 = await view<State>(coin, "get_auction");
  const need = (BigInt(a2.target_left) * BigInt(a2.rate_now)) / E18 + 2n;
  await callBatch(keeper, d.verifier, [
    { method: "faucet", args: { token_id: a2.replacement, amount: need.toString(), receiver_id: null }, tgas: 10 },
    { method: "mt_transfer_call", args: { receiver_id: coin, token_id: a2.replacement, amount: need.toString(), approval: null, memo: null, msg: JSON.stringify({ action: "fill_auction", min_out: "0" }) }, deposit: ONE_YOCTO, tgas: 150 },
  ], "fill the auction");
  console.log(`  basket now: ${(await view<State[]>(coin, "get_basket")).map((b) => b.token_id).join(", ")}`);
  console.log(`  tombstone: ${JSON.stringify((await view<State[]>(coin, "get_tombstones", {}))[0])}`);
}

step(9, "Buy to graduation: the curve fills and the built-in pool opens");
await buyWithFaucet(alice, coin, 25_000n * E18);
s = await state(coin);
console.log(`  mode ${s.mode}; pool ${fmt(s.pool_bu)} BU / ${fmt(s.pool_tokens)} tokens; floor ${s.floor}`);

step(10, "After graduation: pool buy, sell at max(pool, redeem), redeem");
await register(bob, coin);
await buyWithFaucet(bob, coin, 10n * E18);
const t = 1_000_000n * E18;
const sq = await view<State>(coin, "quote_sell", { amount: t.toString() });
await call(alice, coin, "sell", { amount: t.toString(), min_bu_out: "0", receiver_id: null }, { deposit: ONE_YOCTO, tgas: 100, label: `alice sells 1M tokens via ${sq.path}` });
const floorBefore = (await state(coin)).floor;
await call(alice, coin, "redeem", { amount: t.toString(), receiver_id: null }, { deposit: ONE_YOCTO, tgas: 100, label: "alice redeems 1M tokens for her share of the vault" });
console.log(`  floor ${floorBefore} -> ${(await state(coin)).floor} (redeem fee stays behind)`);

step(11, "Fees: creator and protocol shares paid in kind");
await call(keeper, coin, "claim_fees", {}, { tgas: 100, label: "claim_fees" });

step(12, "Mint and burn log (newest first)");
for (const l of (await view<State[]>(coin, "get_log")).slice(0, 8)) console.log(`  ${l.kind} ${fmt(l.tokens)} by ${l.account_id} (${l.reason})`);
console.log(`\nDone. Coin: https://testnet.nearblocks.io/address/${coin}`);
