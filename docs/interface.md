# Contract interface

The exact JSON every off-chain part (web, scripts, `packages/client`) uses. The contracts are the same on testnet and mainnet; on mainnet the verifier is `intents.near` and swaps go through 1Click instead of the stand-in swapper. Conventions:

- Amounts are decimal strings (`U128`).
- Times are milliseconds since epoch, as JSON numbers.
- BU and coin tokens have 18 decimals.
- Prices are scaled by 1e18 in BU per token. Reporter prices are USD per raw unit, scaled by 1e36.

## Deployment file

`deployments/<network>.json` is written by `scripts/deploy` (and, for the one-coin mainnet demo, `scripts/src/mainnet-coin.ts`). Off-chain code reads it; nothing hard-codes account ids. The testnet file looks like this:

```json
{
  "network": "testnet",
  "rpc": "https://rpc.testnet.fastnear.com",
  "factory": "<factory>.testnet",
  "verifier": "<mock-intents>.testnet",
  "swapper": "<mock-swapper>.testnet",
  "reporter": "<reporter>.testnet",
  "protocol": "<protocol>.testnet",
  "tokens": [{ "symbol": "USDC", "token_id": "nep141:usdc.mock", "decimals": 6 }]
}
```

The token list matches `constants.json` `testnet_tokens`.

## Factory

| Method | Kind | Args | Returns / notes |
| --- | --- | --- | --- |
| `create_coin` | change, deposit `launch_deposit`, 300 TGas | `{config: LaunchConfig}` | Coin account id. Panics on bad config |
| `list_coins` | view | `{from: number, limit: number}` | `[CoinInfo]`, oldest first |
| `get_coin` | view | `{account_id}` | `CoinInfo \| null` |
| `get_config` | view | `{}` | `{reporter, protocol, verifier, launch_deposit, coin_count}` |

```ts
type LaunchConfig = {
  ticker: string;            // 2-10 chars, A-Z and 0-9
  name: string;
  icon: string | null;       // small data URL
  basket: { token_id: string; weight_bps: number; q: string; anchored: boolean }[]; // 1-9 assets, weights sum to 10000
  fee_bps: number;           // 25-100
  epoch_profile: "demo" | "prod";
  bu_usd_e6: number;         // dollar size of 1 BU at launch, x1e6 (display only)
  creator: string | null;    // defaults to the caller
};
type CoinInfo = { account_id: string; ticker: string; name: string; creator: string; created_ms: number };
```

The coin account is `<ticker lowercase>-<n>.<factory>`. The launch page computes `q` from prices: `q_i = weight_i / 10000 * bu_usd / usd_price_i * 10^decimals_i`, rounded up.

## Coin

### Views

| Method | Args | Returns |
| --- | --- | --- |
| `get_config` | `{}` | `CoinConfig` |
| `get_state` | `{}` | `CoinState` |
| `get_basket` | `{}` | `BasketEntry[]`. During an auction, the incoming asset appears with `q = 0` until its first fill. For a buy, send exactly `quote_buy.token_ids` |
| `quote_buy` | `{bu_in}` | `BuyQuote` |
| `quote_sell` | `{amount}` | `SellQuote` |
| `get_epoch` | `{}` | `EpochView` |
| `get_auction` | `{}` | `AuctionView \| null` |
| `get_prices` | `{}` | `{token_id, price, ts_ms}[]` |
| `get_tombstones` | `{from, limit}` | `Tombstone[]` |
| `get_log` | `{}` | `LogEntry[]`, newest first, up to 100 |
| `get_launch_queue` | `{from, limit}` | `{account_id, bu}[]` |
| `get_owed` | `{account_id}` | `{token_id, amount}[]` |
| NEP-141 / NEP-145 | standard | `ft_balance_of`, `ft_total_supply`, `ft_metadata`, `storage_balance_of`, `storage_balance_bounds` |

