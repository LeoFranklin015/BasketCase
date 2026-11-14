---
name: backed
description: A calm money app for memecoins; every coin wears its own colour, and a yellow highlighter marks the floor the vault backs.
colors:
  bg: "#f6f6f6"
  panel: "#ffffff"
  raised: "#ffffff"
  pane: "#ffffff"
  sunk: "#ececec"
  pill: "#ececec"
  pill-hover: "#e3e3e3"
  field: "#f2f2f2"
  grid-line: "#f0f0f0"
  line: "#ebebeb"
  line-2: "#dcdcdc"
  ink: "#111111"
  ink-hover: "#2a2a2c"
  ink-2: "#3a3a3c"
  muted: "#6e6e73"
  faint: "#8e8e93"
  floor: "#ffe14d"
  floor-ink: "#111111"
  floor-deep: "#e0b400"
  floor-soft: "#fff6c2"
  hatch: "rgb(17 17 17 / 0.14)"
  up: "#1e9e4a"
  up-line: "#2dbe60"
  up-soft: "#e6f6ec"
  down: "#e5484d"
  down-soft: "#fdeaea"
  glow: "rgba(110, 220, 150, 0.4)"
  selection: "#d9f3e1"
  asset-btc: "#f7931a"
  asset-sol: "#9945ff"
  asset-eth: "#7f8bb8"
  asset-usdc: "#2775ca"
  asset-doge: "#c2a633"
  asset-pepe: "#3d9b3a"
  asset-nvda: "#76b900"
typography:
  hero:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(2.75rem, 1.6rem + 4vw, 4.25rem)"
    fontWeight: 800
    lineHeight: 1.02
    letterSpacing: "-0.04em"
  display:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "3.75rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.035em"
    fontFeature: "\"tnum\" 1"
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "3.25rem"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.04em"
  section:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "clamp(1.5rem, 1.2rem + 1vw, 2rem)"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  ticker:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  figure:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "1.625rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.02em"
    fontFeature: "\"tnum\" 1"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "\"cv11\" 1"
  button:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.01em"
  chip:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: 1.2
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.02em"
  caption:
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.45
  mono:
    fontFamily: "JetBrains Mono Variable, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.92em"
    fontWeight: 400
    letterSpacing: "-0.01em"
rounded:
  swatch: "3px"
  tag: "7px"
  inner: "14px"
  field: "18px"
  card: "24px"
  feature: "32px"
  pill: "999px"
spacing:
  chip-gap: "8px"
  inline: "12px"
  gutter: "16px"
  card: "20px"
  stack: "24px"
  stack-wide: "32px"
  column: "40px"
  container: "1280px"
  side-column: "380px"
components:
  button-buy:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.panel}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "44px"
  button-buy-hover:
    backgroundColor: "{colors.ink-hover}"
  button-buy-lg:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.panel}"
    rounded: "{rounded.pill}"
    padding: "0 28px"
    height: "56px"
  button-ink:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.panel}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "44px"
  button-quiet:
    backgroundColor: "{colors.pill}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "44px"
  button-quiet-hover:
    backgroundColor: "{colors.pill-hover}"
  button-line:
    backgroundColor: "{colors.pill}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "44px"
  button-sell:
    backgroundColor: "{colors.pill}"
    textColor: "{colors.down}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "44px"
  button-sell-hover:
    backgroundColor: "{colors.pill-hover}"
  action-pill:
    backgroundColor: "{colors.pill}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "56px"
  icon-button:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    size: "44px"
  chip:
    backgroundColor: "{colors.pill}"
    textColor: "{colors.ink}"
    typography: "{typography.chip}"
    rounded: "{rounded.pill}"
    padding: "0 15px"
    height: "34px"
  chip-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.panel}"
  timeframe-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.panel}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "32px"
  switch:
    backgroundColor: "{colors.pill}"
    rounded: "{rounded.pill}"
    padding: "3px"
  switch-option-selected:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.chip}"
    rounded: "{rounded.pill}"
    height: "32px"
  field:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    padding: "0 18px"
    height: "52px"
  field-focus:
    backgroundColor: "{colors.panel}"
  address-pill:
    backgroundColor: "{colors.pill}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "36px"
  card:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.card}"
    padding: "{spacing.card}"
  chart-pane:
    backgroundColor: "{colors.pane}"
    textColor: "{colors.muted}"
    rounded: "{rounded.card}"
  stage-chip:
    backgroundColor: "{colors.pill}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 10px"
    height: "24px"
  stage-chip-graduated:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.panel}"
    rounded: "{rounded.pill}"
    padding: "0 10px"
    height: "24px"
  floor-tag:
    backgroundColor: "{colors.floor}"
    textColor: "{colors.floor-ink}"
    rounded: "{rounded.tag}"
    padding: "0.1em 0.45em"
  floor-bar:
    backgroundColor: "{colors.floor}"
    textColor: "{colors.floor-ink}"
    rounded: "{rounded.pill}"
    height: "56px"
  nav-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.panel}"
    rounded: "{rounded.pill}"
    padding: "8px 14px"
  tab-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.panel}"
    rounded: "{rounded.pill}"
    height: "28px"
    width: "48px"
  network-badge:
    backgroundColor: "{colors.pill}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "32px"
  notice:
    backgroundColor: "{colors.floor-soft}"
    textColor: "{colors.ink}"
    padding: "6px 16px"
  error-note:
    backgroundColor: "{colors.down-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.inner}"
    padding: "12px 16px"
