import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { XCard } from "@/components/x-card";

/** A malformed %-escape in the URL is a 404, not a server error. */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    notFound();
  }
}

type Props = { params: Promise<{ coin: string }> };

export const metadata: Metadata = { title: "Buy on X", robots: { index: false } };

/**
 * The X player: what a coin link shows inside a post on X (its own card, src/components/x-card.tsx).
 * Unlike /widget (any site, never signs), only X may frame this page (CSP in next.config.ts), so it buys and sells in the post.
 */
export default async function XPlayerPage({ params }: Props) {
  const { coin } = await params;
  return <XCard id={safeDecode(coin)} />;
}
