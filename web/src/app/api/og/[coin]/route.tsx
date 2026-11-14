// The link card (1200×630) X and other sites show for a coin link: the coin as one block, yellow up to
// its backed share, stripes (hype) above, with price and floor per 1M tokens. Drawing: src/components/og-card.tsx.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { OgCard, loadOgFonts } from "@/components/og-card";
import { assetColor } from "@/lib/assets";
import { chainIconPath, originChain, tokenIconPath } from "@/lib/icons";
import { BRAND, NET, tokenInfo } from "@/lib/config";
import { getReader } from "@/lib/data";
import { basketRows, buUsdE6, priceToUsd } from "@/lib/money";
import { toNumber, type BasketEntry, type CoinConfig, type CoinState } from "@backed/client";

const STAGE = { launch: "Fair launch", curve: "Growing", index: "Graduated" } as const;

const svgCache = new Map<string, Promise<string | null>>();
/** A file from public/icons as a data: URI, which Satori can draw; null if it can't be read. */
function iconData(publicPath: string | null): Promise<string | null> {
  if (!publicPath) return Promise.resolve(null);
  let hit = svgCache.get(publicPath);
  if (!hit) {
    hit = readFile(path.join(process.cwd(), "public", publicPath))
      .then((b) => {
        const ext = publicPath.split(".").pop()!.toLowerCase();
        const type = ext === "svg" ? "image/svg+xml" : ext === "png" ? "image/png" : "image/jpeg";
        return `data:${type};base64,${b.toString("base64")}`;
      })
      .catch(() => null);
    svgCache.set(publicPath, hit);
  }
  return hit;
}

/** Dollars per one million tokens: readable at link-card size, unlike a per-token price. */
function perMillion(price_e18: string, bu_e6: number): string {
  const n = priceToUsd(price_e18, bu_e6) * 1e6;
  if (n >= 100) return `$${n.toFixed(0)}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toPrecision(3)}`;
}

export async function GET(_req: Request, ctx: { params: Promise<{ coin: string }> }) {
  const { coin } = await ctx.params;
  let id = coin;
  try {
    id = decodeURIComponent(coin);
  } catch {
    // keep the raw segment; the read below fails and the card says "not found"
  }
  let data: { config: CoinConfig; state: CoinState; basket: BasketEntry[]; prices: Record<string, string> } | null = null;
  try {
    const r = getReader();
    const c = r.coin(id);
    const [config, state, basket, prices] = await Promise.all([c.getConfig(), c.getState(), c.getBasket(), r.swapper.getPrices().catch(() => [] as [string, string][])]);
    data = { config, state, basket, prices: Object.fromEntries(prices) };
  } catch {
    data = null;
  }

  const ticker = data?.config.ticker ?? (id.split(".")[0] ?? id).replace(/-\d+$/, "").toUpperCase();
  const bu = data ? buUsdE6(data.config, data.basket, data.prices).e6 : 0;
  const rows = data ? basketRows(data.basket, data.prices) : [];
  const share = data ? Math.min(1, toNumber(data.state.floor, 18) / Math.max(toNumber(data.state.price, 18), 1e-30)) : 0;

  const basket = await Promise.all(
    rows.map(async (r) => {
      const symbol = tokenInfo(r.token_id).symbol;
      const chain = originChain(symbol);
      const [icon, chainIcon] = await Promise.all([iconData(tokenIconPath(symbol)), iconData(chain ? chainIconPath(chain) : null)]);
      return { symbol, share: r.share ?? 0, color: assetColor(symbol), icon, chainIcon };
    }),
  );

  return new ImageResponse(
    (
      <OgCard
        brand={BRAND.name}
        network={NET.chain}
        ticker={ticker}
        name={data?.config.name ?? null}
        stage={data ? STAGE[data.state.mode] : null}
        unit="per 1M tokens"
        price={data ? perMillion(data.state.price, bu) : null}
        floor={data ? perMillion(data.state.floor, bu) : null}
        share={share}
        basket={basket}
      />
    ),
    { width: 1200, height: 630, fonts: await loadOgFonts(), headers: { "cache-control": "public, max-age=60, s-maxage=60" } },
  );
}