---

# Design System

The product name lives in the frontmatter `name` above and, in code, only in `BRAND` (`src/lib/config.ts`). The name is a working name. This file never repeats it; the wordmark renders `BRAND.name` lowercased.

## Overview

**Creative North Star: "The Coin In Your Pocket"**

A calm money app on a phone. A soft grey page, white cards with big round corners and soft shadows, lots of space and very few things on screen at once; it should feel like opening a wallet app, not a trading terminal. Colour is rationed: the page is greys, black and white, and the only colour comes from each coin itself, its avatar in its own hue and a soft glow of that hue at the top of its page (a mint glow on the other pages). Big money numbers are set tight in Inter with their trailing decimals in grey, the way a banking app shows a balance.

Every coin is still drawn as one block. A yellow highlighter means the floor and nothing else: behind the floor number in every stat line, on the backed share of the floor bar, and as a dashed yellow line with a soft yellow area under every chart. The grey-striped rest is hype. That picture repeats at every scale: the brand mark, the floor bar under the coin's actions, the thin bar in every list row, the backed bar on the landing coin card, and the split bar in the buy sheet that reads "of your $20, $17.80 is backed".

Calm does not mean vague. Every number keeps its plain caption, the floor is never called a guarantee, our own test traders are labelled, and the story on each page runs in the order a demo would narrate it (see Layout). The app is light only, and its values are shared with the X player card (`x-card.tsx`) and the link-preview card (`og-card.tsx`); they change together. Mood reference, credited here only: the Dribbble shot "Meme Coin App UI Redesign" by Ben M., borrowed in spirit (a profile-style coin screen: title row with round icon buttons, a big avatar, an address pill, a big balance with grey decimals, a stat line, grey action pills). Nothing from it is copied. Confirmed rejections: a dark theme, a trading-terminal look, a scrolling tape, neon and glow beyond the soft page glow, and more than one accent.

**Key Characteristics:**
- Light only: page `#f6f6f6`, white 24px cards with a 1px `#ebebeb` edge and a soft shadow.
- Colour comes only from each coin's own hue (its avatar and a soft glow at the top of its page); the site's other pages carry a soft mint glow.
- Yellow `#ffe14d` is a highlighter that means the floor and nothing else.
- Black pills are the primary action; grey pills are everything else; round white icon buttons sit in title rows.
- Big money numbers in Inter 700 with grey trailing decimals; headlines in Inter 800; stat lines read "0.0108 FLOOR · 96% BACKED".
- Green and red only for change, candles, chart lines and trade direction; every change carries its direction.
- Lists are rows (avatar, name and sub-label, value and change on the right) with no table chrome.
- Token logos with a chain badge wherever an asset is named; wallet icons as black glyphs on grey discs.
- A quiet chart: a single line by default, coloured by direction, with the floor as a dashed yellow step.
- Tiny prices read per 1K or 1M tokens (`priceUnit` in `src/lib/money.ts`), always with the unit in words and the exact per-token value one hover away.
- Where guest wallets are offered (testnet), "Try it free" is the primary action for anyone not signed in.
- One palette, shared with the X player card and the link-preview card.

## Colors

Greys, black and white carry the app; each coin brings its own hue; a yellow highlighter marks the floor; green and red mark direction.