```ts
type CoinConfig = {
  ticker: string; name: string; icon: string | null;
  factory: string; creator: string; protocol: string; verifier: string; reporter: string;
  fee_bps: number; redeem_fee_bps: number; epoch_profile: "demo" | "prod";
  epoch_len_ms: number; window_ms: number; auction_len_ms: number; staleness_ms: number;
  bu_usd_e6: number; x0: string; y0: string; grad_reserve: string; launch_ms: number;
};
type CoinState = {
  mode: "launch" | "curve" | "index";      // launch = fair-launch window or settling
  reserve: string; surplus: string; creator_owed: string; protocol_owed: string;
  pool_bu: string; pool_tokens: string;     // index mode only, else "0"
  sold: string; supply: string; circulating: string; b_total: string;
  price: string;                            // BU per token (1e18): what the next buyer pays per token
  floor: string;                            // BU per token (1e18): no sell pays less (before fee)
  surplus_per_token: string;                // s (1e18), curve mode
  launch: { ends_ms: number; queued_accounts: number; queued_bu: string; settled: boolean };
  epoch: { index: number; start_ms: number; end_ms: number };
  auction_open: boolean;
  graduated_ms: number | null;
};
type BasketEntry = { token_id: string; q: string; held: string; anchored: boolean; weight_bps: number; joined_epoch: number };
type BuyQuote = {
  bu_in: string; fee: string; net: string; tokens_out: string;
  unused: string; graduates: boolean; queued: boolean;   // queued = in the fair-launch window
  token_ids: string[]; amounts: string[];               // exactly what to send
};
type SellQuote = { amount: string; gross_bu: string; fee: string; out_bu: string; path: "curve" | "pool" | "redeem"; token_ids: string[]; amounts: string[] };
type EpochView = {
  index: number; start_ms: number; end_ms: number;
  challenges: { target: string; replacement: string; burned_bu: string; top_challenger: string }[];
  defenses: { target: string; burned_bu: string }[];
  min_burn: { target: string; min_bu: string }[];
};
type AuctionView = {
  id: number; target: string; replacement: string;
  target_total: string; target_left: string; replacement_received: string;
  fair_rate: string; rate_now: string;       // replacement raw units per target raw unit, 1e18
  start_ms: number; ramp_end_ms: number; challenger: string;
};
type Tombstone = { token_id: string; joined_epoch: number; removed_epoch: number; challenger: string; rate: string; ts_ms: number };
type LogEntry = { ts_ms: number; kind: "mint" | "burn"; account_id: string; tokens: string; bu: string; reason: string; price_after: string };
```

### Change methods

| Method | Deposit | Args | Notes |
| --- | --- | --- | --- |
| `storage_deposit` | `storage_balance_bounds().min` | `{account_id?, registration_only: true}` | Required before the first buy. A buy for an unregistered recipient is refunded in full |
| `sell` | 1 yocto | `{amount, min_bu_out, receiver_id?}` | Basket assets arrive on the verifier for `receiver_id` (default: caller). In Index mode it pays `max(pool, redeem)` |
| `ft_transfer_call` to the coin itself | not checked | `{receiver_id: <coin>, amount, memo, msg: '{"action":"sell","min_bu_out":"…","receiver_id":"…"}'}` | **Verifier only**: how NEAR Intents sells a holder's tokens (an `ft_withdraw` intent the holder signed). Basket assets go to `receiver_id` on the verifier. Never panics: a sell that can't fill returns `"0"` used, so the verifier refunds the holder. From any other caller it panics with `use sell to trade with the pool`; `ft_transfer` to the coin is refused the same way |
| `redeem` | 1 yocto | `{amount, receiver_id?}` | Index mode only |
| `challenge` | 1 yocto | `{target, replacement, amount}` | Burns `amount` tokens |
| `defend` | 1 yocto | `{target, amount}` | Burns `amount` tokens |
| `report_prices` | none | `{prices: [[token_id, price]]}` | Reporter only |
| `close_epoch` | none | `{}` | Anyone, after `epoch.end_ms` |
| `settle_launch` | none | `{limit}` | Anyone, after the window |
| `claim_fees` | none | `{}` | Pays creator and protocol |
| `withdraw_owed` | none | `{account_id}` | Retries failed payouts |
| `redeliver` | none | `{account_id}` | Moves a wallet account's (`0x`+40 hex, or 64 hex) direct coin balance into NEAR Intents under that same account; anyone may call it |

