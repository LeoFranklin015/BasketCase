import {
  createRpcReader,
  fetchOneClickPrices,
  oneClickQuoteIn,
  type AuctionView,
  type BackedReader,
  type BasketEntry,
  type CoinConfig,
  type CoinInfo,
  type CoinState,
  type EpochView,
  type LogEntry,
  type PriceReport,
  type SwapperPrice,
  type Tombstone,
} from "@backed/client";
import { DATA_MODE, DIRECT_COINS, NET, NOT_DEPLOYED, deployment } from "./config";
import { fixtureReader } from "./fixture/reader";
import { failoverFetch } from "./rpc";

const chainReader = createRpcReader(deployment, { fetch: failoverFetch });
/** A valid implicit account that owns nothing, for price-only 1Click quotes. */
const QUOTE_PROBE = "0".repeat(64);
/**
 * Mainnet has no stand-in swapper contract: prices and swap quotes come from 1Click, behind the same
 * interface, so every page and the buy planner work unchanged on either network.
 */
const liveReader: BackedReader =
  NET.swapRoute === "oneclick"
    ? {
        ...chainReader,
        swapper: {
          getPrices: () => fetchOneClickPrices(deployment.tokens.map((t) => t.token_id)),
          quoteIn: (a, b, out) => oneClickQuoteIn(a, b, out, QUOTE_PROBE),
          quoteOut: async () => {
            throw new Error("Exact-input quotes are not used on mainnet.");
          },
        },
      }
    : chainReader;
/** Before a network's factory exists (mainnet until the go), the app lists no coins instead of erroring. */
const rpcReader: BackedReader = NOT_DEPLOYED
  ? { ...liveReader, listCoins: async () => [], listAllCoins: async () => [], getCoin: async () => null }
  : deployment.factory === "none"
    ? {
        // No factory (mainnet demo coin deployed directly): the coin list is the one in the deployments file.
        ...liveReader,
        listCoins: async (from, limit) => DIRECT_COINS.slice(from, from + limit),
        listAllCoins: async () => DIRECT_COINS,
        getCoin: async (id) => DIRECT_COINS.find((c) => c.account_id === id) ?? null,
      }
    : liveReader;

/** Fixture data when NEXT_PUBLIC_DATA=fixture, otherwise the NEAR RPC of NEXT_PUBLIC_NETWORK. */
export function getReader(): BackedReader {
  return DATA_MODE === "fixture" ? fixtureReader : rpcReader;
}

export function verifierId(): string {
  return DATA_MODE === "fixture" ? "intents.fixture.testnet" : deployment.verifier;
}
export function swapperId(): string {
  return DATA_MODE === "fixture" ? "swapper.fixture.testnet" : deployment.swapper;
}
export function factoryId(): string {
  return DATA_MODE === "fixture" ? "fixture-factory.testnet" : deployment.factory;
}

/** What a coin card on the explore page needs. */
export type CoinSummary = { info: CoinInfo; config: CoinConfig; state: CoinState; basket: BasketEntry[] };

export async function loadSummary(r: BackedReader, info: CoinInfo): Promise<CoinSummary> {
  const c = r.coin(info.account_id);
  const [config, state, basket] = await Promise.all([c.getConfig(), c.getState(), c.getBasket()]);
  return { info, config, state, basket };
}

/** Everything the coin page shows. */
export type CoinSnapshot = {
  id: string;
  config: CoinConfig;
  state: CoinState;
  basket: BasketEntry[];
  epoch: EpochView;
  auction: AuctionView | null;
  log: LogEntry[];
  reports: PriceReport[];
  /** USD per raw unit (1e36) from the swapper, for dollar estimates. */
  usdPrices: Record<string, string>;
  tombstones: Tombstone[];
  loadedAt: number;
};

export async function loadSnapshot(r: BackedReader, id: string): Promise<CoinSnapshot> {
  const c = r.coin(id);
  const [config, state, basket, epoch, auction, log, reports, swapper, tombstones] = await Promise.all([
    c.getConfig(),
    c.getState(),
    c.getBasket(),
    c.getEpoch(),
    c.getAuction(),
    c.getLog(),
    c.getPrices().catch(() => [] as PriceReport[]),
    r.swapper.getPrices().catch(() => [] as SwapperPrice[]),
    c.getTombstones(0, 50).catch(() => [] as Tombstone[]),
  ]);
  return {
    id,
    config,
    state,
    basket,
    epoch,
    auction,
    log,
    reports,
    usdPrices: Object.fromEntries(swapper),
    tombstones,
    loadedAt: Date.now(),
  };
}