There is one theme. `<html data-theme="light">` is set in `layout.tsx`, and `:root`, `[data-theme="dark"]` and `[data-theme="light"]` all resolve to the same light tokens in `globals.css`. `ThemeToggle` renders nothing. The browser `themeColor` is `#f6f6f6`.

### Primary
- **Ink** (`ink`, `#111111`): text, the primary action (black pill with white text; hover `ink-hover`, `#2a2a2c`), selected chips, the active nav item, the active tab, the selected timeframe, the Graduated stage chip, the focus ring, the input caret, a focused field's edge, the floor line inside the floor bar and chart crosshair labels.
- **Coin Hue** (per coin, from `coinHue` in `src/lib/assets.ts`, a hash of the ticker into 0 to 359): the avatar is a solid `hsl(h 80% 52%)` circle (`coinColor`) with white bold initials, or the coin's own icon; the coin page's glow is `hsla(h, 85%, 62%, 0.32)` (`coinGlow`), set as `--glow-c` on `<html>` while the page is open. The link-preview card uses the same hue for its glow and avatar.
- **Page Glow** (`glow`, `rgba(110, 220, 150, 0.4)`): the soft mint radial (`.top-glow`, 520px tall, `radial-gradient(60% 70% at 50% 0%, …)`) at the top of every page that has no coin of its own, and behind the landing coin card.

### Secondary
- **Floor Highlighter** (`floor`, `#ffe14d`): the floor and nothing else. Behind the floor number in every stat line and list row (`.floor-tag`), the backed share of the floor bar, mini bars and the landing coin card, the soft area under the floor line on charts, floor legend swatches and the brand mark's lower half. Text on it is `floor-ink` (`#111111`).
- **Floor Line** (`floor-deep`, `#e0b400`): the dashed stepped floor line on charts and on the link-preview block, and the 1px ring around small yellow swatches.
- **Floor Wash** (`floor-soft`, `#fff6c2`): attention without alarm: the fixture-data banner, soft notices and the arrival flash on new feed rows and a changed market cap.
- **Up** (`up`, `#1e9e4a`) for text and **Up Line** (`up-line`, `#2dbe60`) for marks: a price going up, "bought" in the feed, the change beside the market cap; up candles, buy volume, a rising price line, the Growing stage dot and the live dot. **Up Wash** (`up-soft`, `#e6f6ec`): the live pill.
- **Down** (`down`, `#e5484d`): a price going down, "sold" in the feed, down candles, sell volume, a falling price line, the Sell button's text, errors. **Down Wash** (`down-soft`, `#fdeaea`): error notes, the "not deployed" banner and "unverified" asset chips.
- **Token logos and asset colours** (`asset-btc`, `asset-sol`, `asset-eth`, `asset-usdc`, `asset-doge`, `asset-pepe`, `asset-nvda`, plus USDT, WIF, BONK, FROG, NEAR in `src/lib/assets.ts`): wherever an asset is named it wears its logo (`TokenIcon`, SVGs in `public/icons/` from `@web3icons/core`, MIT) with a badge of the chain it comes from, cut out with a white ring; WIF, BONK, NVDA and FROG get a lettered disc in their asset colour. Basket donut slices use the asset colours. DOGE gold is the nearest to the highlighter; it appears only in logos, the donut and dots, always labelled.

### Neutral
- **Page** (`bg`, `#f6f6f6`): the page, under the glow.
- **White** (`panel`, `raised`, `pane`, `#ffffff`): cards, sheets, the chart pane, the selected switch option, round icon buttons, the focused field, the tab bar.
- **Pill Grey** (`pill` and `sunk`, `#ececec`; hover `pill-hover`, `#e3e3e3`): secondary buttons, chips, switch tracks, the address pill, the network badge, stage chips, skeletons, the disc behind wallet icons. **Field Grey** (`field`, `#f2f2f2`): fields at rest and the ground under the hype stripes.
- **Hairline** (`line`, `#ebebeb`) and **Hairline Strong** (`line-2`, `#dcdcdc`): card edges and row dividers; `line-2` for scrollbar thumbs. **Grid** (`grid-line`, `#f0f0f0`): horizontal chart gridlines.
- **Text greys:** `ink-2` (`#3a3a3c`) for secondary body text, `muted` (`#6e6e73`) for subheads, captions and axis text, `faint` (`#8e8e93`) for grey trailing decimals (`.cents`), stat labels (`.label`) and placeholders.
- **Hatch** (`hatch`, `rgb(17 17 17 / 0.14)`): the light grey stripe, `repeating-linear-gradient(-45deg, hatch 0 2px, transparent 2px 7px)` over `field`.
- **Selection** (`selection`, `#d9f3e1`): selected text, with ink text.