**Buy.** Call the verifier:

```text
<verifier>.mt_batch_transfer_call({
  receiver_id: <coin>,
  token_ids: quote.token_ids,
  amounts: quote.amounts,
  approvals: null, memo: null,
  msg: JSON.stringify({ action: "buy", recipient?: string, min_tokens_out: string, deliver?: boolean })
})
```

It needs 1 yocto and 250 TGas. Unused amounts come back automatically. In the fair-launch window a buy is queued: it needs at least 1 BU after the fee, `min_tokens_out` is ignored, and the tokens are minted by `settle_launch`.

With `deliver: true` the coin mints to the verifier's own balance and calls `<verifier>.ft_on_transfer({sender_id: <coin>, amount, msg: <recipient>})`, so the tokens are credited to `recipient` (default: the sender) inside NEAR Intents. The verifier must be registered on the coin (`storage_deposit` for the verifier account). A delivered buy during the fair-launch window is refunded in full (`deliver_after_launch`). If NEAR Intents does not take the delivery, the private callback `on_delivered` credits the unused part to the buyer's own balance on the coin (never the pool), and `redeliver` moves it into NEAR Intents later.

**Fill an auction.** Call `<verifier>.mt_transfer_call({receiver_id: <coin>, token_id: auction.replacement, amount, msg: JSON.stringify({action: "fill_auction", min_out})})`.

### Events

Each event is logged as `EVENT_JSON:{"standard":"backed","version":"1.0.0","event":<name>,"data":[...]}`. The names are:
- `buy`, `queue`, `settle`, `sell`, `burn`, `refund` (a buy or fill refunded in full, with `reason`: `not_registered`, `basket_mismatch`, `too_small`, `slippage`, `launch_settling`, `below_min_deposit`, `window_full`, `bad_msg`, `deliver_after_launch`, `no_auction`, `auction_done`, `wrong_token`, `below_min_out`)
- `challenge`, `defend`, `epoch_closed`
- `auction_opened`, `auction_fill`, `basket_changed`
- `graduated`, `redeem`, `fees_claimed`, `payout_failed`

## mock-intents (testnet verifier)

| Method | Kind | Args |
| --- | --- | --- |
| `faucet` | change | `{token_id, amount, receiver_id?}`. At most `1e30` raw units per call |
| `mt_balance_of` | view | `{account_id, token_id}` → string |
| `mt_batch_balance_of` | view | `{account_id, token_ids}` → string[] |
| `mt_transfer` | change, 1 yocto | `{receiver_id, token_id, amount, approval: null, memo: null}` |
| `mt_batch_transfer` | change, 1 yocto | `{receiver_id, token_ids, amounts, approvals: null, memo: null}` |
| `mt_transfer_call` | change, 1 yocto | `{receiver_id, token_id, amount, approval: null, memo: null, msg}` |
| `mt_batch_transfer_call` | change, 1 yocto | `{receiver_id, token_ids, amounts, approvals: null, memo: null, msg}`, up to 10 tokens |

## mock-swapper (testnet 1Click stand-in)

| Method | Kind | Args |
| --- | --- | --- |
| `get_prices` | view | `{}` → `[[token_id, usd_per_raw_e36]]` |
| `quote_out` | view | `{token_in, token_out, amount_in}` → amount out |
| `quote_in` | view | `{token_in, token_out, amount_out}` → amount in needed |
| `set_prices` | change, owner | `{prices: [[token_id, price]]}` |

