import { expect, test } from "./fixtures";
import { chooseAppearance, createSheet, openLibrary } from "./helpers";

// Deliver a waiting-worker event at the precise point a user's pointer is down.
// Application code and the original menu action remain unchanged.
const workboxWindow = `export class Workbox extends EventTarget {
  constructor() {
    super();
    window.addEventListener("slate-test-update", () => this.dispatchEvent(new Event("waiting")), { once: true });
  }
  register() { return Promise.resolve(); }
  messageSkipWaiting() {}
}`;

for (const appearance of ["light", "dark"] as const) {
  test(`a late update keeps the targeted menu action in place in ${appearance}`, async ({ page }, testInfo) => {
    await page.route("**/workbox-window.prod.es5-*.js", route => route.fulfill({ contentType: "text/javascript", body: workboxWindow }));
    await openLibrary(page);
    await createSheet(page, "# One\n\nWords kept.\n");
    await chooseAppearance(page, appearance);
    await page.getByRole("button", { name: "Sheet actions", exact: true }).click();
    const action = page.locator(".sheetActionsItems").getByRole("button", { name: "Batch Tidy", exact: true });
    await action.scrollIntoViewIfNeeded();
    const before = await action.boundingBox();
    expect(before).not.toBeNull();
    const point = { x: before!.x + before!.width / 2, y: before!.y + before!.height / 2 };
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    let after: Awaited<ReturnType<typeof action.boundingBox>>;
    try {
      await page.evaluate(() => window.dispatchEvent(new Event("slate-test-update")));
      await expect(page.getByRole("button", { name: "Reload", exact: true })).toBeVisible();
      after = await action.boundingBox();
      await testInfo.attach("update-menu-position", { body: JSON.stringify({ before, after, point }), contentType: "application/json" });
      await testInfo.attach("update-menu", { body: await page.screenshot(), contentType: "image/png" });
    } finally { await page.mouse.up(); }
    expect(after).toEqual(before);
    const dialog = page.getByRole("dialog", { name: "Batch Tidy", exact: true });
    await expect(dialog.getByRole("button", { name: "Review again", exact: true })).toBeEnabled();
    await expect(page.locator(".sheetActionsMenu")).not.toHaveAttribute("open");
  });
}
