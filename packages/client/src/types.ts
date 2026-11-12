/**
 * Types mirroring docs/interface.md exactly. Amounts are decimal strings (U128),
 * times are milliseconds since epoch, BU and coin tokens have 18 decimals.
 */

export type TokenInfo = { symbol: string; token_id: string; decimals: number };

/** deployments/testnet.json */
export type Deployment = {
  network: "testnet" | "mainnet";
  rpc: string;
  factory: string;
  verifier: string;
  swapper: string;
  reporter: string;
  protocol: string;
  tokens: TokenInfo[];
};

export type EpochProfile = "demo" | "prod";

export type LaunchBasketEntry = { token_id: string; weight_bps: number; q: string; anchored: boolean };

export type LaunchConfig = {
  ticker: string;
  name: string;
  icon: string | null;
  basket: LaunchBasketEntry[];
  fee_bps: number;
  epoch_profile: EpochProfile;
  bu_usd_e6: number;
  creator: string | null;
};

export type CoinInfo = { account_id: string; ticker: string; name: string; creator: string; created_ms: number };

export type FactoryConfig = {
  reporter: string;
  protocol: string;
  verifier: string;
  launch_deposit: string;
  coin_count: number;
};

export type CoinConfig = {
  ticker: string;
  name: string;
  icon: string | null;
  factory: string;
  creator: string;
  protocol: string;
  verifier: string;
  reporter: string;
  fee_bps: number;
  redeem_fee_bps: number;
  epoch_profile: EpochProfile;
  epoch_len_ms: number;
  window_ms: number;
  auction_len_ms: number;
  staleness_ms: number;
  bu_usd_e6: number;
  x0: string;
  y0: string;
  grad_reserve: string;
  launch_ms: number;
};

export type CoinMode = "launch" | "curve" | "index";

export type CoinState = {
  mode: CoinMode;
  reserve: string;
  surplus: string;
  creator_owed: string;
  protocol_owed: string;
  pool_bu: string;
  pool_tokens: string;
  sold: string;
  supply: string;
  circulating: string;
  b_total: string;
  price: string;
  floor: string;
  surplus_per_token: string;
  launch: { ends_ms: number; queued_accounts: number; queued_bu: string; settled: boolean };
  epoch: { index: number; start_ms: number; end_ms: number };
  auction_open: boolean;
  graduated_ms: number | null;
};

export type BasketEntry = {
  token_id: string;
  q: string;
  held: string;
  anchored: boolean;
  weight_bps: number;
  joined_epoch: number;
};

export type BuyQuote = {
  bu_in: string;
  fee: string;
  net: string;
  tokens_out: string;
  unused: string;
  graduates: boolean;
  queued: boolean;
  token_ids: string[];
  amounts: string[];
};

export type SellPath = "curve" | "pool" | "redeem";

export type SellQuote = {
  amount: string;
  gross_bu: string;
  fee: string;
  out_bu: string;
  path: SellPath;
  token_ids: string[];
  amounts: string[];
};

export type ChallengeTally = { target: string; replacement: string; burned_bu: string; top_challenger: string };
export type DefenseTally = { target: string; burned_bu: string };
export type MinBurn = { target: string; min_bu: string };

export type EpochView = {
  index: number;
  start_ms: number;
  end_ms: number;
  challenges: ChallengeTally[];
  defenses: DefenseTally[];
  min_burn: MinBurn[];
};

export type AuctionView = {
  id: number;
  target: string;
  replacement: string;
  target_total: string;
  target_left: string;
  replacement_received: string;
  fair_rate: string;
  rate_now: string;
  start_ms: number;
  ramp_end_ms: number;
  challenger: string;
};

export type Tombstone = {
  token_id: string;
  joined_epoch: number;
  removed_epoch: number;
  challenger: string;
  rate: string;
  ts_ms: number;
};

export type LogEntry = {
  ts_ms: number;
  kind: "mint" | "burn";
  account_id: string;
  tokens: string;
  bu: string;
  reason: string;
  price_after: string;
};

export type PriceReport = { token_id: string; price: string; ts_ms: number };
export type LaunchQueueEntry = { account_id: string; bu: string };
export type OwedEntry = { token_id: string; amount: string };
export type StorageBalance = { total: string; available: string };
export type StorageBounds = { min: string; max: string | null };
export type FtMetadata = {
  spec: string;
  name: string;
  symbol: string;
  icon: string | null;
  reference: string | null;
  reference_hash: string | null;
  decimals: number;
};

/** mock-swapper get_prices: [token_id, usd_per_raw_e36]. */
export type SwapperPrice = [string, string];

/** A wallet-agnostic transaction, in the NEAR Connect / wallet-selector action format. */
export type FunctionCallAction = {
  type: "FunctionCall";
  params: { methodName: string; args: Record<string, unknown>; gas: string; deposit: string };
};
export type Transaction = { receiverId: string; actions: FunctionCallAction[] };
