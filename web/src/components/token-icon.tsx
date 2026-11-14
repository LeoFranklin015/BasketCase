/**
 * Logos for basket assets, their chains and wallets. Pure presentation with no hooks, so it renders
 * on the server and the client alike (the X card uses it too: keep the props stable).
 * Files and licenses: public/icons/README.md. A token without a logo gets a lettered disc in its
 * asset colour, so a symbol always looks the same wherever it appears.
 */
import { assetColor } from "../lib/assets";
import { CHAIN_NAME, WALLET_ICON, chainIconPath, isNativeCoin, originChain, tokenIconPath, type ChainId, type WalletKind } from "../lib/icons";

function cls(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(" ");
}

/**
 * A token's logo as a disc. `chain` adds a small badge of the chain the asset comes from, the way
 * DEX screens mark bridged tokens. Decorative: the symbol is always written beside it.
 */
export function TokenIcon({ symbol, size = 20, chain = false, on, className }: { symbol: string; size?: number; chain?: boolean; /** Badge this chain instead of the asset's origin. */ on?: ChainId; className?: string }) {
  const src = tokenIconPath(symbol);
  const from = on ?? (chain && !isNativeCoin(symbol) ? originChain(symbol) : null);
  const badge = Math.max(9, Math.round(size * 0.48));
  return (
    <span
      aria-hidden
      // A caller may position it absolutely (inside a select, over an avatar); otherwise it anchors its own chain badge.
      className={cls(/\b(absolute|fixed)\b/.test(className ?? "") ? "inline-flex shrink-0" : "relative inline-flex shrink-0", className)}
      style={{ width: size, height: size }}
      title={from ? `${symbol.toUpperCase()} from ${CHAIN_NAME[from]}` : undefined}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" width={size} height={size} className="block rounded-full" style={{ width: size, height: size }} draggable={false} />
      ) : (
        <span
          className="flex items-center justify-center rounded-full font-bold leading-none text-white"
          style={{ width: size, height: size, background: assetColor(symbol), fontSize: Math.max(8, Math.round(size * 0.46)) }}
        >
          {symbol.replace(/^\$/, "").slice(0, 1).toUpperCase()}
        </span>
      )}
      {from && <ChainBadge chain={from} size={badge} />}
    </span>
  );
}

function ChainBadge({ chain, size }: { chain: ChainId; size: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={chainIconPath(chain)}
      alt=""
      width={size}
      height={size}
      className="absolute rounded-full"
      style={{ width: size, height: size, right: -Math.round(size * 0.28), bottom: -Math.round(size * 0.22), boxShadow: "0 0 0 1.5px #ffffff" }}
      draggable={false}
    />
  );
}

/** A chain's logo on its own, for "Pay from any chain" and network badges. */
export function ChainIcon({ chain, size = 16, className }: { chain: ChainId; size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={chainIconPath(chain)} alt="" aria-hidden width={size} height={size} className={cls("inline-block shrink-0 rounded-full", className)} style={{ width: size, height: size }} draggable={false} />
  );
}

/** The sign-in method's mark: the NEAR logo for a NEAR wallet, an envelope for email, a ghost for a guest wallet. */
export function WalletIcon({ kind, size = 28, className }: { kind: WalletKind; size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={WALLET_ICON[kind]} alt="" aria-hidden width={size} height={size} className={cls("inline-block shrink-0 rounded-full", className)} style={{ width: size, height: size }} draggable={false} />
  );
}

export type { ChainId, WalletKind };