### Named Rules
**The Coin Brings The Colour Rule.** The interface is greys, black and white. The only hue on a page is the coin's own (its avatar and its glow), the token logos of what backs it, green and red for direction, and the floor highlighter.

**The Highlighter Is The Floor Rule.** Yellow appears only where the vault backs something: the floor number, the backed share of a bar, the floor line and area on charts. Never on a button, a selected state or for emphasis.

**The Hatch Means Hype Rule.** Anything above the floor is drawn as light grey stripes, never as a second colour.

**The Direction Rule.** Green and red appear only on a change, a candle, a chart line, volume and trade direction. A change always carries its direction: a sign (+12.4% / −3.1% with a true minus), or an arrow beside the coin's market cap. A number that is not a change stays ink.

**The Logo Beside The Name Rule.** An asset is never named without its logo or colour, and a logo or colour never appears without its symbol beside it; meaning is never carried by colour alone.

**The Shared Palette Rule.** The app, the X player card and the link-preview card use the same values. Change one, change all three.

## Typography

**Display Font:** Inter, loaded with `next/font` as `--font-inter` with its optical-size axis (`opsz`); character variant `cv11` is on at the body
**Body Font:** Inter
**Label/Mono Font:** JetBrains Mono Variable, only for account ids, token ids, transaction hashes and embed code

**Character:** One face, set like a banking app: tight and heavy for money and headlines, quiet and grey for labels. The personality comes from the numbers themselves (big balances with grey decimals), the coin avatars and the copy, not from the type.

### Hierarchy
- **Hero** (Inter 800, clamp 2.75rem to 4.25rem, line-height 1.02, −0.04em, about 11 characters wide): the landing headline only. Landing section headings run clamp 2.25rem to 3.75rem; the close to 4.75rem.
- **Display** (Inter 700, line-height 1, −0.035em, tabular): money. The market cap on a coin page (3rem, 3.75rem from 640px) and on the landing coin card (2.75rem), always through `Money` so its trailing decimals are `faint`. Also list-row market caps (1.375rem), the backed percentage in the floor bar and the vault total in the donut.
- **Headline** (`.meme`, Inter 800, −0.04em, 2.25rem on phones, 3.25rem from 640px): page titles on Markets, Launch, Graveyard and Simulation, and `$TICKER` in list rows (1.5rem).
- **Ticker** (Inter 700, 1.375rem, uppercase, −0.01em): the `$TICKER` in the coin page's title row; 1.125rem on the landing coin card.
- **Section** (`.h-section`, Inter 700, clamp 1.5rem to 2rem, −0.03em): headings of big cards ("What backs it", "The fight over the basket").
- **Title** (`.h2`, Inter 700, 1.125rem, −0.02em): card and sheet titles.
- **Figure** (Inter 700, 1.625rem, −0.02em): the quote in the trade sheet ("you get 2.01M DEGEN"). Amount fields type at 1.75rem bold.
- **Body** (Inter 400, 0.9375rem, 1.5): default text; the landing subhead at 17px to 19px in `muted`, held to about 30rem.
- **Button** (Inter 600, 0.9375rem, −0.01em; large 1.0625rem). **Chip** (Inter 600, 0.8125rem).
- **Label** (`.label`, Inter 500, 0.8125rem, uppercase, 0.02em, `faint`): the grey word after a black value in a stat line ("96% BACKED", "10H").
- **Caption** (Inter 400, 0.8125rem, 1.45, `muted`): the plain-word line under a number.

### Named Rules
**The Grey Decimals Rule.** A big money figure shows its trailing decimals in `faint` (`.cents`, via `Money`), so the whole-dollar part reads first.

**The Stat Line Rule.** A stat is a black value followed by a grey capital label ("0.0108 FLOOR · 96% BACKED · 0.19 PRICE / 1K"), never a boxed tile.

**The One Big Number Rule.** Each screen has one display-size figure. Everything else is at most figure size.

**The Caption Under Rule.** A number is followed by a caption in plain words, directly under it or beside it, never in a tooltip alone.

**The Friendly Unit Rule.** A dollar price below one cent is shown per 1K or per 1M tokens, with the unit spelled out ("$0.19 per 1M tokens"), and the same unit is used for its floor and on the chart axis. The exact per-token value stays one hover away (`title`) or on a caption line.

