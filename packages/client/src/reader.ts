/** Typed read access to the factory, coins, verifier and swapper. */

import { viewFunction, type ViewOptions } from "./rpc.ts";
import type {
  AuctionView,
  BasketEntry,
  BuyQuote,
  CoinConfig,
  CoinInfo,
  CoinState,
  Deployment,
  EpochView,
  FactoryConfig,
  FtMetadata,
  LaunchQueueEntry,
  LogEntry,
  OwedEntry,
  PriceReport,
  SellQuote,
  StorageBalance,
  StorageBounds,
  SwapperPrice,
  Tombstone,
} from "./types.ts";

export interface CoinReader {
  readonly accountId: string;
  getConfig(): Promise<CoinConfig>;
  getState(): Promise<CoinState>;
  getBasket(): Promise<BasketEntry[]>;
  quoteBuy(bu_in: string): Promise<BuyQuote>;
  quoteSell(amount: string): Promise<SellQuote>;
  getEpoch(): Promise<EpochView>;
  getAuction(): Promise<AuctionView | null>;
  getPrices(): Promise<PriceReport[]>;
  getTombstones(from: number, limit: number): Promise<Tombstone[]>;
  getLog(): Promise<LogEntry[]>;
  getLaunchQueue(from: number, limit: number): Promise<LaunchQueueEntry[]>;
  getOwed(account_id: string): Promise<OwedEntry[]>;
  ftBalanceOf(account_id: string): Promise<string>;
  ftTotalSupply(): Promise<string>;
  ftMetadata(): Promise<FtMetadata>;
  storageBalanceOf(account_id: string): Promise<StorageBalance | null>;
  storageBalanceBounds(): Promise<StorageBounds>;
}

export interface VerifierReader {
  mtBalanceOf(account_id: string, token_id: string): Promise<string>;
  mtBatchBalanceOf(account_id: string, token_ids: string[]): Promise<string[]>;
}

export interface SwapperReader {
  getPrices(): Promise<SwapperPrice[]>;
  quoteOut(token_in: string, token_out: string, amount_in: string): Promise<string>;
  quoteIn(token_in: string, token_out: string, amount_out: string): Promise<string>;
}

export interface BackedReader {
  listCoins(from: number, limit: number): Promise<CoinInfo[]>;
  /** Every coin, oldest first, paging through list_coins. */
  listAllCoins(pageSize?: number): Promise<CoinInfo[]>;
  getCoin(account_id: string): Promise<CoinInfo | null>;
  getFactoryConfig(): Promise<FactoryConfig>;
  coin(account_id: string): CoinReader;
  verifier: VerifierReader;
  swapper: SwapperReader;
}

export type ReaderDeployment = Pick<Deployment, "rpc" | "factory" | "verifier" | "swapper">;

export function createRpcReader(d: ReaderDeployment, opts: ViewOptions = {}): BackedReader {
  const view = <T>(account: string, method: string, args: unknown = {}) => viewFunction<T>(d.rpc, account, method, args, opts);

  const coin = (id: string): CoinReader => ({
    accountId: id,
    getConfig: () => view(id, "get_config"),
    getState: () => view(id, "get_state"),
    getBasket: () => view(id, "get_basket"),
    quoteBuy: (bu_in) => view(id, "quote_buy", { bu_in }),
    quoteSell: (amount) => view(id, "quote_sell", { amount }),
    getEpoch: () => view(id, "get_epoch"),
    getAuction: () => view(id, "get_auction"),
    getPrices: () => view(id, "get_prices"),
    getTombstones: (from, limit) => view(id, "get_tombstones", { from, limit }),
    getLog: () => view(id, "get_log"),
    getLaunchQueue: (from, limit) => view(id, "get_launch_queue", { from, limit }),
    getOwed: (account_id) => view(id, "get_owed", { account_id }),
    ftBalanceOf: (account_id) => view(id, "ft_balance_of", { account_id }),
    ftTotalSupply: () => view(id, "ft_total_supply"),
    ftMetadata: () => view(id, "ft_metadata"),
    storageBalanceOf: (account_id) => view(id, "storage_balance_of", { account_id }),
    storageBalanceBounds: () => view(id, "storage_balance_bounds"),
  });

  const listCoins = (from: number, limit: number) => view<CoinInfo[]>(d.factory, "list_coins", { from, limit });

  return {
    listCoins,
    async listAllCoins(pageSize = 50) {
      const out: CoinInfo[] = [];
      for (;;) {
        const page = await listCoins(out.length, pageSize);
        out.push(...page);
        if (page.length < pageSize) return out;
      }
    },
    getCoin: (account_id) => view(d.factory, "get_coin", { account_id }),
    getFactoryConfig: () => view(d.factory, "get_config"),
    coin,
    verifier: {
      mtBalanceOf: (account_id, token_id) => view(d.verifier, "mt_balance_of", { account_id, token_id }),
      mtBatchBalanceOf: (account_id, token_ids) => view(d.verifier, "mt_batch_balance_of", { account_id, token_ids }),
    },
    swapper: {
      getPrices: () => view(d.swapper, "get_prices"),
      quoteOut: (token_in, token_out, amount_in) => view(d.swapper, "quote_out", { token_in, token_out, amount_in }),
      quoteIn: (token_in, token_out, amount_out) => view(d.swapper, "quote_in", { token_in, token_out, amount_out }),
    },
  };
}
