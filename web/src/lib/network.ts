/**
 * Testnet or mainnet, picked once at build time with NEXT_PUBLIC_NETWORK (default testnet).
 * Everything that differs between the two lives here: which deployments file is read, RPC
 * endpoints, explorer and NEARBlocks URLs, the wallet network, and the features that only make
 * sense on one of them (free test USDC and gas top-ups on testnet; real 1Click swaps on mainnet).
 * Contracts are the same on both; see ARCHITECTURE.md, "Testnet and mainnet".
 */

export type Network = "testnet" | "mainnet";

export function parseNetwork(v: string | undefined): Network {
  return v?.trim().toLowerCase() === "mainnet" ? "mainnet" : "testnet";
}

export type NetworkProfile = {
  id: Network;
  /** "Testnet" / "Mainnet", for chips and captions. */
  label: string;
  /** "NEAR testnet" / "NEAR mainnet", for sentences. */
  chain: string;
  /** Fallback RPCs after the deployment file's own. */
  rpcs: string[];
  explorer: string;
  nearblocksApi: string;
  /** Free test tokens: the faucet button and the 0.5 NEAR gas top-up for new email and guest wallets. */
  testTokens: boolean;
  /** How a buy gets the basket assets: the testnet stand-in swapper, or 1Click inside NEAR Intents. */
  swapRoute: "mock-swapper" | "oneclick";
};

export const PROFILES: Record<Network, NetworkProfile> = {
  testnet: {
    id: "testnet",
    label: "Testnet",
    chain: "NEAR testnet",
    rpcs: ["https://test.rpc.fastnear.com", "https://near-testnet.drpc.org"],
    explorer: "https://testnet.nearblocks.io",
    nearblocksApi: "https://api-testnet.nearblocks.io/v3",
    testTokens: true,
    swapRoute: "mock-swapper",
  },
  mainnet: {
    id: "mainnet",
    label: "Mainnet",
    chain: "NEAR mainnet",
    rpcs: ["https://free.rpc.fastnear.com", "https://near.drpc.org"],
    explorer: "https://nearblocks.io",
    nearblocksApi: "https://api.nearblocks.io/v3",
    testTokens: false,
    swapRoute: "oneclick",
  },
};

export const NETWORK: Network = parseNetwork(process.env.NEXT_PUBLIC_NETWORK);
export const NET: NetworkProfile = PROFILES[NETWORK];

/** Where the same app runs on the other network, if it is hosted (for the header switch). */
export const OTHER_NETWORK_URL: string = (NETWORK === "mainnet" ? process.env.NEXT_PUBLIC_TESTNET_URL : process.env.NEXT_PUBLIC_MAINNET_URL) ?? "";