A swap is a `<verifier>.mt_transfer_call` to the swapper with one of two messages:
- `{"want": token_out, "amount_out": "...", "recipient"?}` for exact output; the excess input is refunded.
- `{"want": token_out, "min_out": "...", "recipient"?}` for exact input.

The swapper charges 0.3% and pays out through the verifier.

## The two-step buy, as the web app and scripts do it on testnet

1. `quote = coin.quote_buy({bu_in})`.
2. For each `token_ids[i]` other than USDC, call `verifier.mt_transfer_call` to the swapper with `amount = swapper.quote_in(USDC, token_ids[i], amounts[i])` and `{"want": token_ids[i], "amount_out": amounts[i]}`. Put all of these in one transaction, as several actions.
3. A second transaction, if not already registered: `coin.storage_deposit`. Then `verifier.mt_batch_transfer_call` to the coin with `{action: "buy"}`.

On mainnet, step 2 is one NEP-413 intent per asset signed by the NEAR wallet and sent through 1Click (`web/src/lib/mainnet-buy.ts`, `packages/client/src/oneclick.ts`); step 3 is the same.

## NEAR Intents messages signed by MetaMask or Phantom (mainnet)

Built by `packages/client/src/intents.ts`; the formats follow the NEAR Intents contract source (`github.com/near/intents`).

- **Signer.** The wallet's account inside NEAR Intents: the lowercase EVM address (MetaMask), or the hex of the 32-byte Solana public key (Phantom).
- **Payload** (the exact string signed; key order fixed): `{"signer_id","verifying_contract":"intents.near","deadline":<ISO time>,"nonce":<base64>,"intents":[…]}`. The nonce is the versioned V1 layout: `5628f6c6`, version `00`, the 4-byte `current_salt` of `intents.near`, the deadline in nanoseconds (i64 LE), 15 random bytes.
- **Signed forms.** MetaMask `personal_sign`: `{"standard":"erc191","payload","signature":"secp256k1:<base58 of r||s||v>"}`, with v as 0 or 1. Phantom `signMessage` over the payload's UTF-8 bytes: `{"standard":"raw_ed25519","payload","public_key":"ed25519:<base58>","signature":"ed25519:<base58>"}`.
- **Buy intent.** `{"intent":"transfer","receiver_id":<coin>,"tokens":{<token_id>:<amount>,…},"msg":"{\"action\":\"buy\",\"deliver\":true,\"min_tokens_out\":\"…\"}","min_gas":"150000000000000"}`. NEAR Intents calls the coin's `mt_on_transfer` with the signer as `sender_id`.
- **Sell intent.** `{"intent":"ft_withdraw","token":<coin>,"receiver_id":<coin>,"amount","msg":"{\"action\":\"sell\",\"min_bu_out\":\"…\",\"receiver_id\":<signer>}","min_gas":"150000000000000"}`. NEAR Intents calls the coin's `ft_transfer_call` (see Change methods).
- **Submission.** Any account may call `intents.near.execute_intents({signed: [...]})`; ours runs `simulate_intents({signed})` (a view) first. The submitter pays gas and cannot change a signed payload.
- **Before signing.** `checkPayload(payload, rules)` refuses a payload for another verifier or signer, a deadline out of range, a transfer to anyone but the order's receivers, a coin transfer that is not a delivered buy (or one paying another recipient, or with no `min_tokens_out`), a withdrawal that is not a sell of the coin paying the signer (or one with no `min_bu_out`), any other intent type, or spending above the order's caps. `checkPayloads` applies the caps to all of an order's messages together. `checkOneClickDeposit` asks 1Click itself (`/v0/status`) about every deposit address a message pays: it must be a real quote for the token sent, for at least the amount sent, into an allowed destination, with at most 3% slippage, paying and refunding only the signer's own account or wallet address.
