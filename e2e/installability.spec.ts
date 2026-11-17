import { expect, test } from "./fixtures";
import { openLibrary } from "./helpers";

test("the browser app meets Chromium's PWA installability checks", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "The installability inspector is a Chromium DevTools API.");
  await page.goto("./");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  const inspector = await context.newCDPSession(page);
  try {
    await expect.poll(async () => (await inspector.send("Page.getInstallabilityErrors")).installabilityErrors).toEqual([]);
  } finally { await inspector.detach(); }
});

test("a browser installation offer stays reachable in the workspace and is used once", async ({ page }) => {
  await openLibrary(page);
  const install = page.getByRole("button", { name: "Install Slate", exact: true });
  await page.evaluate(() => {
    const offer = new Event("beforeinstallprompt", { cancelable: true });
    Object.defineProperty(offer, "prompt", { value: async () => { document.documentElement.dataset.installRequests = "1"; } });
    window.dispatchEvent(offer);
  });
  await expect(install).toBeVisible();
  await install.click();
  await expect(page.locator("html")).toHaveAttribute("data-install-requests", "1");
  await expect(install).toBeHidden();
  await page.evaluate(() => {
    const offer = new Event("beforeinstallprompt", { cancelable: true });
    Object.defineProperty(offer, "prompt", { value: async () => undefined });
    window.dispatchEvent(offer);
  });
  await expect(install).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  await expect(install).toBeHidden();
});
