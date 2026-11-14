import { expect, test, type Page } from "@playwright/test";

// Real end-to-end run on NEAR testnet, in a browser, with no wallet app. The judge's path:
//   open a coin -> Connect -> Guest wallet (gas from the relayer + 100 test USDC arrive by themselves)
//   -> Buy $5 (swap into the basket, then send the basket to the coin) -> Sell half.
// Every step is a real transaction; the test prints the explorer links it saw.
// Usage (from web/): E2E_BASE_URL=http://127.0.0.1:3311 pnpm test:live

const COIN = process.env.E2E_COIN ?? "degen-0.pad.backedlab.testnet";

const txLinks = (page: Page) =>
  page.locator('a[href*="nearblocks.io/txns/"]').evaluateAll((as) => [...new Set(as.map((a) => (a as HTMLAnchorElement).href))]);

/** Wait until new explorer links appear on the page (the flow's transactions), and print them. */
async function newTxs(page: Page, before: string[]) {
  await expect.poll(async () => (await txLinks(page)).filter((l) => !before.includes(l)).length, { timeout: 240_000 }).toBeGreaterThan(0);
  for (const l of (await txLinks(page)).filter((l) => !before.includes(l))) console.log("   tx", l);
}

test("a visitor with no wallet buys and sells a coin on testnet in four clicks", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await test.step("the coin page loads live data", async () => {
    await page.goto(`/c/${COIN}`);
    await expect(page.getByTestId("mcap-usd")).toHaveText(/\$\d/);
    await expect(page.getByTestId("floor-usd")).toBeVisible();
  });

  const buyForm = page.locator("form").filter({ has: page.getByTestId("buy-amount") }).first();

  await test.step("clicks 1-2: Connect, then Guest wallet", async () => {
    await buyForm.getByRole("button", { name: /Connect|Try it free/ }).first().click();
    await page.getByRole("button", { name: /Guest wallet/ }).first().click();
    await expect(buyForm.getByRole("button", { name: /^Buy \$/ })).toBeVisible({ timeout: 60_000 });
  });

  await test.step("click 3: Buy $5 (gas and test USDC land first, then the two buy transactions)", async () => {
    await buyForm.getByTestId("buy-amount").fill("5");
    const buy = buyForm.getByRole("button", { name: /^Buy \$/ });
    await expect(buy).toBeEnabled({ timeout: 60_000 });
    const before = await txLinks(page);
    await buy.click();
    await newTxs(page, before);
    await expect(page.getByText("Confirmed").first()).toBeVisible();
  });

  await test.step("the position shows the tokens", async () => {
    await expect(page.getByText(/You're in|You hold|Your bag|Your position/i).first()).toBeVisible({ timeout: 90_000 });
  });

  await test.step("click 4: sell half", async () => {
    await page.getByRole("tab", { name: "Sell" }).or(page.getByRole("button", { name: "Sell", exact: true })).first().click();
    const sellForm = page.locator("form").filter({ has: page.getByRole("button", { name: /^Sell \$/ }) }).first();
    await sellForm.getByRole("button", { name: /50%/ }).first().click();
    const before = await txLinks(page);
    await sellForm.getByRole("button", { name: /^Sell \$/ }).click();
    await newTxs(page, before);
  });

  expect(errors).toEqual([]);
});

// The X player card: a coin link in a post on X frames /x/<coin>, which buys in place. The post is faked
// by serving a page at https://x.com from the test (route), so the browser applies the real CSP check.
// Needs an https base URL (the X card only takes https), e.g. E2E_BASE_URL=https://<tunnel>.
const framer = (src: string) =>
  `<!doctype html><title>post</title><body style="margin:0"><iframe id="player" src="${src}" width="500" height="500" style="border:0"></iframe></body>`;

test("inside an X post, the card buys in one tap and sells in one more; other sites can't frame it", async ({ page, baseURL }) => {
  test.skip(!baseURL?.startsWith("https://"), "needs an https E2E_BASE_URL");
  const src = `${baseURL}/x/${COIN}`;
  await page.route("https://x.com/fake-post", (r) => r.fulfill({ contentType: "text/html", body: framer(src) }));
  await page.route("https://example.com/fake-page", (r) => r.fulfill({ contentType: "text/html", body: framer(src) }));

  await test.step("a site that isn't X gets nothing", async () => {
    await page.goto("https://example.com/fake-page");
    await page.waitForTimeout(5_000);
    const body = await page.frameLocator("#player").locator("body").textContent({ timeout: 2_000 }).catch(() => "");
    expect(body ?? "").not.toMatch(/Try it free|Buy/);
  });

  await page.goto("https://x.com/fake-post");
  const player = page.frameLocator("#player");
  await test.step("the card shows the coin, the backed share and one Buy button", async () => {
    await expect(player.getByText(/% backed/i)).toBeVisible();
    await expect(player.getByTestId("x-buy")).toHaveText(/^Buy$/);
    await expect(player.getByTestId("x-amount")).toBeVisible();
  });
  await test.step("type $5, Buy, pick the test key: free gas and test USDC, then the buy, inside the frame", async () => {
    await player.getByTestId("x-amount").fill("5");
    await player.getByTestId("x-buy").click();
    // Buy asks for a wallet first; the test key is the testnet one that needs no wallet app.
    await player.getByRole("button", { name: /Test key/ }).click();
    await expect(player.getByText(/You're in/)).toBeVisible({ timeout: 240_000 });
  });
  await test.step("one more tap: sell all", async () => {
    await player.getByRole("button", { name: "Sell all" }).click();
    await expect(player.getByText(/^Sold/)).toBeVisible({ timeout: 240_000 });
    const links = await player.locator('a[href*="nearblocks.io/txns/"]').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
    for (const l of links) console.log("   tx", l);
  });
});
