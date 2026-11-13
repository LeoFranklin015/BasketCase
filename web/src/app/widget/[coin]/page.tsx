import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Widget } from "@/components/widget";

/** A malformed %-escape in the URL is a 404, not a server error. */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    notFound();
  }
}

type Props = { params: Promise<{ coin: string }> };

export const metadata: Metadata = { title: "Widget", robots: { index: false } };

export default async function WidgetPage({ params }: Props) {
  const { coin } = await params;
  return <Widget id={safeDecode(coin)} />;
}
