"use client";

import { computeQ, createCoinTx, formatUnits, usdToPriceE36, validateLaunch, type LaunchConfig } from "@backed/client";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CURVE, DATA_MODE, NET, PAY_TOKEN_ID, deployment, tokenInfo } from "@/lib/config";
import { factoryId, getReader } from "@/lib/data";
import { usePoll } from "@/lib/hooks";
import { assetAmount, priceUnit, usd } from "@/lib/money";
import { BasketPie, MiniFloorBar, Monogram } from "./coin-bits";
import { successValue, useWallet } from "@/lib/wallet";
import { IconAnchor, IconClose, IconPlus } from "./icons";
import { TxStatus, useTx } from "./tx";
import { StageChip, cx } from "./ui";
import { WalletButton } from "./wallet-button";
import { TokenIcon } from "./token-icon";

type AssetRow = { key: number; token_id: string; custom: boolean; weight: string; anchored: boolean; usd: string; decimals: string };

const P0 = CURVE.float.x0 / CURVE.float.y0; // opening price, BU per token

let nextKey = 3;

/** Words for a random demo coin: a meme name and a ticker made from it. */
const RANDOM_NAMES = ["Moon Bag", "Giga Chad", "Wagmi", "Lambo Fund", "Fomo", "Hodl", "Ape Index", "Diamond Hands", "Bonkers", "Degen Club", "Copium", "Based", "Rocket", "Frog Bank", "Doge Vault", "Meme Index"];
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;
/** Split 100% into `n` weights in steps of 5, each at least 10. */
function randomWeights(n: number): number[] {
  const w = Array<number>(n).fill(10);
  for (let left = 100 - 10 * n; left > 0; left -= 5) w[Math.floor(Math.random() * n)]! += 5;
  return w.sort((a, b) => b - a);
}

/** How the asset picker groups the basket tokens. Anything else lands in "Other". */
const ASSET_GROUPS = [
  { id: "majors", label: "Majors", symbols: ["BTC", "ETH", "SOL", "NEAR", "WNEAR", "USDC", "USDT"] },
  { id: "near-memes", label: "NEAR memes", symbols: ["BLACKDRAGON", "SHITZU", "JAMBO"] },
  { id: "memes", label: "Memes from other chains", symbols: ["PEPE", "SHIB", "DOGE", "WIF", "BONK", "TRUMP", "MOG", "TURBO", "BRETT"] },
  { id: "stocks", label: "Stocks (test only)", symbols: ["NVDA"] },
  { id: "other", label: "Other", symbols: [] as string[] },
] as const;

function groupOf(symbol: string): (typeof ASSET_GROUPS)[number]["id"] {
  const s = symbol.toUpperCase();
  return ASSET_GROUPS.find((g) => (g.symbols as readonly string[]).includes(s))?.id ?? "other";
}

