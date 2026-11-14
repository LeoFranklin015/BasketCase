# Basketcase: technical README

The full reference for judges, reviewers and coding agents: every claim with the command, test or transaction that proves it, trust assumptions, the testnet and mainnet setup, and how to run everything. The short overview is the [README](../README.md); the code map is [ARCHITECTURE.md](../ARCHITECTURE.md).

Basketcase is a memecoin launchpad on NEAR where every coin has a vault and a floor. Memecoin buyers usually have nothing under the price: a coin can go to zero in minutes, and any "treasury" is controlled by someone. Here, buying a coin sends a basket of assets (for example BTC and USDC, or PEPE, DOGE and WIF) into the coin's own vault, and a bonding curve prices the coin in units of that basket. The floor is computed by the contract from the vault and the supply, and fees and burns only raise it. Each round, holders burn tokens to challenge or defend an asset in the basket; a winning challenge opens an auction that swaps it. NEAR fits because NEAR Intents can hold assets from many chains in one place and move a whole basket in one call, and because a NEAR contract account can have no keys at all, so nobody can sign for a coin.

Built at NEAR HACKATHON (November 2026) for **Memecoins With Mechanics**, also entered in DeFi and Open Innovation.

**Status, plainly:**

- Everything runs on **NEAR testnet**. NEAR Intents has no testnet, so a stand-in verifier with the same call shapes (`contracts/mock-intents`) holds the vaults, and a stand-in swapper (`contracts/mock-swapper`) plays the part of 1Click.
- **Nothing is deployed on mainnet yet.** The mainnet code paths (1Click swaps signed as NEP-413 intents by NEAR wallets, and NEAR Intents messages signed by MetaMask or Phantom) are written and unit-tested, and read-only checks against mainnet pass (`pnpm verify --mainnet-check`, `pnpm --filter scripts intents:check`). They have **not moved real funds**.
- **Buy and sell from MetaMask or Phantom (mainnet build), with no account of ours holding the buyer's funds.** The buyer's wallet owns an account inside NEAR Intents (the lowercase EVM address, or the hex of the Solana key). It sends one USDC transfer on Base or Solana to a 1Click deposit address, which delivers NEAR USDC into that account. The wallet then signs the 1Click swaps into the basket and our buy, a NEAR Intents `transfer` of the basket to the coin; the coin mints the tokens back into the buyer's NEAR Intents account. Our relayer only submits the signed messages and pays the gas; it cannot change them. A sell is one signed withdrawal of the coin to the coin; the basket assets go back to the seller's NEAR Intents account, and signed 1Click swaps cash them out to USDC on Base or Solana. The browser checks every message before the wallet signs it. Tested: contract unit tests, client tests with real secp256k1 and ed25519 keys, and a read-only mainnet check that NEAR Intents accepts our signatures (8 PASS). **Not tested with real money yet**, and the mainnet coin is not deployed. Flow and files: [ARCHITECTURE.md, flow 6](../ARCHITECTURE.md#buying-from-base-or-solana). Steps and costs: [`docs/mainnet-runbook.md`](mainnet-runbook.md) (one coin; about $0.35 actually spent, the rest of the ~4 NEAR deposit comes back).
- **Baskets can hold memecoins from NEAR and other chains.** Mainnet asset list (`deployments/mainnet.json`, all routed by 1Click): NEAR's own BLACKDRAGON, SHITZU and JAMBO (a meme.cooking token), plus PEPE, SHIB, MOG, TURBO (Ethereum), TRUMP, WIF (Solana), BRETT (Base), DOGE, alongside BTC, ETH, SOL, USDC and wNEAR. On testnet, `$MEMES` holds BLACKDRAGON, SHITZU, JAMBO and PEPE (test stand-ins).
- Hosted demo, testnet: **https://basketcase-testnet.vercel.app** (valid HTTPS).
- The same code built for mainnet (`NEXT_PUBLIC_NETWORK=mainnet`): **https://basketcase-near.vercel.app**. It reads `intents.near` and 1Click and shows "Not live on mainnet yet" until the factory is deployed. The network badge in the header switches between the two.
- Fallback for both: `https://141.148.209.77:3000` (testnet, self-signed certificate: your browser warns first). The `trycloudflare.com` addresses are Cloudflare quick tunnels; if one stops answering, use the fallback.

## For judges and AI screeners

Every step below is a command with the result you should see. Nothing here sends a transaction. Needs Rust (stable), Node 22+, pnpm 10, `curl` and `jq`.

1. **Install.** `pnpm install` → finishes with no errors.
2. **Contract and math tests.** `cargo test --workspace --release` → **104 tests pass**: `curve-math` 22, `coin` 38, `factory` 7, `mock-intents` 7, `mock-swapper` 5, `sim` 25. Takes about 3 minutes, mostly the coin's solvency property test.
3. **Simulation is reproducible.** `cargo run -p sim --release -- --check` → `sim: outputs match a fresh run`. This reruns the 60-day simulation (4 scenarios × 20 seeds) and compares it with the committed `docs/simulation.md` and `web/public/sim.json`.
4. **TypeScript unit tests.** `pnpm -r test` → `packages/client` **81 passed**, `scripts` **3 passed**, `web` **101 passed**.
5. **Types.** `pnpm -r typecheck` → no errors.
6. **Browser smoke tests.** `cd web && pnpm exec playwright install chromium && pnpm exec playwright test` → **7 passed**. This builds the app with built-in sample data (no chain access) and checks the landing page, markets, coin page, chart, phone trade sheet, history API, and the widget, launch, graveyard and simulation pages.
7. **All of the above at once.** `pnpm verify` → a PASS/FAIL table with the counts above. `pnpm verify --live` adds read-only checks on the testnet contracts; `pnpm verify --mainnet-check` adds the mainnet readiness check (see [Testnet and mainnet](#testnet-and-mainnet)). `pnpm verify --live-only` runs just the on-chain checks in a few seconds.
8. **Check the chain yourself.** See [On-chain checks with curl](#on-chain-checks-with-curl): coins are listed by the factory, each coin account has **zero access keys**, and each coin's floor matches the formula on its own state.
9. **Live numbers as JSON.** `curl -s https://basketcase-testnet.vercel.app/api/status | jq` (or `http://localhost:3000/api/status` after `pnpm --filter web dev`) → network, factory, and per coin: stage, price, floor, vault, supply, backed %, access-key count, and `floor_matches_formula: true`. Read-only, cached 30 seconds.
10. **Wallet signatures on mainnet NEAR Intents.** `pnpm --filter scripts intents:check` → **8 PASS**. It signs throwaway MetaMask-style and Phantom-style messages and runs them through `intents.near` `simulate_intents`, a view: signatures accepted, a buy and a sell parse and stop at the (empty) balance, a tampered message is rejected. Nothing is sent.
11. **Code structure and every flow, file by file.** [ARCHITECTURE.md](../ARCHITECTURE.md).
12. **Try it in a browser.** See the next section.

## Try it in the browser in 3 clicks

Open **https://basketcase-testnet.vercel.app/c/degen-0.pad.backedlab.testnet**. Then:

1. **Look.** You see `$DEGEN`'s market cap, the floor bar ("91% backed by BTC + ETH"), the floor per 1M tokens, a pie of the basket, and the price chart with the floor drawn under it. (From the landing page: "Open the app", then `$DEGEN`.)
2. **Connect → "Guest wallet".** This makes a testnet key in your browser; no wallet app, no sign-up. Our relayer sends it 0.5 testnet NEAR for gas (the first buy also pays a small storage deposit to the coin), then it gets 100 test USDC from the faucet, by itself.
3. **Buy.** Pick $5 and press **Buy $DEGEN**. The guest key signs without a second prompt. A buy is two transactions: a swap into the basket assets, then one transfer of the basket to the coin. You then see "You're in N $DEGEN", what the floor alone pays for them, and an explorer link for each transaction.
4. **Sell** (optional). Sell tab → 50% → **Sell $DEGEN**.

You can also sell, redeem (after graduation), or burn tokens to challenge or defend a basket asset in "The fight over the basket". Any NEAR testnet wallet works too, through NEAR Connect.

The guest wallet exists only on testnet, where tokens are free. Its key lives in your browser's local storage; disconnecting forgets it. Email/Google sign-in through Privy works only on hosts the Privy app allows, so on the tunnel addresses use the guest wallet or a NEAR wallet.

## On-chain checks with curl

Paste this helper into a bash shell. It calls a contract's view method on NEAR testnet RPC and decodes the result.

```bash
RPC=https://rpc.testnet.fastnear.com
view() { curl -s $RPC -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"$1\",\"method_name\":\"$2\",\"args_base64\":\"$(printf '%s' "$3" | base64 | tr -d '\n')\"}}" | jq 'if .result then .result.result | implode | fromjson else .error end'; }
keys() { curl -s $RPC -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_access_key_list\",\"finality\":\"final\",\"account_id\":\"$1\"}}" | jq -c '.result.keys // .error'; }
```

The free RPC rate-limits busy IPs. If you see an error with code `-429`, wait a few seconds and run the command again.

```bash
# 1. The factory lists its coins.
view pad.backedlab.testnet list_coins '{"from":0,"limit":20}' | jq -r '.[].account_id'
#    → degen-0, trench-0, chips-0, demo1283-0 (each .pad.backedlab.testnet), plus any coin launched since

# 2. A coin account has no access keys: nobody can sign as it or change its code.
keys degen-0.pad.backedlab.testnet
#    → []   (same for every coin)

# 3. The floor is arithmetic on the coin's own state.
view degen-0.pad.backedlab.testnet get_state '{}' | jq '{mode, floor: ((.floor|tonumber)/1e18), formula: (if .mode == "index" then (.reserve|tonumber)/(.supply|tonumber) else 5000/1073000000 + (.surplus|tonumber)/(.sold|tonumber) end), price: ((.price|tonumber)/1e18)}'
#    → floor equals formula, and floor is below price. Exact integer check for every coin: pnpm verify --live-only

# 4. Assets voted out are recorded as tombstones.
view degen-0.pad.backedlab.testnet get_tombstones '{"from":0,"limit":100}' | jq 'length, .[0]'
#    → a count above 0, then a record: asset, epochs held, challenger, swap rate

# 5. Every mint and burn is logged on chain (last 100; NEP-297 events hold the full history).
view degen-0.pad.backedlab.testnet get_log '{}' | jq '.[0]'
#    → the newest entry: kind mint or burn, account, tokens, reason (buy, sell, challenge, ...)

# 6. The coin's parameters are public.
view degen-0.pad.backedlab.testnet get_config '{}' | jq '{ticker, fee_bps, epoch_len_ms, reporter, verifier}'
#    → fee_bps 100, epoch_len_ms 600000 (10-minute demo rounds)
```

What the floor formula means: before graduation, the floor is the curve's lowest price (5,000 BU of virtual reserve over 1.073 billion virtual tokens) plus the vault surplus per sold token. After graduation it is the vault's reserve divided by the supply. Both are in basket units (BU) per token. It is a floor in basket units, not in dollars: if the basket's assets fall in price, the dollar floor falls with them.

## Claims and the evidence for each

| Claim | Evidence |
| --- | --- |
| A coin account has no access keys and no owner methods | `keys <coin>` returns `[]`; `contracts/factory/src/lib.rs` `create_coin` creates the account and deploys code without adding a key; the only caller checks in `contracts/coin` are `only the reporter` (`ritual.rs`, prices) and `only the verifier` (`trade.rs`, incoming baskets) |
| Coin parameters are fixed at launch | `get_config`; the coin has no setter method; the factory checks every launch (`launch_config_is_validated`, `bad_weights_are_refused_before_deploying`, `a_bad_ticker_is_refused`) |
| A buy followed by a sell never profits | proptest `buy_then_sell_never_profits` in `crates/curve-math` |
| The vault is always solvent and everyone can exit | proptest `everyone_can_always_exit` in `contracts/coin/src/tests.rs` (128 cases × up to 160 random operations) |
| Fair launch: everyone in the window pays one price | test `settling_the_window_gives_everyone_the_same_average_price`; testnet [settle tx](https://testnet.nearblocks.io/txns/GhU8gKsSLK6mVUGbPdR9KscyvVx3k9FU5JfA6Vqwp3cZ) (two buyers got 1 : 3, like their deposits) |
| Burns raise the floor for holders | tests `a_challenge_burns_tokens_and_raises_surplus_per_token`, `after_graduation_a_burn_raises_the_floor`, `redeeming_raises_the_floor_for_those_who_stay`; testnet [redeem tx](https://testnet.nearblocks.io/txns/Fq8p9cYD7RMkUyvUuHTrrnofNEejE5aMxNuMfBF9nSq2) |
| A winning challenge swaps the asset through an auction and leaves a tombstone | tests `filling_the_auction_swaps_the_asset_and_writes_a_tombstone`, `defenders_who_burn_more_keep_the_asset`; testnet [close_epoch](https://testnet.nearblocks.io/txns/A5t1dBWiksHWfNxG1rH3gjq7K2hy2nbo5Yy1rFVdWHuP) and [fill](https://testnet.nearblocks.io/txns/D6oEnBvjdoBxBNU2a7RKyHtFsgi5wRt4dzKyjBdv28qw); `get_tombstones` |
| Graduation opens a built-in pool; sells then pay the better of pool and redeem | tests `buying_past_graduation_caps_the_buy_and_opens_the_pool`, `after_graduation_a_sell_takes_the_better_of_pool_and_redeem`; testnet [graduation](https://testnet.nearblocks.io/txns/8yzScLwzWWjZKjrCy75vSk9Bvj86eQ7Ff5KK5wTHoAN1) and [pool sell](https://testnet.nearblocks.io/txns/DGidEQb5TTKa78y8d2BjYZYnoJKHEHiubLA3gDQDzK5i) |
| Every product action works on testnet | [ARCHITECTURE.md, Flows](../ARCHITECTURE.md#a-coins-life): a transaction link for each step of launch, fair launch, buy, sell, challenge, defend, auction, graduation, pool sell, redeem and fee claims, from one run of `pnpm --filter scripts demo` |
| Graduated coins get a Rhea pool without anyone stepping in | The keeper's `listGraduated` (`scripts/src/keeper.ts`, `scripts/src/rhea.ts`); `deployments/testnet.json` `rhea_pools`; `$AI` testnet [pool 2977](https://testnet.rhea.finance/pool/2977), opened by the keeper after `$AI` graduated |
| The floor the app shows is the contract's floor | `/api/status` field `floor_matches_formula`; unit test `web/src/app/api/status/status.test.ts`; `pnpm verify --live-only` |
| Mint and burn log | `get_log` (last 100 in contract state) and a NEP-297 event for every change (`contracts/coin/src/events.rs`); the coin page's feed shows buys, sells and burns |
| 60 days simulated before choosing parameters | `cargo run -p sim --release -- --check`; [`docs/simulation.md`](simulation.md); the app's `/sim` page |
| Mainnet route is ready up to signing | `cd scripts && pnpm exec tsx src/mainnet-check.ts` (see below); `web/src/lib/mainnet-buy.test.ts`, `packages/client` 1Click tests |
| MetaMask and Phantom buyers hold their coins in their own NEAR Intents account; no account of ours holds their funds | The coin mints a delivered buy into NEAR Intents for the signer: `a_delivered_buy_mints_into_near_intents_for_the_signer` (`contracts/coin/src/tests.rs`). Every asset move is a message the wallet signs (`web/src/lib/server/xbuy.ts`); the relayer only calls `execute_intents` with signed payloads |
| A sell from NEAR Intents can't lose the holder's tokens | Only the verifier may send coins to the coin, and a sell that can't fill uses nothing, so NEAR Intents refunds the holder: `only_near_intents_may_send_coins_to_the_coin`, `a_near_intents_sell_that_cannot_fill_uses_nothing_so_the_holder_is_refunded` |
| The browser refuses a message that doesn't match the order | `checkPayload` (`packages/client/src/intents.ts`), run in `web/src/components/coin/xchain-buy.tsx` before each signature; tests in `packages/client/test/intents.test.ts` |
| Mainnet NEAR Intents accepts our MetaMask and Phantom signatures | `pnpm --filter scripts intents:check` → 8 PASS (read-only `simulate_intents`); `packages/client/test/intents.test.ts` reproduces a real 1Click nonce byte for byte and signs with real keys |

## What the memecoins track asks for, and where it is

The track prompt ([11-memecoins.md](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/11-memecoins.md)) asks for five things.

| The track asks for | Here | Where to check |
| --- | --- | --- |
| An NEP-141 token whose mechanic lives in the contract, not a backend that can be turned off | Each coin is one contract: NEP-141/145/148 token, curve, vault books, challenges, auction and graduation. Every keeper job (settle the launch, close an epoch, fill an auction) is a public method anyone can call | `contracts/coin`; `scripts/src/keeper.ts` only calls public methods |
| Parameters fixed at launch, publicly readable, no admin key | Curve constants are compiled in; fee, basket and round length are set at launch and readable with `get_config`. Coin accounts have no keys | `get_config`; `keys <coin>` → `[]` |
| Sybil resistance adequate for a demo, limits stated | Nothing counts accounts, so splitting across accounts gains nothing. See [Sybil limits](#sybil-limits-plainly) | this README |
| A page with the current state and a log of every mint and burn | The coin page shows stage, floor, the current round's challenge and defense, and a feed of buys, sells and burns rebuilt from the coin's events. On chain: `get_log` and NEP-297 events | `/c/<coin>`; `get_log` |
| Simulate 60 days of community behavior and chart supply under several scenarios | 4 scenarios × 20 seeds, built on the contract's own math crate; charts on `/sim` | `sim/`, `docs/simulation.md` |

## How it works

- **Basket units (BU).** At launch the creator picks 1–9 assets and their weights. One BU is a fixed amount of each asset. A buyer sends the whole basket in one batch transfer (the Intents batch limit is 10 tokens; one slot is kept for the swap). Unused amounts come back automatically.
- **Two-part price.** Price = curve price + `s`, where `s` is the vault's surplus per sold token. The curve uses virtual reserves of 5,000 BU and 1.073 billion tokens, the same shape as Pump.fun. A buyer pays `s` in and a seller takes `s` out.
- **Floor.** No sell pays less per token than the curve's lowest price plus `s` (before the fee). 30% of every trading fee goes to the vault, and burns leave their BU behind, so both raise `s`.
- **Fair launch.** For the first 2 minutes (demo profile; 10 in production), buys are queued. Then `settle_launch` mints them all at one average price, so being first gains nothing.
- **Seat challenge.** Each round (10 minutes in the demo profile, 7 days in production), anyone can burn tokens to challenge a non-anchored asset, and anyone can burn to defend it. The biggest challenge wins if it beats the defense and burned at least 3% of the asset's share of the vault. Burns are never refunded.
- **Auction.** A winning challenge opens a Dutch auction. It starts 20% above the reporter's fair rate and falls to that rate, never below. Anyone fills it by sending the new asset and receiving the old one. Partial fills work.
- **Graduation.** At 20,000 BU in the curve, 20% of the backing seeds a built-in constant-product pool and minting stops for good. After that, a sell pays the better of the pool price or redeeming for a share of the vault (0.5% of a redeem stays in the vault).

## Contracts

| Contract | What it is |
| --- | --- |
| `contracts/coin` | One coin: NEP-141/145/148, curve, fair launch, challenges, auction, graduation, owed-payout ledger, mint/burn log |
| `contracts/factory` | Deploys a coin at `<ticker>-<n>.<factory>` with no keys. The coin code is compiled into the factory |
| `contracts/mock-intents` | Testnet stand-in for `intents.near`: NEP-245 transfers, batch transfer-call with refunds (max 10 tokens), and a faucet |
| `contracts/mock-swapper` | Testnet stand-in for 1Click: swaps at a fixed price table minus 0.3% |
| `crates/curve-math` | All the math, pure Rust, shared by the coin and the simulator |

Exact method signatures and JSON shapes: [`docs/interface.md`](interface.md). Every directory, the important files in each, and each flow end to end: [ARCHITECTURE.md](../ARCHITECTURE.md).

## Trust assumptions

- **Coins have no admin.** Coin accounts have no access keys, and no coin method checks for an owner.
- **The factory account still has a key.** `pad.backedlab.testnet` has one full-access key, held by us (check: `keys pad.backedlab.testnet`). With it we could deploy different factory code, which would affect coins launched after that. It cannot touch existing coins: they have no keys and their code cannot change.
- **Prices come from one reporter account we run.** Prices only set an auction's starting rate. They never affect buy, sell, redeem or the floor. The auction never goes below the posted fair rate, so a dishonest reporter could start an auction at a bad rate but not drain the vault through it.
- **The vault's host.** On testnet, the stand-in verifier holding the vaults is ours and has a key. On mainnet the vaults would sit on `intents.near`, whose DAO can pause, upgrade or move balances. Our contracts have no admin, but the vault's host does.
- **Wallets.** Any NEAR wallet through NEAR Connect, the testnet guest wallet, or a Privy embedded wallet (email or social sign-in, when Privy is configured for the host). On the mainnet build, also MetaMask (USDC on Base) or Phantom (USDC on Solana). The user signs every transaction or message.
- **MetaMask and Phantom buys (mainnet: one full real round trip from Base; Solana not yet run with real funds).** The buyer's funds sit in their own NEAR Intents account at every step, and moving them takes a message their wallet signs. Our server builds those messages; the browser checks each one with `checkPayload` before the wallet signs. The browser fills in the signer (the wallet's own address), the NEAR Intents contract and the coin itself. The deposit addresses and spending caps come from our server with the order, and the wallet shows the full text of every message. Our relayer account (`router.<master>`) only submits signed messages with `execute_intents` after `simulate_intents` and pays the gas; it cannot change them. The USDC deposit and the swaps go through 1Click, a NEAR Intents service we don't run; if a deposit fails, 1Click refunds it to the buyer's wallet on its own chain.

## Sybil limits, plainly

Nothing in the contracts counts accounts. Fair-launch allocation is pro rata to the BU deposited, so splitting a deposit across accounts gains nothing. Challenges are decided by BU burned, not by votes, so extra accounts add no weight. The limits: a single large holder can win or block any challenge by burning more, and the fair-launch window has a minimum buy of 1 BU and a cap of 18,000 BU in total, not per account.

## Testnet and mainnet

The contracts are the same on both networks; only configuration and the swap route change. What differs, piece by piece: [ARCHITECTURE.md, Testnet and mainnet](../ARCHITECTURE.md#testnet-what-is-mocked). Mainnet asset ids: `deployments/mainnet.json`.

**Web app:** one env var, `NEXT_PUBLIC_NETWORK=testnet|mainnet` (default `testnet`). `web/src/lib/network.ts` picks `deployments/<network>.json`, the RPCs, the explorer and the wallet network.

- On mainnet, a buy gets the basket through 1Click inside NEAR Intents: one NEP-413 signed intent per asset (quote, generate-intent, sign, submit, wait), then the same transfer of the basket to the coin (`web/src/lib/mainnet-buy.ts`). USD prices come from 1Click `/v0/tokens`.
- MetaMask and Phantom: one USDC transfer from Base or Solana into the buyer's own NEAR Intents account, then signed messages for the swaps and the buy (`web/src/lib/server/xbuy.ts`, [ARCHITECTURE.md, flow 6](../ARCHITECTURE.md#buying-from-base-or-solana)).
- The faucet, gas top-ups and the guest wallet exist only on testnet.

**Scripts:** `NETWORK=mainnet` plus `--yes-mainnet` (they refuse mainnet without the flag). `deploy` keeps the real asset list already in `deployments/mainnet.json`; the reporter posts 1Click prices; the keeper fills auctions through 1Click, capped by `KEEPER_MAX_FILL_USD` (default $10).

**Mainnet readiness check (read-only, signs nothing):**

```bash
cd scripts && pnpm exec tsx src/mainnet-check.ts
```

Expected: `PASS` for mainnet RPC and `intents.near` views, `PASS` for a 1Click route from USDC to each of BTC, ETH, SOL, PEPE, DOGE, WIF and wNEAR, and `PASS` for a real quote → `/v0/generate-intent` → a NEP-413 payload that is hashed but **not signed**. The one `FAIL` is "factory deployed on mainnet": nothing is deployed there yet. Deploying needs the owner's go and a budget of about $1–4 for test buys ([`docs/mainnet-runbook.md`](mainnet-runbook.md)).

**Wallet signatures (read-only, signs only with throwaway keys, sends nothing):**

```bash
pnpm --filter scripts intents:check
```

Expected: `PASS` on 4 checks for each of MetaMask (ERC-191) and Phantom (raw Ed25519), 8 in all.

**What is not tested:** on mainnet, one real round trip has run through the MetaMask path (Base USDC → $DEGEN → sell → cash-out to Base; transactions in the [README](../README.md#first-real-round-trip-base--degen--base)). The Phantom path (Solana), NEAR-wallet buys through 1Click and keeper fills have not moved real funds yet.

## Live browser test

`web/e2e/live.spec.ts` is a real end-to-end run on testnet in a browser, with no wallet app: open `$DEGEN` → Connect → Guest wallet (gas and test USDC arrive by themselves) → buy $5 (swap, then send the basket to the coin) → see the position → sell half. Every step is a real testnet transaction, and the test prints the explorer links. It needs a running app whose server holds the relayer key:

```bash
cd web && E2E_BASE_URL=http://127.0.0.1:3311 pnpm test:live   # E2E_BASE_URL defaults to http://127.0.0.1:3311
```

Recorded run, Nov 13, 2026: **1 passed in 54 s**, 4 real testnet transactions: [BPPj4c4W…](https://testnet.nearblocks.io/txns/BPPj4c4WsWvwXK6gY11M6upBaW1Cmy2v8AJ4TyZLFLUb), [HXJM9Mpk…](https://testnet.nearblocks.io/txns/HXJM9MpkNjoXUbyjdWtwyCJvx3vjjeHKmxdUQxMXNSmU), [FvymWUch…](https://testnet.nearblocks.io/txns/FvymWUch3Acg3DYm7bnCTZtXZ6eF512tiXLbCDfuaDgs), [AvDkNzEL…](https://testnet.nearblocks.io/txns/AvDkNzELBL5A8Y1Uzn6yqwHSTd8T8LPh38ZmhzxntiPU).

## Embed

`/widget/<coin>` is a compact coin card that any site can show in an iframe (it is served with `frame-ancestors *`; every other page only allows this site). Inside another site's frame it never signs: Buy opens the coin page in a new tab, so a framing page can't trick a click into a trade.

On X, a coin link (`/c/<coin>`) unfurls as a player card: `/x/<coin>` runs inside the post, its own small card (`web/src/components/x-card.tsx`: price, a price-over-floor sparkline, % backed, basket, $5/$20/$50 and one Buy button). One tap makes a testnet guest wallet, waits for its free gas and test USDC, and buys; one more tap sells. The image from `/api/og/<coin>` is the poster. That page's CSP lets only `x.com` / `twitter.com` frame it, so it may trade in place. X's card rules are written for audio and video players, so X may decide to show only the image; the link still opens the coin page. X renders it in a real post (checked by the owner on Nov 14); the one-tap buy and sell are tested in a frame served as x.com (`web/e2e/live.spec.ts`). The coin page's Share section has Post on X, Copy link and Copy embed code.

```html
<iframe src="https://basketcase-testnet.vercel.app/widget/degen-0.pad.backedlab.testnet" width="420" height="640" style="border:0;border-radius:20px"></iframe>
```

## Seen on testnet

Deployed November 12, 2026 under `backedlab.testnet` (full list: `deployments/testnet.json`):

| Role | Account |
| --- | --- |
| Factory | [`pad.backedlab.testnet`](https://testnet.nearblocks.io/address/pad.backedlab.testnet) |
| Verifier stand-in | [`intents.backedlab.testnet`](https://testnet.nearblocks.io/address/intents.backedlab.testnet) |
| Swapper stand-in | [`swapper.backedlab.testnet`](https://testnet.nearblocks.io/address/swapper.backedlab.testnet) |
| `$DEGEN` (BTC anchored + one challengeable seat) | [`degen-0.pad.backedlab.testnet`](https://testnet.nearblocks.io/address/degen-0.pad.backedlab.testnet) |
| `$TRENCH` (memecoins: PEPE, DOGE, WIF, BONK at launch) | [`trench-0.pad.backedlab.testnet`](https://testnet.nearblocks.io/address/trench-0.pad.backedlab.testnet) |
| `$CHIPS` (NVDA anchored, BTC, SOL at launch) | [`chips-0.pad.backedlab.testnet`](https://testnet.nearblocks.io/address/chips-0.pad.backedlab.testnet) |
| Full-lifecycle demo coin (graduated) | [`demo1283-0.pad.backedlab.testnet`](https://testnet.nearblocks.io/address/demo1283-0.pad.backedlab.testnet) |

Basket assets on testnet are stand-in tokens (`nep141:btc.mock`, `nep141:nvda.mock`, …) minted by the stand-in verifier. They are not real BTC or stocks. Baskets change as challenges win; `get_basket` shows the current one.

**Whose activity this is.** Most trades on the testnet coins come from our own accounts: `trader1`–`trader3.backedlab.testnet` (`scripts/src/activity.ts`), `alice` and `bob` (the demo run), and `keeper.backedlab.testnet`, which closes rounds and fills auctions. They exist so the charts and logs have history; the app tags them "test trader". Any other account is an outside user.

## Run it yourself

```bash
./scripts/build-contracts.sh                                   # wasm for the four contracts (needs wasm32 target and wasm-opt)
pnpm --filter scripts exec tsx src/faucet.ts <you.testnet> 3   # testnet NEAR from the faucet
pnpm --filter scripts deploy <you.testnet>
pnpm --filter scripts seed <you.testnet>
pnpm --filter scripts demo <you.testnet>                       # ~15 min: every action once, a link per transaction
pnpm --filter scripts keeper <you.testnet>                     # optional: closes rounds and fills auctions on time
pnpm --filter web dev                                          # the web app, reading deployments/testnet.json
```

`cargo build` on the host fails by design (near-sdk targets wasm). Use `cargo test` or `./scripts/build-contracts.sh`.

## Prior art and how this differs

| Project | What it does | Difference |
| --- | --- | --- |
| [Floorpad](https://github.com/Lumin-chain/floorpad) (this hackathon) | Meme launchpad; each coin has a rising-floor vault in NEAR/LiNEAR | Single-asset floor. Here the vault is a multi-asset basket from many chains, and holders fight over what it holds |
| [CONSUME](https://github.com/ethboi/consume) (this hackathon) | One coin that absorbs cross-chain memecoins through an Intents receiver; pays out through vesting NFTs | One coin, and a USD price feed values every deposit. Here anyone launches a coin, and trades never read a price |
| [The Pit](https://github.com/drained69/thepit) (this hackathon) | Launchpad; each coin trades on a curve against its own staked reserve | No basket floor and no challenges |
| [Tripwire](https://github.com/demir-sama/tripwire) (this hackathon) | Rug-proof launchpad with contract-enforced rules | Keyless like ours; no vault-backed floor |
| [nearbags](https://github.com/prakhar728/nearbags) (this hackathon) | Baskets of crypto and tokenized stocks on mainnet NEAR Intents | An index product, not a memecoin; no curve or floor. It has real mainnet flows; ours are built but not yet run with real funds |
| pump.fun, meme.cooking | Bonding-curve launchpads | No vault-backed floor |
| Baseline Markets (EVM) | Rising-floor liquidity for a token | Single-asset; no holder-steered basket |

## Disclosures

- **When it was built (Q-001, Q-002).** All code here was written during the hackathon window, starting November 12, 2026. It is not a port of an existing product on another chain.
- **AI-assisted code (Q-005).** Much of the code and documentation was written with AI coding agents (Claude Code), directed by the team.
- **Libraries (Q-005).** Rust: near-sdk 5.30, near-contract-standards, `uint` (256-bit math), proptest. TypeScript: near-api-js 7, Next.js 16, React 19, Tailwind CSS 4, TradingView Lightweight Charts 5, `@hot-labs/near-connect`, `@privy-io/react-auth`, vitest, Playwright, tsx. Fonts: Bricolage Grotesque, JetBrains Mono. Services: FastNEAR RPC, NEARBlocks API, and the 1Click API (quotes and prices).
- **Test traders.** Most testnet trades come from our own accounts (see [Whose activity this is](#seen-on-testnet)).

## Where to read more

- [ARCHITECTURE.md](../ARCHITECTURE.md): code structure, every flow end to end with its files, tests and testnet transactions, and how to verify.
- [`docs/interface.md`](interface.md): exact contract methods and JSON shapes.
- [`docs/mainnet-runbook.md`](mainnet-runbook.md): the mainnet steps and what they cost.
- [`docs/simulation.md`](simulation.md): the 60-day simulation (generated by `cargo run -p sim --release`).
- [`web/public/llms.txt`](../web/public/llms.txt): a short machine-readable summary.

MIT licensed (see `LICENSE`).
