/**
 * meme.cooking, NEAR's memecoin launchpad: its graduated memes (those with a token and a Rhea pool),
 * and which of them NEAR Intents 1Click can route, so they could sit in one of our baskets.
 * Both upstream lists are public and cached in memory for 5 minutes. Relative imports: unit-tested.
 */

export const MEMECOOKING_API = "https://api.meme.cooking/meme";
export const ONECLICK_TOKENS = "https://1click.chaindefuser.com/v0/tokens";
const TTL_MS = 5 * 60_000;

/** The fields we read from one row of meme.cooking's GET /meme. */
export type RawMeme = {
  meme_id: number;
  symbol: string;
  name: string;
  image: string | null;
  deposit_token_id?: string | null;
  total_deposit?: string | null;
  staker_count?: number | null;
  token_id?: string | null;
  pool_id?: number | null;
};

export type Meme = {
  symbol: string;
  name: string;
  tokenId: string;
  poolId: number;
  /** IPFS CID of its image, or null. */
  image: string | null;
  /** Raised in NEAR (wrap.near, 24 decimals); null if the deposit token is something else. */
  raisedNear: number | null;
  stakers: number;
  url: string;
  /** 1Click lists it with a price above zero, so a basket could hold it. */
  routable: boolean;
};

type OneClickRow = { assetId: string; price?: number | string | null };

/**
 * The top `n` graduated memes by amount raised, shaped for the app, plus any graduated meme 1Click can
 * route that didn't make the top `n` (those are the ones a basket here could hold, so they always show).
 */
export function topGraduated(rows: RawMeme[], routableIds: Set<string>, n = 12): Meme[] {
  const big = (s: string | null | undefined) => {
    try {
      return BigInt(s ?? "0");
    } catch {
      return 0n;
    }
  };
  return rows
    .filter((m) => m.token_id && m.pool_id !== null && m.pool_id !== undefined)
    .sort((a, b) => {
      const d = big(b.total_deposit) - big(a.total_deposit);
      return d > 0n ? 1 : d < 0n ? -1 : 0;
    })
    .filter((m, i) => i < n || routableIds.has(`nep141:${m.token_id}`))
    .map((m) => ({
      symbol: m.symbol,
      name: m.name,
      tokenId: m.token_id!,
      poolId: m.pool_id!,
      image: m.image || null,
      raisedNear: (m.deposit_token_id ?? "wrap.near") === "wrap.near" ? Number(big(m.total_deposit) / 10n ** 20n) / 1e4 : null,
      stakers: m.staker_count ?? 0,
      url: `https://meme.cooking/meme/${m.meme_id}`,
      routable: routableIds.has(`nep141:${m.token_id}`),
    }));
}

/** 1Click asset ids that have a price above zero. */
export function routableSet(rows: OneClickRow[]): Set<string> {
  return new Set(rows.filter((t) => Number(t.price ?? 0) > 0).map((t) => t.assetId));
}

let memeCache: { at: number; rows: RawMeme[] } | null = null;
let tokenCache: { at: number; ids: Set<string> } | null = null;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** The top graduated memes; on any upstream failure, the last good list or an empty one. */
export async function loadMemes(now = Date.now()): Promise<Meme[]> {
  if (!memeCache || now - memeCache.at > TTL_MS) {
    try {
      const rows = await getJson<RawMeme[]>(MEMECOOKING_API);
      if (Array.isArray(rows)) memeCache = { at: now, rows };
    } catch {
      // keep the last good list
    }
  }
  if (!tokenCache || now - tokenCache.at > TTL_MS) {
    try {
      const rows = await getJson<OneClickRow[]>(ONECLICK_TOKENS);
      if (Array.isArray(rows)) tokenCache = { at: now, ids: routableSet(rows) };
    } catch {
      // keep the last good list
    }
  }
  return memeCache ? topGraduated(memeCache.rows, tokenCache?.ids ?? new Set()) : [];
}
