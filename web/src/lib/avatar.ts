/**
 * Generated avatars and display names for NEAR accounts. Deterministic: the same account always
 * gets the same picture, so a trader is recognisable across the feed, holders and the graveyard.
 */

/** FNV-1a, 32-bit. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Background and mark colours: light enough for the mark to read, distinct from the floor yellow. */
const PAIRS: [string, string][] = [
  ["#c9e4ff", "#1f5fae"],
  ["#ffd3e0", "#b0285a"],
  ["#d6f5d0", "#2f7d24"],
  ["#e6dcff", "#5b3bc4"],
  ["#ffe1c7", "#b4541a"],
  ["#cdf3ef", "#11786b"],
  ["#f1e0c6", "#7a5420"],
  ["#dfe4ec", "#36465e"],
];

export const AVATAR_SHAPES = ["half", "band", "ring", "diamond", "dots"] as const;
export type AvatarShape = (typeof AVATAR_SHAPES)[number];

export type AvatarSpec = { bg: string; fg: string; shape: AvatarShape; rotate: number };

export function avatarSpec(account: string): AvatarSpec {
  const h = hash32(account.toLowerCase());
  const [bg, fg] = PAIRS[h % PAIRS.length]!;
  const shape = AVATAR_SHAPES[(h >>> 8) % AVATAR_SHAPES.length]!;
  const rotate = ((h >>> 16) % 8) * 45;
  return { bg, fg, shape, rotate };
}

/** "trader2" for trader2.backedlab.testnet, "a1b2c3…9f0e" for an implicit account. */
export function displayName(account: string): string {
  if (/^[0-9a-f]{64}$/.test(account)) return `${account.slice(0, 6)}…${account.slice(-4)}`;
  const first = account.split(".")[0] ?? account;
  return first.length > 18 ? `${first.slice(0, 16)}…` : first;
}

/** Our own testnet accounts, which make most of the trades. The README discloses them; so does every row they appear in. */
const TEST_TRADERS = new Set(["trader1", "trader2", "trader3", "alice", "bob", "keeper"].map((n) => `${n}.backedlab.testnet`));

export function isTestTrader(account: string): boolean {
  return TEST_TRADERS.has(account.toLowerCase());
}