**The Mono Is For Ids Rule.** Mono appears only on account ids, token ids, hashes and embed code. Numbers, labels and headings stay in Inter.

## Layout

Markets live at `/app`; the landing page at `/` has its own surface brief.

**Demo order, per page.** Landing: the hero (an Inter 800 headline, a one-line grey subhead with the word floor highlighted, a black Try it free and a grey Open the app, a stat line of live totals, and beside it a floating white coin card over a mint glow, with coin chips above it to switch coins), "What happens to your money" as three white cards, one live coin opened up, live trades, the floor you can check, the close; every section is a white rounded card or sits on the page. Markets: a compact headline with the totals in one line, then the coins as rows, with the live feed in a card beside them. Coin page: the coin's screen top (see Coin Header), then white cards for the chart, what backs it, the fight over the basket, the auction, the stage track, trades, holders/details/curve/cross-chain tabs and Share; on desktop the buy panel is a white card in the right column.

A 1280px container (1200px on the landing hero) with a 16px gutter on phones (20px on the landing) and 32px from 1024px up. The header is 52px tall on phones and 64px from 768px, on the page colour at 90% with a heavy backdrop blur and no rule under it. Under 768px the top nav collapses to the wordmark and network badge, and a fixed 64px four-tab bar (Home, Launch, Graveyard, You) on white sits at the thumb with safe-area padding. On a coin page a sticky dock sits above the tab bar with a large black Buy (1.6 parts wide) and a grey Sell with red text, each opening the trade sheet.

From 1024px pages split into two columns: content `minmax(0, 1fr)` and a fixed side column (380px on a coin page and Launch, 360px on Markets, 340px on Graveyard) with a 40px gap. The side column is sticky at 96px from the top.

Rhythm: lots of air and few elements per view. Cards stack with 24px gaps (32px on a coin page from 1024px), card padding is 20px (24px to 32px on landing cards), rows use 10px to 16px vertical padding with hairline dividers. Landing sections breathe at 64px vertical padding on phones and 112px from 1024px; the hero runs 96px from the top on desktop. Chip and timeframe rows scroll horizontally with hidden scrollbars rather than wrapping.

## Elevation & Depth

Soft and lifted. White cards float on the grey page with a 1px `line` edge and a soft two-layer shadow; nothing is flat-on-flat and nothing is heavy. Round icon buttons and the selected switch option carry their own small shadow so they read as tappable. The landing coin card floats higher, with a deeper, wider shadow over a blurred mint glow. Colour depth comes only from the soft glow at the top of the page.

### Shadow Vocabulary
- **Card** (`--shadow-card`: `0 1px 2px rgba(0, 0, 0, 0.04), 0 8px 24px rgba(0, 0, 0, 0.05)`): every card, the slab, "What backs it", the wallet menu.
- **Floating card** (`0 1px 2px rgba(0,0,0,0.04), 0 24px 60px -20px rgba(0,0,0,0.18)`): the landing coin card, 32px corners.
- **Icon button** (`0 1px 2px rgba(0, 0, 0, 0.06), 0 4px 14px rgba(0, 0, 0, 0.08)`): round white icon buttons; hover lifts them 1px.
- **Switch thumb** (`0 1px 3px rgba(0, 0, 0, 0.1)`): the white selected option in a segmented switch.
- **Sheet lift** (`--shadow-sheet`: `0 -8px 40px rgba(0, 0, 0, 0.12)`): the bottom sheet, over a `rgb(0 0 0 / 0.32)` scrim.
- **Page glow** (`.top-glow`: `radial-gradient(60% 70% at 50% 0%, var(--glow-c, var(--glow)), transparent 70%)`, 520px tall, behind content): the coin's hue on a coin page, mint elsewhere.

### Named Rules
**The Soft Card Rule.** Every card is white with a 1px hairline and the soft card shadow. No heavy shadows, no coloured shadows, no glow except the page glow.

## Shapes

Round and soft. Every button, chip, switch, stage chip, badge, nav item, tab marker, address pill and icon button is a full pill (999px). Cards, the slab, "What backs it", the chart card, sheets (top corners) and menus use 24px; the landing coin card and its placeholder use 32px. Fields use 18px. Notices, error notes, feed rows and skeletons use 14px. The floor highlighter uses 7px and wraps across lines with its corners intact. The floor bar, the mini bar, the buy split bar and the landing card's backed bar are full pills. Avatars, coin monograms, token logos, chain badges and wallet icons are circles. Legend swatches are 10px squares at 3px.

