"use client";

import Link from "next/link";
import { useState } from "react";
import { usePoll } from "@/lib/hooks";
import { coinColor } from "@/lib/assets";
import { deployment } from "@/lib/config";
import type { Meme } from "@/lib/server/memecooking";
import { IconExternal } from "./icons";
import { Skeleton } from "./ui";

/** IPFS gateways to try in turn; ipfs.io first, as meme.cooking documents, then a second one if it rate-limits. */
const GATEWAYS = ["https://ipfs.io/ipfs/", "https://gateway.pinata.cloud/ipfs/"];

/** A meme's image from IPFS, or its first letter on its colour if no gateway serves it. */
function MemeImage({ cid, symbol }: { cid: string | null; symbol: string }) {
  const [gw, setGw] = useState(0);
  if (!cid || gw >= GATEWAYS.length) {
    return (
      <span aria-hidden className="flex size-14 shrink-0 items-center justify-center rounded-full text-xl font-bold text-white" style={{ background: coinColor(symbol) }}>
        {symbol.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={gw}
      src={`${GATEWAYS[gw]}${cid}`}
      alt=""
      width={56}
      height={56}
      loading="lazy"
      onError={() => setGw((g) => g + 1)}
      className="size-14 shrink-0 rounded-full bg-pill object-cover"
    />
  );
}

function near(n: number | null): string {
  if (n === null) return "–";
  return n >= 1000 ? `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, notation: "compact" }).format(n)}` : n.toFixed(n >= 10 ? 0 : 1);
}

/** Basket assets the launch picker offers on this network (a routable meme only helps if it is one). */
const PICKABLE = new Set(deployment.tokens.map((t) => t.symbol.toUpperCase()));

/** Graduated memes from meme.cooking, NEAR's memecoin launchpad: the ones 1Click can route can go into a basket here. */
export function MemeCookingStrip() {
  const q = usePoll(async () => {
    const r = await fetch("/api/memecooking");
    const j = (await r.json()) as { memes?: Meme[] };
    return j.memes ?? [];
  }, [], 300_000);
  const memes = q.data ?? [];
  return (
    <section aria-labelledby="mc-h" className="min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <h2 id="mc-h" className="h2">
          Fresh from meme.cooking
        </h2>
        <p className="caption max-w-xl">NEAR&apos;s own memecoin launchpad. Coins NEAR Intents can route can go into a basket here.</p>
      </div>
      {q.loading && !q.data ? (
        <div className="mt-4 flex gap-3 overflow-hidden" aria-busy="true" aria-label="Loading meme.cooking coins">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-[184px] w-[200px] shrink-0 rounded-[24px]" />
          ))}
        </div>
      ) : memes.length === 0 ? (
        <p className="caption mt-4 rounded-[24px] bg-white p-5">meme.cooking isn&apos;t answering right now. Its coins appear here when it does.</p>
      ) : (
        <ul className="-mx-4 mt-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-3 [scrollbar-width:thin] sm:-mx-1 sm:scroll-px-1 sm:px-1">
          {memes.map((m) => (
            <li key={m.tokenId} className="card flex w-[208px] shrink-0 snap-start flex-col p-4">
              <a href={m.url} target="_blank" rel="noreferrer" className="group block min-w-0" title={`$${m.symbol} on meme.cooking`}>
                <span className="flex items-start justify-between gap-2">
                  <MemeImage cid={m.image} symbol={m.symbol} />
                  <IconExternal size={14} className="mt-1 shrink-0 text-faint group-hover:text-ink" />
                </span>
                <span className="mt-3 block truncate font-bold tracking-[-0.01em] group-hover:underline">${m.symbol}</span>
                <span className="block truncate text-[13px] text-muted">{m.name}</span>
                <span className="mt-2 block text-[13px]">
                  <span className="num font-semibold">{near(m.raisedNear)}</span> <span className="text-muted">NEAR raised</span>
                </span>
                <span className="block text-[13px]">
                  <span className="num font-semibold">{m.stakers.toLocaleString("en-US")}</span> <span className="text-muted">stakers</span>
                </span>
              </a>
              <span className="mt-3 flex flex-wrap gap-1.5">
                <span className="rounded-full bg-pill px-2 py-0.5 text-[11px] font-semibold" title={`Rhea pool #${m.poolId}`}>
                  Rhea pool
                </span>
                {m.routable && PICKABLE.has(m.symbol.toUpperCase()) && (
                  <Link href={`/launch?asset=${encodeURIComponent(m.symbol)}`} className="rounded-full bg-ink px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-[#2a2a2c]">
                    Can back a coin here
                  </Link>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