export function LaunchForm() {
  const { accountId } = useWallet();
  const tx = useTx();
  const prices = usePoll(() => getReader().swapper.getPrices(), [], 60_000);
  const factory = usePoll(() => getReader().getFactoryConfig(), [], 0);
  const priceMap = useMemo(() => Object.fromEntries(prices.data ?? []), [prices.data]);

  const [ticker, setTicker] = useState("");
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [iconErr, setIconErr] = useState<string>();
  const [rows, setRows] = useState<AssetRow[]>([
    { key: 1, token_id: deployment.tokens.find((t) => t.symbol === "BTC")?.token_id ?? deployment.tokens[0]!.token_id, custom: false, weight: "50", anchored: true, usd: "", decimals: "" },
    { key: 2, token_id: PAY_TOKEN_ID, custom: false, weight: "50", anchored: false, usd: "", decimals: "" },
  ]);
  // `?asset=JAMBO` (from the meme.cooking strip on Markets): start with that asset in the basket, beside BTC.
  useEffect(() => {
    const want = new URLSearchParams(window.location.search).get("asset")?.toUpperCase();
    const t = want ? deployment.tokens.find((x) => x.symbol.toUpperCase() === want) : undefined;
    if (!t) return;
    const btc = deployment.tokens.find((x) => x.symbol === "BTC");
    setRows(
      btc && btc.token_id !== t.token_id
        ? [
            { key: 1, token_id: btc.token_id, custom: false, weight: "50", anchored: true, usd: "", decimals: "" },
            { key: 2, token_id: t.token_id, custom: false, weight: "50", anchored: false, usd: "", decimals: "" },
          ]
        : [{ key: 1, token_id: t.token_id, custom: false, weight: "100", anchored: true, usd: "", decimals: "" }],
    );
  }, []);
  const [feeBps, setFeeBps] = useState(CURVE.fee_default_bps);
  const [profile, setProfile] = useState<"demo" | "prod">("demo");
  const [buUsd, setBuUsd] = useState(String(CURVE.bu_usd_default));
  const [created, setCreated] = useState<string | null>(null);

  const buUsdE6 = Math.round(Number(buUsd) * 1e6);
  const openUsd = (P0 * buUsdE6) / 1e6;
  const openUnit = priceUnit(openUsd);
  const update = (key: number, patch: Partial<AssetRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  /** Fill the form with a random demo coin: a meme name, one anchored major and 2 or 3 assets from other groups,
   *  only tokens the swapper can price (so the basket is valid as filled). */
  const randomize = () => {
    const priced = deployment.tokens.filter((t) => priceMap[t.token_id]);
    const majors = priced.filter((t) => ["BTC", "ETH", "SOL"].includes(t.symbol));
    const others = priced.filter((t) => !majors.includes(t) && t.token_id !== PAY_TOKEN_ID);
    if (!majors.length || others.length < 2) return;
    const shuffled = [...others].sort(() => Math.random() - 0.5).slice(0, 2 + Math.floor(Math.random() * 2));
    const chosen = [pick(majors), ...shuffled];
    const weights = randomWeights(chosen.length);
    const nm = pick(RANDOM_NAMES);
    const base = nm.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 6);
    setName(nm);
    setTicker(`${base}${Math.floor(10 + Math.random() * 90)}`);
    setRows(chosen.map((t, i) => ({ key: nextKey++, token_id: t.token_id, custom: false, weight: String(weights[i]), anchored: i === 0, usd: "", decimals: "" })));
  };

  // Price per raw unit (1e36) for each row: the swapper's, or the one typed for a custom token.
  const computed = rows.map((r) => {
    const weight_bps = Math.round(Number(r.weight) * 100);
    let price: bigint | null = null;
    let err: string | undefined;
    if (r.custom) {
      try {
        price = r.usd && r.decimals ? usdToPriceE36(r.usd, Number(r.decimals)) : null;
      } catch {
        err = "Enter a plain USD price and whole-number decimals.";
      }
      if (!price && !err) err = "Enter the token's USD price and decimals to size it.";
    } else {
      const p = priceMap[r.token_id];
      price = p ? BigInt(p) : null;
      if (!price) err = prices.loading ? undefined : "The swapper has no price for this token.";
    }
    let q = "0";
    if (price && price > 0n && weight_bps > 0 && buUsdE6 > 0) {
      try {
        q = computeQ({ weight_bps, bu_usd_e6: buUsdE6, price_e36: price });
      } catch (e) {
        err = (e as Error).message;
      }
    }
    return { ...r, weight_bps, q, err };
  });

  const config: LaunchConfig = {
    ticker: ticker.trim().toUpperCase(),
    name: name.trim(),
    icon,
    basket: computed.map((c) => ({ token_id: c.token_id.trim(), weight_bps: c.weight_bps, q: c.q, anchored: c.anchored })),
    fee_bps: feeBps,
    epoch_profile: profile,
    bu_usd_e6: buUsdE6,
    creator: null,
  };
  const errors = [...validateLaunch(config), ...computed.filter((c) => c.err).map((c) => `${tokenInfo(c.token_id).symbol}: ${c.err}`)];
  const totalWeight = computed.reduce((s, c) => s + c.weight_bps, 0);

  const equalize = () =>
    setRows((rs) => {
      const each = Math.floor(10_000 / rs.length);
      return rs.map((r, i) => ({ ...r, weight: String((each + (i === 0 ? 10_000 - each * rs.length : 0)) / 100) }));
    });

  const onIcon = (f: File | undefined) => {
    setIconErr(undefined);
    if (!f) return setIcon(null);
    if (f.size > 8_000) return setIconErr("Keep the icon under 8 KB; it is stored on chain.");
    const reader = new FileReader();
    reader.onload = () => setIcon(String(reader.result));
    reader.readAsDataURL(f);
  };

  const submit = async () => {
    if (errors.length || !factory.data) return;
    await tx.run([{ title: `Launch $${config.ticker}`, txs: [createCoinTx(factoryId(), config, factory.data.launch_deposit)] }], (r) => {
      const id = r.outcomes.map(successValue).find((v): v is string => typeof v === "string");
      setCreated(id ?? (r.fixture ? "fixture" : null));
    });
  };

  const used = new Set(rows.map((r) => r.token_id));
  const knownOptions = deployment.tokens;
  const remaining = Math.max(0, Math.round((10_000 - totalWeight) / 100));
  const toggle = (token_id: string) => {
    if (used.has(token_id)) {
      if (rows.length > 1) setRows((rs) => rs.filter((x) => x.token_id !== token_id));
      return;
    }
    if (rows.length >= CURVE.max_assets) return;
    setRows((rs) => [...rs, { key: nextKey++, token_id, custom: false, weight: String(remaining), anchored: false, usd: "", decimals: "" }]);
  };
  const addCustom = () => {
    if (rows.length >= CURVE.max_assets) return;
    setRows((rs) => [...rs, { key: nextKey++, token_id: "", custom: true, weight: String(remaining), anchored: false, usd: "", decimals: "" }]);
  };
  const slices = computed.map((c) => ({ key: String(c.key), symbol: c.token_id ? tokenInfo(c.token_id).symbol : "?", share: totalWeight > 0 ? c.weight_bps / totalWeight : 0 }));
  const shownTicker = config.ticker || "TICKER";

  return (
    <form
      className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_380px]"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="min-w-0 space-y-5">
        <Step n={1} title="Name it" caption="This is what people see in the list and on the coin page.">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <button type="button" className="btn btn-ink btn-sm" onClick={randomize} disabled={prices.loading && !prices.data} data-testid="random-coin">
              <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden className="shrink-0">
                <rect x="2.5" y="2.5" width="15" height="15" rx="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <circle cx="7" cy="7" r="1.4" fill="currentColor" />
                <circle cx="13" cy="13" r="1.4" fill="currentColor" />
                <circle cx="13" cy="7" r="1.4" fill="currentColor" />
                <circle cx="7" cy="13" r="1.4" fill="currentColor" />
              </svg>
              Random coin
            </button>
            <span className="caption text-xs">Fills a name, a basket from different chains and weights. Change anything after.</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
            <label className="block">
              <span className="text-sm font-semibold">Ticker</span>
              <span className="relative mt-1.5 block">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-bold text-muted">$</span>
                <input
                  className="field pl-8 font-bold uppercase"
                  value={ticker}
                  maxLength={10}
                  onChange={(e) => setTicker(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                  placeholder="DEGEN"
                  aria-describedby="ticker-help"
                />
              </span>
              <span id="ticker-help" className="caption mt-1 block text-xs">
                2 to 10 characters, A–Z and 0–9
              </span>
            </label>
            <label className="block">
              <span className="text-sm font-semibold">Name</span>
              <input className="field mt-1.5" value={name} maxLength={48} onChange={(e) => setName(e.target.value)} placeholder="Degen" />
            </label>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Monogram ticker={config.ticker || "??"} icon={icon} size={44} />
            <label className="btn btn-quiet btn-sm cursor-pointer focus-within:outline-2 focus-within:outline-[var(--focus)]">
              {icon ? "Change icon" : "Add an icon"}
              <input type="file" accept="image/png,image/svg+xml,image/webp" className="sr-only" onChange={(e) => onIcon(e.target.files?.[0])} />
            </label>
            {icon && (
              <button type="button" className="text-sm font-semibold text-ink-2 hover:text-ink" onClick={() => onIcon(undefined)}>
                Remove
              </button>
            )}
            <span className="caption text-xs">Optional. PNG, SVG or WebP under 8 KB; it is stored on chain.</span>
          </div>
          {iconErr && <p className="mt-2 text-sm font-semibold text-down">{iconErr}</p>}
        </Step>

        <Step
          n={2}
          title="Pick what backs it"
          caption="Every buy sends this basket into the coin's vault, by dollar weight at today's prices. Anchored assets can't be voted out; holders can challenge the rest."
        >
          <div className="space-y-4" role="group" aria-label="Assets in the basket">
            {ASSET_GROUPS.map((g) => {
              const items = knownOptions.filter((t) => groupOf(t.symbol) === g.id);
              if (items.length === 0) return null;
              return (
                <div key={g.id}>
                  <p className="label mb-2">{g.label}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {items.map((t) => {
                      const on = used.has(t.token_id);
                      return (
                        <button
                          key={t.token_id}
                          type="button"
                          className="chip h-10 pl-1.5"
                          aria-pressed={on}
                          disabled={!on && rows.length >= CURVE.max_assets}
                          onClick={() => toggle(t.token_id)}
                          title={on ? (rows.length > 1 ? `Remove ${t.symbol}` : "A basket needs at least one asset") : `Add ${t.symbol}`}
                        >
                          <TokenIcon symbol={t.symbol} size={26} chain />
                          {t.symbol}
                          {t.symbol.toUpperCase() === "JAMBO" && <span className="text-[11px] font-medium opacity-60">from meme.cooking</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            <button type="button" className="chip h-10" disabled={rows.length >= CURVE.max_assets} onClick={addCustom}>
              <IconPlus size={12} />
              Other token
            </button>
          </div>

          <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-start">
            <BasketPie slices={slices} size={136} label={`Basket preview: ${slices.map((x) => `${x.symbol} ${Math.round(x.share * 100)}%`).join(", ")}`} className="mx-auto sm:mx-0">
              <span className={cx("num text-lg font-bold leading-none", totalWeight !== 10_000 && "text-down")}>{(totalWeight / 100).toFixed(0)}%</span>
              <span className="caption mt-0.5 text-[11px]">of 100%</span>
            </BasketPie>
            <ul className="min-w-0 flex-1 divide-y divide-line">
              {computed.map((r) => {
                const sym = r.token_id ? tokenInfo(r.token_id).symbol : "New token";
                const w = Number(r.weight) || 0;
                return (
                  <li key={r.key} className="py-3 first:pt-0">
                    <div className="flex items-center gap-3">
                      <span className="flex w-20 shrink-0 items-center gap-2 font-semibold">
                        <TokenIcon symbol={sym} size={18} chain />
                        <span className="truncate">{sym}</span>
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={Math.min(100, Math.max(0, w))}
                        onChange={(e) => update(r.key, { weight: e.target.value })}
                        className="min-w-0 flex-1"
                        aria-label={`${sym} weight`}
                      />
                      <span className="relative w-[4.5rem] shrink-0">
                        <input className="field num h-9 min-h-0 rounded-full pr-6 text-right text-sm font-semibold" inputMode="decimal" value={r.weight} onChange={(e) => update(r.key, { weight: e.target.value })} aria-label={`${sym} weight in percent`} />
                        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted">%</span>
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 pl-[5.75rem] max-sm:pl-0">
                      <button type="button" className="chip h-7 min-h-0 px-2.5 text-xs" aria-pressed={r.anchored} onClick={() => update(r.key, { anchored: !r.anchored })} title="Anchored assets can't be challenged">
                        <IconAnchor size={12} />
                        {r.anchored ? "Anchored" : "Anchor it"}
                      </button>
                      <button
                        type="button"
                        className="chip h-7 min-h-0 px-2.5 text-xs"
                        disabled={rows.length <= 1}
                        onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                        aria-label={`Remove ${sym}`}
                      >
                        <IconClose size={11} />
                        Remove
                      </button>
                      <span className="caption num text-xs">
                        {r.err ? <span className="font-semibold text-down">{r.err}</span> : r.q !== "0" ? `${assetAmount(r.token_id, r.q)} ${sym} per basket unit` : ""}
                      </span>
                    </div>
                    {r.custom && (
                      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_6rem_6rem] gap-2">
                        <label className="block">
                          <span className="text-xs font-semibold">Token id</span>
                          <input className="field mono mt-1 h-10 min-h-0 text-sm" placeholder={`nep141:token.${NET.id}`} value={r.token_id} onChange={(e) => update(r.key, { token_id: e.target.value })} />
                        </label>
                        <label className="block">
                          <span className="text-xs font-semibold">USD price</span>
                          <input className="field num mt-1 h-10 min-h-0 text-sm" inputMode="decimal" value={r.usd} onChange={(e) => update(r.key, { usd: e.target.value })} />
                        </label>
                        <label className="block">
                          <span className="text-xs font-semibold">Decimals</span>
                          <input className="field num mt-1 h-10 min-h-0 text-sm" inputMode="numeric" value={r.decimals} onChange={(e) => update(r.key, { decimals: e.target.value.replace(/\D/g, "") })} />
                        </label>
                        <p className="col-span-3 text-xs font-semibold text-down">Not on the known list: the coin page will mark it as unverified backing, and buyers must be able to get it.</p>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
            <p className={cx("text-sm font-semibold", totalWeight === 10_000 ? "text-ink-2" : "text-down")}>
              {totalWeight === 10_000 ? "Weights add up to 100%." : `Weights add up to ${(totalWeight / 100).toFixed(2)}%; they need to make 100%.`}
            </p>
            <button type="button" className="btn btn-quiet btn-xs" onClick={equalize}>
              Even them out
            </button>
          </div>
        </Step>

        <Step n={3} title="Set the rules" caption="Fixed at launch; nobody can change them later, including you.">
          <div className="grid gap-6 sm:grid-cols-2">
            <label className="block">
              <span className="flex items-baseline justify-between">
                <span className="text-sm font-semibold">Trade fee</span>
                <span className="num text-lg font-bold">{(feeBps / 100).toFixed(2)}%</span>
              </span>
              <input type="range" min={CURVE.fee_min_bps} max={CURVE.fee_max_bps} step={5} value={feeBps} onChange={(e) => setFeeBps(Number(e.target.value))} className="mt-3 w-full" />
              <span className="caption mt-1 block text-xs">Split 50% to you, 30% to the vault (it raises the floor), 20% to the protocol.</span>
            </label>
            <div>
              <span className="text-sm font-semibold">Rounds</span>
              <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Round length">
                {(["demo", "prod"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={profile === p}
                    onClick={() => setProfile(p)}
                    className={cx("rounded-[14px] border-[1.5px] px-3.5 py-2.5 text-left transition-colors", profile === p ? "border-ink bg-sunk" : "border-line hover:border-line-2")}
                  >
                    <span className="block text-sm font-semibold">{p === "demo" ? "Demo" : "Production"}</span>
                    <span className="caption block text-xs">{p === "demo" ? "10-min rounds, 2-min fair launch" : "7-day rounds, 10-min fair launch"}</span>
                  </button>
                ))}
              </div>
            </div>
            <label className="block sm:col-span-2">
              <span className="text-sm font-semibold">Dollar size of 1 basket unit</span>
              <span className="relative mt-1.5 block max-w-[12rem]">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted">$</span>
                <input className="field num pl-8" inputMode="decimal" value={buUsd} onChange={(e) => setBuUsd(e.target.value)} />
              </span>
              <span className="caption mt-1 block text-xs">
                Sets how much a coin needs to graduate: 20,000 units = {buUsdE6 > 0 ? usd((20_000 * buUsdE6) / 1e6) : "–"}. After launch it only changes how prices are shown.
              </span>
            </label>
          </div>
        </Step>
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start" aria-labelledby="preview-h">
        <section className="card p-5">
          <h2 id="preview-h" className="h2">
            Your coin page
          </h2>
          <p className="caption mt-0.5">What buyers see the moment it launches.</p>
          <div className="slab mt-4 overflow-hidden rounded-[18px]">
            <div className="p-4 sm:p-5">
              <div className="flex items-center gap-3">
                <Monogram ticker={config.ticker || "??"} icon={icon} size={44} />
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="meme truncate text-[1.875rem] leading-none">${shownTicker}</span>
                    <StageChip mode="launch" />
                  </p>
                  <p className="caption mt-1 truncate">{config.name || "Name"}</p>
                </div>
              </div>
              <div className="mt-5">
                <MiniFloorBar share={1} className="h-6 rounded-[10px]" label="100% backed at launch" />
                <p className="mt-2 text-[13px] leading-snug text-ink-2">
                  <span className="font-bold text-ink">100% backed at launch:</span> the opening floor equals the opening price.
                </p>
              </div>
              <div className="mt-4 flex items-center gap-4">
                <span className="rounded-full bg-card p-1.5">
                  <BasketPie slices={slices} size={84} label={`Basket preview: ${slices.map((x) => `${x.symbol} ${Math.round(x.share * 100)}%`).join(", ")}`} />
                </span>
                <ul className="min-w-0 flex-1 space-y-1 text-sm">
                  {slices.map((x) => (
                    <li key={x.key} className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <TokenIcon symbol={x.symbol} size={16} chain />
                        <span className="truncate font-semibold">{x.symbol}</span>
                      </span>
                      <span className="num text-ink-2">{Math.round(x.share * 100)}%</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
          <dl className="mt-4 space-y-1.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Opening price {openUnit.label}</dt>
              <dd className="num font-semibold" title={buUsdE6 > 0 ? `${usd(openUsd)} per token` : undefined}>
                {buUsdE6 > 0 ? usd(openUsd * openUnit.mult) : "–"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Opening floor {openUnit.label}</dt>
              <dd className="num">
                <span className="floor-tag">{buUsdE6 > 0 ? usd(openUsd * openUnit.mult) : "–"}</span>
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Graduates at</dt>
              <dd className="num font-semibold">{buUsdE6 > 0 ? `${usd((20_000 * buUsdE6) / 1e6)} in the curve` : "–"}</dd>
            </div>
          </dl>
          <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-line pt-4">
            <span className="font-semibold">Costs you</span>
            <span className="num text-2xl font-bold tracking-[-0.02em]">{factory.data ? `${formatUnits(factory.data.launch_deposit, 24, { maxFraction: 2 })} NEAR` : "…"}</span>
          </div>
          <p className="caption mt-1 text-xs">A deposit that pays for the coin&apos;s own contract account. Fees and burns raise the floor from launch on.</p>

          {errors.length > 0 && (ticker || name) && (
            <ul className="mt-4 space-y-1 rounded-[14px] bg-down-soft px-3.5 py-2.5 text-sm" aria-label="Problems">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          <div className="mt-4">
            {accountId ? (
              <button type="submit" className="btn btn-ink btn-lg w-full" disabled={errors.length > 0 || !factory.data || tx.busy}>
                {tx.busy ? "Working…" : `Launch $${config.ticker || "…"}`}
              </button>
            ) : (
              <WalletButton wide solid />
            )}
          </div>
          <div className="mt-2">
            <TxStatus s={tx} />
          </div>
          {created && (
            <p className="mt-2 text-sm">
              {created === "fixture" ? (
                "Fixture mode: no coin was created."
              ) : (
                <>
                  Launched.{" "}
                  <Link className="link font-semibold" href={`/c/${created}`}>
                    Open ${config.ticker}
                  </Link>
                </>
              )}
            </p>
          )}
          {DATA_MODE === "fixture" && <p className="caption mt-2 text-xs">Fixture mode shows the transaction instead of sending it.</p>}
        </section>
      </aside>
    </form>
  );
}

function Step({ n, title, caption, children }: { n: number; title: string; caption: string; children: ReactNode }) {
  return (
    <fieldset className="card p-5 sm:p-6">
      <legend className="sr-only">{title}</legend>
      <div className="flex items-start gap-3">
        <span aria-hidden className="num inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-bold text-card">
          {n}
        </span>
        <div className="min-w-0">
          <h2 className="h2">{title}</h2>
          <p className="caption mt-0.5">{caption}</p>
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </fieldset>
  );
}
