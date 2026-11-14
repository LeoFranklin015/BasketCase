# Mainnet runbook: one demo coin, bought from MetaMask (Base) or Phantom (Solana), for well under $1

Everything here spends real money, so each step runs only after the owner says go. Scripts refuse to touch
mainnet without `NETWORK=mainnet` **and** `--yes-mainnet`.

## The plan

One coin, `$DEGEN` (50% BTC, anchored + 50% USDC), deployed **directly** to `degen.<master>.near`: no factory,
no reporter/protocol/keeper accounts (the master plays those roles). The coin account keeps its key, so after
the demo we delete it and its whole storage deposit comes back. A buy needs one 1Click swap (the BTC half);
the USDC half needs none.

Honest difference from testnet: testnet coins are launched by the factory and have **no keys** (the design).
This mainnet demo coin keeps a key only so its deposit can be recovered; the README says so.

## What it costs

```bash
cd scripts && pnpm mainnet:cost            # live: real code size + today's NEAR price; signs nothing
pnpm mainnet:cost --factory                # the full factory + keyless-coin setup, for comparison
```

On Nov 14, 2026 (NEAR $3.33):

| Item | NEAR | USD | Afterwards |
| --- | --- | --- | --- |
| The coin's storage deposit (343 KB code + 25 KB state) | 3.69 | $12.29 | **all back** when the coin is deleted |
| Gas (create, deploy, buy, sell, delete) | 0.06 | $0.20 | spent |
| Registrations (NEAR Intents' storage on the coin, paid once by the master; a NEAR-wallet buyer's coin storage and NEAR Intents key) | 0.01 | $0.03 | spent |
| `router.<master>`: the relayer that submits buyers' signed messages and pays their gas | 0.30 | $1.00 | back, minus the gas used, when `mainnet-cleanup` deletes it |
| Test buy of $2 USDC, then sell | | $2.00 | ~$1.93 back (1% fee each way, ~0.5% 1Click spread, ~1% left in the vault) |

**Wallet holds for the demo ≈ 4.1 NEAR (~$13.5); the buyer brings $2 USDC on Base or Solana. Actually spent ≈ $0.35.**

NEAR charges no fee for code; it holds a refundable deposit of 1 NEAR per 100 KB while the code is stored.
That deposit is why the wallet needs ~4.1 NEAR for the duration, and why it all comes back on deletion.
(The factory setup instead locks ~4 NEAR in a keyless coin for good and needs ~10 NEAR up front.)

## Before you start (owner)

1. A mainnet account you control, e.g. `backedlab.near`, holding ~4.1 NEAR.
2. Its key in `~/.near-credentials/mainnet/backedlab.near.json` (NEAR CLI: `near account import-account …`, network mainnet). Never paste the key in chat.
3. For the test buy: $2 of USDC on Base in MetaMask plus a few cents of ETH on Base for gas (or $2 USDC + ~0.003 SOL in Phantom).
4. `pnpm verify --mainnet-check` shows every step PASS except "factory deployed on mainnet (or the one demo coin)".

## Buying and selling from MetaMask or Phantom (how it works)

No account of ours holds the buyer's funds. The buyer's wallet owns an account inside NEAR Intents: the lowercase EVM
address for MetaMask, or the hex of the Solana public key for Phantom. Every step that moves an asset out of it is a
message the wallet signs. Code: `web/src/lib/server/xbuy.ts`, `packages/client/src/intents.ts`,
`web/src/components/coin/xchain-buy.tsx`; the full flow is in `ARCHITECTURE.md`, flow 6.

**Buy**