The brand mark is the block in miniature, drawn on a 32 grid: a rounded square (7px corners), ink stripes on white above, the yellow highlighter below, an ink floor line between them, in a 2.5px ink frame (`Mark` in `chrome.tsx`). The wordmark sets `BRAND.name` lowercased in Inter 700 at 20px, −0.03em, beside it.

## Components

### Buttons
Soft pills; one black per screen.
- **Shape:** full pill (999px), no border, min-height 44px (56px large, 36px small, 30px extra small), Inter 600.
- **Primary (`.btn-buy`, `.btn-ink`):** black with white text; hover `#2a2a2c`. Buy in the trade card and the phone dock; Try it free, Launch a coin, Share, Open a coin.
- **Secondary (`.btn-quiet`, `.btn-line`):** grey `pill` with ink text; hover `pill-hover`. Open the app, Disconnect, Copy link, the faucet, and the coin header's Buy / Sell / ⋮ action pills (56px tall, an arrow icon beside the word), which open the trade card or the phone sheet.
- **Sell (`.btn-sell`):** grey `pill` with red text; hover `pill-hover`.
- **Icon button (`.icon-btn`):** a round white button (44px in the coin title row, 32px in feed rows, 36px to close a sheet) with an ink glyph and the soft icon-button shadow; hover lifts it 1px.
- **States:** 160ms colour transitions on `cubic-bezier(0.2, 0.8, 0.2, 1)`; press scales to 0.98 over 120ms; disabled at 40% opacity; focus is a 2px ink ring at 2px offset.
- **Try it free:** `TryFreeButton` (`wallet-button.tsx`), a black primary that calls `connect("guest")`. It is the primary action wherever no one is signed in and `GUEST_ENABLED` is true: the landing hero and close, the Markets header, the site header, and the trade panel. Where guest wallets are not offered, "Connect a wallet" / "Launch a coin" takes its place.

### Chips
- **Style:** grey `pill` pill, no border, 13px semibold ink, 34px tall; hover `pill-hover`.
- **State:** selected (`aria-pressed`, `aria-selected` or `aria-checked`) turns black with white text. Filters, preset amounts, slippage, the landing coin picker and section tabs.
- **Timeframe pills** (chart header): 32px pills in 13px bold tabular figures, muted at rest, grey on hover, black with white text when selected.

### Stage Chips
24px pills in 12px bold with a 6px dot. **Fair launch:** ink on `pill` with a `faint` dot. **Growing:** ink on `pill` with a blinking `up-line` dot (1.2s, two steps). **Graduated:** black with white text and a white dot.

### Switch
- **Style:** a grey `pill` segmented track with 3px padding and 2px gaps, holding two or three 32px pill options in muted 13px semibold; the selected one is white with ink text and the switch-thumb shadow. Line/Candles, USD/BU, Log, Buy/Sell, Challenge/Defend.

### Cards / Containers
- **Corner Style:** 24px (`--radius`); 32px for the landing coin card.
- **Background:** white on the grey page.
- **Shadow Strategy:** the soft card shadow (see Elevation & Depth).
- **Border:** 1px `line`.
- **Internal Padding:** 20px; a header with an Inter 700 title and a caption, then content 16px below.
- **Slab** and **What backs it** (`.band-floor`) are plain white cards in this world; the token logos in the basket legend carry the colour.

### Lists
Markets, trades and holders are rows, not tables: the avatar, the name with a grey sub-label, and the value with its change on the right; hairline dividers, no header row, no cell borders. A markets row also carries the backed share, a mini floor bar with token logos, and the floor in its highlighter.

### Inputs / Fields
- **Style:** `field` grey, no visible border, 18px corners, 52px tall, 16px text with tabular figures; placeholders in `faint`; hover darkens to `#eeeeee`. Amount fields are 64px tall with a 1.75rem bold figure and a muted currency or ticker inside. Selects carry a drawn muted chevron.
- **Focus:** the field turns white with a 1px ink edge; no ring, no glow.
- **Error / Disabled:** errors are a red sentence under the field.

