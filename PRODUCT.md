# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Memecoin buyers on their phone.** They come from X or a friend's link, want to understand a coin in seconds and buy in one or two taps. Their mental model comes from consumer trading apps (FOMO, Robinhood, Pump.fun): a big price, a line going up, a big Buy button, a feed of what other people are doing.
- **Hackathon judges on a laptop.** They need to grasp the mechanic (a basket of real assets under every coin, a floor that only rises, holders fighting over the basket) from the screen itself, without reading docs.

Both are first-class (confirmed Nov 13, 2026): the phone and desktop layouts are each tuned, not one stretched into the other.

## Product Purpose

A memecoin launchpad on NEAR where every coin has a floor. Each coin's vault holds a basket of real assets (BTC, SOL, memecoins from other chains). Buying sends the basket into the vault; the price rides a bonding curve above the floor; fees and burns raise the floor; holders burn tokens to challenge or defend what the basket holds. Success: a newcomer can say what backs a coin, what the floor is, and buy, within one screen.

## Positioning

The only launchpad where a memecoin's floor is arithmetic, not a promise: vault ÷ supply, held in assets from many chains through NEAR Intents, with no admin key. Nobody else can show "of your $20, $17.80 is backed by BTC and SOL".

## Operating Context

- Coin lifecycle, in user words: **Fair launch** (first minutes, everyone gets the same price) → **Growing** (bonding curve; contract sets the price) → **Graduated** (index: no new tokens, each token is a share of the vault, a pool trades it).
- The ritual: each round (10 minutes on testnet, 7 days in production), holders **challenge** (burn to swap an asset out) or **defend** (burn to keep it). A winning challenge opens an auction; the old asset goes to the **Graveyard**.
- Buying takes two signatures (swap into the basket, then send it to the coin). On testnet the pay token is free test USDC.
- Wallets: any NEAR wallet (NEAR Connect) or email/Google/X via a Privy embedded wallet.
- Runs on NEAR testnet now; mainnet later (any token from any chain through 1Click).

## Capabilities and Constraints

- All data is live from contracts (`@backed/client`), plus `/api/history`, `/api/routes`, `/api/rpc`, `/api/fund`, `/api/og`. A fixture mode exists for offline work.
- Charts: TradingView Lightweight Charts (attribution required); candles by default, a line one tap away.
- Next.js 16, Tailwind 4, React. Playwright smoke tests and unit tests must keep passing.
- Plain-language rule: every number on screen carries a one-line plain caption. Never show a price without the floor next to it. Never call the floor a guarantee: it is backed by assets whose prices move.

## Brand Commitments

- Working name "backed"; the final name is not chosen yet (BACKED is taken by another entry). Keep the name in one place so it can be swapped.
- Earlier direction (Nov 13, 2026, superseded on Nov 14): consumer-app simplicity in the spirit of FOMO, "understandable from the screen itself", a pie of the basket assets, inline plain-word captions, line chart by default with candles available. No trading-terminal look, no "AI slop".
- Superseded the same day (Nov 14, 2026): "bolder, more meme and trader style", then "go much closer to Dracoin" (the Framer template, mood reference only; no art, text or layout copied). Dark only: green-black ground, neon mint for the brand, primary buttons and up, lime as second accent, grunge Metal Mania headlines, a tilted mint ticker band, torn mint sticker cards, a trading-style candle chart. Yellow belongs to the floor alone (floor bar, floor line, floor pill) so it stays distinct. The plain-language captions stay.
- Superseded the same day (Nov 14 later, 2026): clean board world, "clean + memecoin styled", not AI slop. Bondline (Framer template) as mood reference only; nothing copied. A calm dark trading board: near-black neutrals, 1px-line bento panels, generous space. One accent: the floor yellow, which means the floor or the primary action. Green/red only on numbers, candles and the trade tape. Memecoin energy from chunky wide Archivo type, coin and token logos with chain badges, a live mono trade tape and playful copy, never decoration. Plain-language captions stay.
- User's stated direction (Nov 14, final): clean light consumer app after Dribbble ref 16 ("Meme Coin App UI Redesign" by Ben M., mood reference only). A calm, iOS-feeling money app: soft grey page, white rounded cards, lots of space, few elements per view, black primary pills and grey secondary pills. Colour comes only from each coin's own avatar and a soft glow in that colour. Yellow is a highlighter that means the floor and nothing else. Inter only. Plain-language captions stay.

## Evidence on Hand

- Live testnet coins `$DEGEN`, `$TRENCH`, `$CHIPS`, `$DEMO1283` with real trade history, tombstones (11 assets voted out) and an auction history (transaction links per flow in `ARCHITECTURE.md`).
- Simulation output (`web/public/sim.json`, `docs/simulation.md`).
- No users, testimonials, volumes or partnerships beyond testnet. Trades on testnet come mostly from our own accounts (trader1–3, alice, bob, keeper) and must be disclosed as such, never presented as organic traction.

## Product Principles

1. **The floor is the hero.** Every screen makes "what backs this and what's the least I get back" obvious before anything else.
2. **Explain in place.** Plain words beside the number, not a docs page.
3. **One obvious action per screen.** Buy on a coin, Launch on the launch page, Burn on a challenge.
4. **Honest numbers.** Testnet is labelled, our own activity is disclosed, the floor moves with asset prices.

## Accessibility & Inclusion

WCAG 2.1 AA: contrast, keyboard access, no color-only meaning (asset colors always have a label), reduced-motion respected.
