import { expect, test } from "@playwright/test";

// Mainnet X card inside a post: MetaMask can't sign in another site's frame, so its button opens the coin page in
// a new tab with the amount and wallet carried over. Run against the mainnet app:
//   E2E_BASE_URL=https://basketcase-near.vercel.app pnpm exec playwright test -c playwright.live.config.ts live-mainnet
const COIN = "degen.basketcase.near";

test("inside an X post, MetaMask continues on the coin page in a new tab with the amount filled", async ({ page, baseURL, context }) => {
  const src = `${baseURL}/x/${COIN}`;
  await page.route("https://x.com/fake-post", (r) =>
    r.fulfill({ contentType: "text/html", body: `<!doctype html><title>post</title><body style="margin:0"><iframe id="player" src="${src}" width="500" height="500" style="border:0"></iframe></body>` }),
  );
  await page.goto("https://x.com/fake-post");
  const card = page.frameLocator("#player");
  await card.getByRole("button", { name: /Buy/ }).first().click();
  const [tab] = await Promise.all([context.waitForEvent("page"), card.getByRole("button", { name: /MetaMask/ }).click()]);
  await tab.waitForLoadState("domcontentloaded");
  expect(tab.url()).toContain(`/c/${COIN}?pay=base&usd=`);
  await expect(tab.getByText("Tap the highlighted button to pay")).toBeVisible({ timeout: 30_000 });
});