### Navigation
- **Desktop:** sticky header on the page colour at 90% with a backdrop blur; the mark and wordmark, nav items (Markets, Launch, Graveyard, Simulation; 15px semibold, muted, grey fill on hover; active is a black pill with white text), the network badge (the NEAR logo and the network name on a grey pill), Try it free and the wallet button.
- **Phone:** fixed tab bar on white, four columns, 18px stroke icons over 11px semibold labels; the active tab puts its icon in a 48×28px black pill with a white glyph and its label in ink, the rest are muted. The fourth tab opens the wallet sheet.
- **Wallets:** the connect menu lists each way in with its icon, a black glyph on a grey disc (the NEAR logo, an envelope for email, a ghost for a guest wallet); the account pill is a small grey pill with the avatar and a wallet badge.

### Coin Header (signature)
The top of a coin page reads like the coin's own profile screen (`MarketHeader`):
1. A title row: the `$TICKER` in Inter 700 caps with its stage chip, and on the right two 44px round white icon buttons (Share, the contract on NEARBlocks).
2. An 88px avatar in the coin's hue (or its icon) with a NEAR chain badge on a white ring, and on the right the contract address in a grey caps pill with a copy icon ("Copied" for a moment after a tap). The coin's name sits under the avatar in `muted`.
3. The market cap in display size with grey decimals, then its change: an arrow and the percentage in green or red and the window as a grey label ("↗ 10.5% 10H"), with "market cap: the price × 84.7M tokens out there" as its caption.
4. A stat line: the floor in its highlighter with FLOOR, the backed share with BACKED, and the price per 1K with PRICE / 1K.
5. Overlapping token logos (22px, white rings) and "backed by BTC + SOL".
6. Grey Buy, Sell and ⋮ action pills, 56px tall; Buy and Sell open the trade card on desktop or the trade sheet on a phone.
7. The floor bar and its caption, which says the floor is the least a sell pays before the fee, that it moves with the assets, and that it is not a guarantee.
While the page is open the page glow takes the coin's hue.

### Floor Bar (signature)
A full pill 48px tall on phones and 56px from 640px (36px medium), with a 1px `line` ring: light grey stripes on `field`, overlaid by a full-width yellow highlighter fill clipped to the backed share so changes animate without layout (`clip-path` over 420ms, `cubic-bezier(0.16, 1, 0.3, 1)`), and a 3px ink floor line where backed ends. "92% backed" sits in the yellow when the share is 42% or more; on a thinner share it rides just past the floor line in a white pill. "hype" sits in a white pill on the stripes. Under it a legend line: swatch, "$760.72 backed by BTC + ETH · 92%", and the hype amount; while a buy is being typed it previews "→ $new". In list rows it shrinks to a 12px mini bar.

### Floor Highlighter
The floor figure with the yellow highlighter behind it (`.floor-tag`: 7px corners, `0.1em 0.45em` padding, weight 600, wrapping cleanly across lines): in every stat line, in list rows, the word "floor" in the landing subhead, the receipt's "the floor alone pays at least", and the buy sentence.

### Buy Split Bar (signature interaction)
In the trade sheet, a 16px pill bar splits the typed amount into backed (yellow) and above the floor (stripes), animating as the amount changes, followed by "of your $20.00, **$18.10** is backed by BTC + ETH" with the backed figure highlighted, and a caption explaining the rest.

### Buy Receipt
After a buy lands the trade form becomes a white card: "You're in", the tokens held in display size, what was paid, a dashed tear line, then "The floor alone pays at least" with the dollar figure highlighted and rising in over 1.1s, a 12px split bar, the not-a-guarantee caption, and Share (black) / Copy link (grey) / Buy more (grey).

### Price Chart
TradingView Lightweight Charts on white inside a 24px card. A single line by default (2px), green (`up-line`) when the price is up over the range shown and red when it is down; candles one tap away, with green and red bodies and wicks and volume as a histogram in the bottom 20% at 28% opacity. The floor is a 2px dashed `floor-deep` stepped line over a yellow area fading from 32% to 10%, with its own "floor" tag on the price axis. The last-price tag takes the line's colour. Horizontal gridlines only, in `grid-line`; no axis borders; 11px muted axis text; a dashed muted crosshair with ink labels. No watermark. The legend top left reads the ticker in Inter 700 with the interval, then Price (O/H/L/C on candles, coloured by the bar's direction), the signed change, Floor and Vol. Burns are small `ink-2` dots, graduation and launch `ink-2` arrows. A log scale switches on by itself when prices span more than 20×. Above the chart: the Line/Candles switch and the timeframe pills; below: a caption legend (price up in green, down in red; the dashed yellow floor; burn), USD/BU and Log switches, and the history source with the TradingView credit.

