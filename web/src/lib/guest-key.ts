// Guest wallet (testnet only): a fresh ed25519 key made in this browser. Its NEAR account is the
// implicit account of that key (the hex of the public key), which exists once /api/fund sends it
// 0.5 testnet NEAR for gas. Lets a judge try a real buy with no wallet app and no sign-up, and is the
// wallet the live end-to-end test drives. The key never leaves the browser; losing it loses only test tokens.
import { KeyPair, type KeyPairString } from "near-api-js";
import type { RawHashSigner } from "./near-signer";

export type GuestKey = { accountId: string; secret: KeyPairString };

export function guestFromSecret(secret: KeyPairString): GuestKey {
  const pk = KeyPair.fromString(secret).getPublicKey();
  return { accountId: Array.from(pk.data, (b) => b.toString(16).padStart(2, "0")).join(""), secret };
}

export function newGuestKey(): GuestKey {
  return guestFromSecret(KeyPair.fromRandom("ed25519").toString() as KeyPairString);
}

export function guestSigner(secret: KeyPairString): RawHashSigner {
  const kp = KeyPair.fromString(secret);
  return async (hash) => kp.sign(hash).signature;
}

export function loadGuest(storageKey: string): GuestKey | null {
  try {
    const s = localStorage.getItem(storageKey);
    return s ? guestFromSecret(s as KeyPairString) : null;
  } catch {
    return null;
  }
}

export function saveGuest(storageKey: string, g: GuestKey | null): void {
  try {
    if (g) localStorage.setItem(storageKey, g.secret);
    else localStorage.removeItem(storageKey);
  } catch {
    // Private mode: the guest lasts for this page only.
  }
}
