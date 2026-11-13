import type { BasketEntry, Tombstone } from "@backed/client";

/** The replacement isn't in the tombstone; it's the asset that joined in the epoch the target left.
 *  That asset may still be in the basket, or it may have been voted out later (another tombstone). */
export function inferReplacement(t: Tombstone, basket: Pick<BasketEntry, "token_id" | "joined_epoch">[], tombs: Tombstone[]): string | null {
  const joined = [...basket, ...tombs].find((b) => b.joined_epoch === t.removed_epoch && b.token_id !== t.token_id);
  return joined?.token_id ?? null;
}
