import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { CoinView } from "@/components/coin/coin-view";
import { BRAND } from "@/lib/config";

/** A malformed %-escape in the URL is a 404, not a server error. */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    notFound();
  }
}

type Props = { params: Promise<{ coin: string }> };

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
/** The X account the player card names (twitter:site), e.g. "@yourhandle"; optional. */
const X_HANDLE = process.env.NEXT_PUBLIC_X_HANDLE;

function tickerOf(id: string): string {
  return (id.split(".")[0] ?? id).replace(/-\d+$/, "").toUpperCase();
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { coin } = await params;
  const id = safeDecode(coin);
  const title = `$${tickerOf(id)}`;
  const image = `/api/og/${encodeURIComponent(id)}`;
  return {
    title,
    description: `$${tickerOf(id)} on ${BRAND.name}: price, floor, basket and the mint and burn log.`,
    openGraph: { title: `$${tickerOf(id)} · ${BRAND.name}`, images: [{ url: image, width: 1200, height: 630 }] },
    // X shows the buy widget (/x/<coin>) inside the post as a player card, with the link card image as
    // its poster. X needs absolute HTTPS URLs here, so the site URL comes from NEXT_PUBLIC_SITE_URL.
    // Note: X's card rules are written for audio and video; a player that buys is outside them, and X
    // may show only the image. A plain link card is what other sites get (openGraph above).
    twitter: {
      card: "player",
      title: `$${tickerOf(id)} · ${BRAND.name}`,
      description: `Buy $${tickerOf(id)} right here: a memecoin with a floor backed by a basket of assets.`,
      ...(X_HANDLE ? { site: X_HANDLE } : {}),
      images: [`${SITE}${image}`],
    },
    // The player tags go here: Next's typed `players` also writes twitter:player:stream, which X reads as a video.
    other: { "twitter:player": `${SITE}/x/${encodeURIComponent(id)}`, "twitter:player:width": "500", "twitter:player:height": "500" },
  };
}

export default async function CoinPage({ params }: Props) {
  const { coin } = await params;
  return <CoinView id={safeDecode(coin)} />;
}