1. On the coin page the buyer picks **MetaMask · USDC on Base** or **Phantom · USDC on Solana** and an amount ($1–25).
2. Our server (`/api/xbuy`) asks 1Click for a quote: that USDC → NEAR USDC, delivered into the buyer's own NEAR Intents
   account. The wallet sends one ordinary USDC transfer to the returned deposit address (MetaMask switches to Base;
   Phantom also creates the deposit address's USDC account if needed). If the deposit fails, 1Click refunds it to the
   buyer's wallet on Base or Solana.
3. When the USDC lands, the wallet signs the messages: one 1Click swap intent per basket asset (here the BTC half; the
   USDC half needs none) and our buy, a NEAR Intents `transfer` of the basket to the coin with msg
   `{"action":"buy","deliver":true,"min_tokens_out":…}`. MetaMask signs with ERC-191 `personal_sign`, Phantom with
   Ed25519 `signMessage`. The browser runs `checkPayload` on every message before the wallet signs it.
4. The swaps go to 1Click. When they settle, the relayer `router.<master>` runs the signed buy through
   `simulate_intents` and submits it with `execute_intents`, paying the gas. It cannot change what was signed.
5. The coin's `mt_on_transfer` mints the tokens to `intents.near` and calls `ft_on_transfer` with the signer as
   receiver, so the tokens sit in the buyer's NEAR Intents account. If a swap fails, nothing reaches the coin: the
   USDC and anything already swapped stay in the buyer's own NEAR Intents account.

During the coin's 2-minute fair-launch window, delivered buys are refunded in full (`deliver_after_launch`); buy after
it ends.

**Sell and cash out**

1. **Sell**: the wallet signs one `ft_withdraw` intent of the coin to the coin with msg
   `{"action":"sell","min_bu_out":…,"receiver_id":<signer>}`; the relayer submits it. The coin accepts a transfer to
   itself only from `intents.near`. The basket assets (BTC and USDC) go back to the seller's NEAR Intents account. A
   sell that can't fill uses nothing, so NEAR Intents refunds the tokens to the holder.
2. **Cash out**: the wallet signs one 1Click swap per asset held, to USDC on Base or Solana, paid to its own address.

Orders are kept in MongoDB when `MONGODB_URI` is set (needed on Vercel, where requests share no disk; database `MONGODB_DB`, default `basketcase`, collection `xbuy_orders`, entries expire after 14 days). Without it they go to `~/backed-ops/xbuy-orders.json` (outside the repo), so a restart of a long-running server doesn't lose them.

Tested without spending: contract unit tests for the delivered buy and the verifier sell (`contracts/coin/src/tests.rs`),
client tests that sign with real secp256k1 and ed25519 keys (`packages/client/test/intents.test.ts`), and
`pnpm --filter scripts intents:check`, which shows mainnet NEAR Intents accepts our MetaMask and Phantom signatures
(8 PASS, read-only). **No real funds have moved through this flow yet.**

The buyer needs: $1+ USDC on Base and a few cents of ETH on Base for gas (MetaMask), or $1+ USDC on Solana and ~0.003
SOL (Phantom).

## Run it

```bash
cd scripts
# 1. Create degen.backedlab.near (3.69 NEAR) and the relayer router.backedlab.near (0.3 NEAR), deploy the coin,
#    register intents.near on it, write deployments/mainnet.json and ~/backed-ops/router.env
#    (the relayer key, mode 600, read by the mainnet web service; never commit it).
NETWORK=mainnet pnpm exec tsx src/mainnet-coin.ts backedlab.near --yes-mainnet
# 2. Every readiness step should now PASS, and NEAR Intents should accept wallet signatures.
pnpm mainnet:check
pnpm intents:check
```

3. Rebuild the mainnet web build and restart it wherever it is hosted: `NEXT_PUBLIC_NETWORK=mainnet pnpm --filter web build`. It reads `deployments/mainnet.json` at build time, and its server needs `ROUTER_ACCOUNT_ID` and `ROUTER_PRIVATE_KEY` from `~/backed-ops/router.env`. The coin is at `<mainnet site>/c/degen.backedlab.near`.
4. After the 2-minute fair-launch window, buy $2 from the mainnet site: **MetaMask · USDC on Base** (or Phantom on Solana). Watch the steps finish; the tokens show up in NEAR Intents under your wallet's address. Then sell and cash out. Optionally also buy $1 with a NEAR wallet.
5. Record the transaction links in the README ("Claims and the evidence for each") and change the "not tested with real money" statements in README.md and ARCHITECTURE.md to what actually ran.

## After the demo: get it back

```bash
# Deletes the relayer router.backedlab.near (its NEAR back). With --coin it also deletes the coin (3.69 NEAR back);
# that refuses while tokens are out unless --force (tokens held in NEAR Intents then become worthless: tell buyers first).
NETWORK=mainnet pnpm exec tsx src/mainnet-cleanup.ts backedlab.near --yes-mainnet --coin
```

Selling paid out BTC + USDC to your NEAR Intents balance; **Cash out** on the coin page swaps them to USDC on Base or Solana
(or use any NEAR Intents app).
Delete the coin only after judging if you want the mainnet link to stay live for judges.

## The full setup (not needed for the demo)

`deploy.ts` + `mainnet-launch.ts` deploy the factory and a keyless coin exactly as on testnet. It needs ~10.4 NEAR up front and keeps ~4 NEAR locked in the coin for good (`pnpm mainnet:cost --factory`).
