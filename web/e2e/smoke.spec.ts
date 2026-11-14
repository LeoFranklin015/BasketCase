import { expect, test } from "@playwright/test";

// Runs against a fixture-mode build (see playwright.config.ts): no contracts needed.

function watchErrors(page: import("@playwright/test").Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

test("landing page says what this is and links to the app", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Buy the meme. Keep the index.");
  const open = page.getByRole("link", { name: "Open the app" }).first();
  await expect(open).toHaveAttribute("href", "/app");
  // The hero's live block fills once the coins load.
  await expect(page.getByRole("img", { name: /^\$\w+: \$.+ backed by .+%/ })).toBeVisible();
  await open.click();
  await expect(page).toHaveURL(/\/app$/);
  expect(errors).toEqual([]);
});

test("markets list coins with their floor bar, a sparkline and a live feed", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/app");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("floor");
  const list = page.getByTestId("coin-list");
  await expect(list.getByText("$DEGEN")).toBeVisible();
  await expect(list.getByText("$TRENCH")).toBeVisible();
  // Every row shows how much of the coin the vault backs.
  await expect(list.getByRole("img", { name: /^\$DEGEN: \$.+ of \$.+ backed$/ })).toBeVisible();
  // 24 h change, sparklines and the feed come from /api/history.
  await expect(list.getByRole("img", { name: /\$DEGEN price over the last day/ })).toBeVisible();
  await expect(page.getByTestId("global-feed").locator("li").first()).toBeVisible();
  // Sorting by "most backed" puts the rows in falling order of backed share.
  await page.getByLabel("Sort coins").selectOption("backed");
  const shares = (await list.getByText(/^\d+% backed$/).allTextContents()).map((t) => parseInt(t, 10));
  expect(shares.length).toBeGreaterThan(1);
  expect([...shares].sort((a, b) => b - a)).toEqual(shares);
  // Stage filters narrow the list.
  await page.getByRole("group", { name: "Filter coins by stage" }).getByRole("button", { name: "Growing" }).click();
  await expect(list.getByText("Fair launch", { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("coin page shows worth, floor, basket, trade card, feed and the fight", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/app");
  await page.getByTestId("coin-list").getByText("$DEGEN").click();
  await expect(page).toHaveURL(/\/c\/degen-1\./);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("$DEGEN");
  await expect(page.getByTestId("price-usd")).toContainText("$");
  await expect(page.getByTestId("floor-usd")).toContainText("$");
  await expect(page.getByTestId("floor-bar")).toContainText("backed by");
  await expect(page.getByText(/the least a sell pays before the fee/)).toBeVisible();
  await expect(page.getByRole("img", { name: /^Basket: / }).first()).toBeVisible();
  await expect(page.getByRole("tab", { name: "Buy" })).toHaveAttribute("aria-selected", "true");
  // The buy split: how much of what you pay the floor backs.
  await expect(page.getByTestId("buy-split")).toContainText(/of your \$20\.00, \$.+ is backed by/);
  // Typing an amount previews the change on the coin's floor bar (backed now → backed after the buy).
  await expect(page.getByTestId("floor-bar")).not.toContainText("→");
  await page.getByTestId("buy-amount").fill("50");
  await expect(page.getByTestId("buy-split")).toContainText(/of your \$50\.00/);
  await expect(page.getByTestId("floor-bar")).toContainText(/\$[\d,.]+ → \$[\d,.]+ backed by/);
  await expect(page.getByTestId("trades-feed").locator("li").first()).toBeVisible();
  await page.getByRole("tab", { name: "Basket details" }).click();
  await expect(page.getByText("Vault composition")).toBeVisible();
  await expect(page.getByRole("heading", { name: /fight over the basket/ })).toBeVisible();
  await expect(page.getByTestId("seat").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("coin chart draws a line over the floor, switches to candles and timeframes, and shows the curve", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/c/degen-1.fixture-factory.testnet");
  const chart = page.getByTestId("price-chart");
  await expect(chart).toBeVisible();
  // lightweight-charts draws on canvases; a sized canvas means the chart mounted.
  const canvas = chart.locator("canvas").first();
  await expect(canvas).toBeVisible();
  expect((await canvas.boundingBox())!.width).toBeGreaterThan(300);
  const legend = page.getByTestId("chart-legend");
  await expect(legend).toContainText("Price");
  await expect(legend).toContainText("Floor");
  // Candles stay one click away, with volume.
  await page.getByRole("group", { name: "Chart style" }).getByRole("button", { name: "Candles" }).click();
  await expect(page.getByRole("group", { name: "Chart style" }).getByRole("button", { name: "Candles" })).toHaveAttribute("aria-pressed", "true");
  await expect(legend).toContainText("Vol");
  await expect(chart.locator("canvas").first()).toBeVisible();
  // TradingView attribution, as a link under the plot (not a logo on the data).
  await expect(page.getByRole("region", { name: "Price chart" }).locator('a[href*="tradingview.com"]')).toHaveCount(1);
  await page.getByRole("group", { name: "Timeframe" }).getByRole("button", { name: "15m" }).click();
  await expect(page.getByRole("group", { name: "Timeframe" }).getByRole("button", { name: "15m" })).toHaveAttribute("aria-pressed", "true");
  await expect(legend).toContainText("O");
  await page.getByRole("group", { name: "Price unit" }).getByRole("button", { name: "BU" }).click();
  await expect(legend).toContainText("BU per token");
  await page.getByRole("tab", { name: "Pro: bonding curve" }).click();
  await expect(page.getByRole("img", { name: /Bonding curve\./ })).toBeVisible();
  expect(errors).toEqual([]);
});

test("on a phone, Buy opens the trade sheet with the backed split", async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/c/degen-1.fixture-factory.testnet");
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  await page.getByTestId("dock-buy").click();
  const sheet = page.getByRole("dialog", { name: /Trade \$DEGEN/ });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("tab", { name: "Buy" })).toHaveAttribute("aria-selected", "true");
  await sheet.getByRole("button", { name: "$50" }).click();
  await expect(sheet.getByTestId("buy-split")).toContainText(/of your \$50\.00/);
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("history API returns trades with a rebuilt floor and candles", async ({ request }) => {
  const res = await request.get("/api/history/degen-1.fixture-factory.testnet?tf=5m");
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.tf).toBe("5m");
  expect(body.trades.length).toBeGreaterThan(50);
  expect(body.trades[0].floor).toBeGreaterThan(0);
  expect(body.candles.length).toBeGreaterThan(5);
  const c = body.candles.at(-1);
  expect(c.high).toBeGreaterThanOrEqual(c.low);
  expect((await request.get("/api/history/someone-else.testnet")).status()).toBe(404);
});

test("widget, launch, graveyard and simulation render", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/widget/degen-1.fixture-factory.testnet");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("$DEGEN");
  await expect(page.getByTestId("price-chart")).toBeVisible();
  await page.goto("/launch");
  await expect(page.getByRole("heading", { name: "Launch a coin" })).toBeVisible();
  // Random coin fills a valid demo coin: a ticker, a name, 3 or 4 assets that add up to 100%.
  await expect(page.getByTestId("random-coin")).toBeEnabled();
  await page.getByTestId("random-coin").click();
  await expect(page.getByPlaceholder("DEGEN", { exact: true })).toHaveValue(/^[A-Z]{2,6}\d{2}$/);
  await expect(page.getByPlaceholder("Degen", { exact: true })).not.toHaveValue("");
  const weights = page.getByRole("textbox", { name: /weight in percent/ });
  await expect(weights).toHaveCount(await weights.count());
  const n = await weights.count();
  expect(n).toBeGreaterThanOrEqual(3);
  expect(n).toBeLessThanOrEqual(4);
  let total = 0;
  for (let i = 0; i < n; i++) total += Number(await weights.nth(i).inputValue());
  expect(total).toBe(100);
  await page.goto("/graveyard");
  await expect(page.getByTestId("tombstones")).toBeVisible();
  await page.goto("/sim");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("60 days");
  expect(errors).toEqual([]);
});