### Token Icons
`TokenIcon`, `ChainIcon` and `WalletIcon` (`components/token-icon.tsx`) put a logo wherever an asset is named: the coin header, basket legends, asset dot rows, the cross-chain preview, the landing proofs, the link-preview card. A token logo is a disc with a small badge of the chain it comes from (bottom right, about half its size, cut out with a 1.5px white ring); a token without a logo is a lettered disc in its asset colour. The symbol is always written beside the logo. Files are served from `public/icons/` (sources and licenses in its README); nothing is hotlinked.

### Landing Coin Card
A floating white card (32px corners, the floating shadow) over a blurred mint glow: a copy of the coin screen's top (the `$TICKER` with its stage chip, a 72px avatar with its NEAR badge, the address pill, the market cap with grey decimals, the floor highlighter and backed share, overlapping token logos with "backed by …", a 12px backed bar with its caption, and grey Buy and Sell pills that open the coin).

### Basket Donut
A donut 16% of its size thick, each slice in its asset's colour with small gaps, the vault total in the display face in the hole, and a legend of rows (token logo with chain badge, symbol, dollars, share). Empty baskets render a grey ring.

### Feed Row
A 36px generated avatar, a bold name, a muted time, then the verb with the dollar amount in bold: "bought" in semibold green, "sold" in semibold red, other verbs `ink-2`; the transaction link is a 32px round icon button. New rows arrive with a 1.6s fade from `floor-soft`. Our own testnet accounts carry a small grey "test trader" pill.

### Bottom Sheet
Slides up over 260ms (`cubic-bezier(0.16, 1, 0.3, 1)`), the scrim fades in over 200ms, max 92% of the viewport, 24px top corners, a grabber, an Inter 700 title and a round icon button to close. Escape and the scrim close it.

### Link Preview Card
The 1200×630 card (`og-card.tsx`) is the same app: the `#f6f6f6` page with a radial glow in the coin's hue, the 104px avatar in the coin's colour, the price in Inter 700 with grey decimals, a stat line with the floor highlighted (FLOOR, BACKED, PRICE / 1K), the basket with token logos, the not-a-guarantee line, and a white 36px-cornered card holding the backed block (the yellow highlighter up to its backed share over light grey stripes, with a dashed `floor-deep` floor line). Inter throughout. Yellow appears only on the floor.

### X Player Card
The X player card (`x-card.tsx`) shares the palette and the face: the `#f6f6f6` page, grey pills, a coloured avatar, a big balance with grey decimals, a grey-label stat line, green and red for change, and the floor in its highlighter.

## Do's and Don'ts

### Do:
- **Do** draw every coin's value as the block: the yellow backed share, grey-striped hype, with the dollar figures and "backed by BTC + SOL" in words.
- **Do** put the floor highlighter next to every price, and a plain caption under every number.
- **Do** say the floor moves with the assets' prices; call it the least a sell pays before the fee.
- **Do** use one black pill for the single primary action on a screen; everything else is a grey pill, and Sell is grey with red text.
- **Do** give every change its direction: a sign with a true minus (−), or an arrow, in green or red.
- **Do** show the token logo with its chain badge wherever an asset is named, and the symbol beside every logo or asset colour.
- **Do** label trades from our own accounts as test traders.
- **Do** show big money with grey trailing decimals, and stats as a black value with a grey capital label.
- **Do** keep views sparse: white 24px cards on the grey page, generous space, few elements at once.
- **Do** keep the app, the X player card and the link-preview card on the same values.
- **Do** honor reduced motion: transitions and one-off animations collapse to 0.01ms, and the blinking stage dot and pulsing dots stop outright.

### Don't:
- **Don't** call the floor a guarantee, anywhere, in any size of type.
- **Don't** use yellow for anything but the floor: not a button, a selected state or emphasis.
- **Don't** add colour to the interface beyond the coin's own hue, its glow, token logos, the floor highlighter and green and red for direction.
- **Don't** use green or red outside changes, candles, chart lines, volume and trade direction.
- **Don't** add a dark theme or dark values; the app is light only.
- **Don't** add a scrolling tape, a watermark, neon, textures or heavy and coloured shadows.
- **Don't** draw lists as tables with header rows and cell borders.
- **Don't** use mono for prices, labels or headings.
- **Don't** let an asset colour stand in for the floor: asset colours stay in logos, the donut and dots, labelled.
- **Don't** hotlink logos; they are served from `public/icons/`.
- **Don't** copy anything from the mood reference.
