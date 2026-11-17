import { expect, test } from "./fixtures";

test("the browser app meets Chromium's PWA installability checks", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "The installability inspector is a Chromium DevTools API.");
  await page.goto("./");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  const inspector = await context.newCDPSession(page);
  try {
    await expect.poll(async () => (await inspector.send("Page.getInstallabilityErrors")).installabilityErrors).toEqual([]);
  } finally { await inspector.detach(); }
});
