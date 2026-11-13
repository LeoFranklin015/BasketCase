"use client";

import { useEffect, useState } from "react";
import { BRAND } from "@/lib/config";

/**
 * Share a coin three ways: its link (X unfurls it as a live player card on an https host), a post
 * draft for X, and an iframe snippet of the buy widget for any website.
 */
export function EmbedShare({ id, ticker }: { id: string; ticker: string }) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => setOrigin(window.location.origin), []);
  const page = `${origin}/c/${encodeURIComponent(id)}`;
  const widget = `${origin}/widget/${encodeURIComponent(id)}`;
  const iframe = `<iframe src="${widget}" width="420" height="640" style="border:0;border-radius:20px" title="$${ticker} on ${BRAND.name}"></iframe>`;
  const post = `$${ticker} has a floor: every token is backed by a basket of real assets on NEAR. ${page}`;

  const copy = async (what: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  };

  return (
    <section className="card scroll-mt-24 space-y-3 p-5 sm:p-6" aria-labelledby="share-h" id="share">
      <h2 id="share-h" className="h2">
        Share ${ticker}
      </h2>
      <p className="caption -mt-1">On X, the link shows a card with the price and floor. On any other site, paste the embed to show a live buy card.</p>
      <div className="flex flex-wrap gap-2">
        <a className="btn btn-ink btn-sm" href={`https://x.com/intent/post?text=${encodeURIComponent(post)}`} target="_blank" rel="noreferrer">
          Post on X
        </a>
        <button type="button" className="btn btn-line btn-sm" onClick={() => void copy("link", page)}>
          {copied === "link" ? "Link copied" : "Copy link"}
        </button>
        <button type="button" className="btn btn-line btn-sm" onClick={() => void copy("embed", iframe)}>
          {copied === "embed" ? "Embed copied" : "Copy embed code"}
        </button>
        <a className="btn btn-line btn-sm" href={widget} target="_blank" rel="noreferrer">
          Open the widget
        </a>
      </div>
      <pre className="mono overflow-x-auto rounded-[12px] bg-sunk px-3 py-2.5 text-xs text-ink-2" aria-label="Embed code" tabIndex={0}>
        {iframe}
      </pre>
      <span role="status" className="sr-only">
        {copied ? `${copied} copied` : ""}
      </span>
    </section>
  );
}
