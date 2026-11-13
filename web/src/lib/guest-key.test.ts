import { KeyPair } from "near-api-js";
import { describe, expect, it } from "vitest";
import { guestFromSecret, guestSigner, newGuestKey } from "./guest-key";
import { implicitPublicKey } from "./near-signer";

describe("guest wallet key", () => {
  it("uses the implicit account of its own key", () => {
    const g = newGuestKey();
    expect(g.accountId).toMatch(/^[0-9a-f]{64}$/);
    expect(implicitPublicKey(g.accountId).toString()).toBe(KeyPair.fromString(g.secret).getPublicKey().toString());
  });

  it("restores the same account from the saved secret", () => {
    const g = newGuestKey();
    expect(guestFromSecret(g.secret)).toEqual(g);
  });

  it("signs hashes that verify against the account's key", async () => {
    const g = newGuestKey();
    const hash = new Uint8Array(32).fill(9);
    const sig = await guestSigner(g.secret)(hash);
    expect(implicitPublicKey(g.accountId).verify(hash, sig)).toBe(true);
  });
});
