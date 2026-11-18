import { expect, test } from "./fixtures";
import { createSheet, openLibrary, readCurrentSheet } from "./helpers";

test("the block menu reaches its first visible frame in under 50 ms", async ({
  page,
}, testInfo) => {
  await openLibrary(page);
  const editor = await createSheet(page, "");
  expect(await readCurrentSheet(page)).toBe("");
  await page.bringToFront();
  await expect
    .poll(() => page.evaluate(() => document.visibilityState))
    .toBe("visible");
  await page.evaluate(async () => {
    await document.fonts.ready;
    const content = document.querySelector<HTMLElement>(".cm-content")!;
    const measureSlash = (event: InputEvent) => {
      if (event.data !== "/") return;
      content.removeEventListener("beforeinput", measureSlash, true);
      const start = performance.now();
      const firstVisibleFrame = () => {
        const element = document.querySelector<HTMLElement>(".slateBlockMenu");
        const style = element ? getComputedStyle(element) : undefined;
        if (
          !element ||
          !element.getClientRects().length ||
          style?.visibility === "hidden" ||
          style?.display === "none"
        ) {
          requestAnimationFrame(firstVisibleFrame);
          return;
        }
        performance.measure("slate.block-menu-frame", {
          start,
          end: performance.now(),
        });
      };
      // Observe frames from the input itself. A frame requested only after a
      // mutation can miss the first paint and measure a later idle frame.
      requestAnimationFrame(firstVisibleFrame);
      const observer = new MutationObserver(() => {
        if (!document.querySelector(".slateBlockMenu")) return;
        observer.disconnect();
        performance.measure("slate.block-menu-dom", {
          start,
          end: performance.now(),
        });
      });
      observer.observe(document.body, { childList: true, subtree: true });
    };
    content.addEventListener("beforeinput", measureSlash, { capture: true });
  });
  await editor.pressSequentially("/");
  await expect(
    page.getByRole("dialog", { name: "Insert block", exact: true }),
  ).toBeVisible();
  await page.waitForFunction(
    () => performance.getEntriesByName("slate.block-menu-frame").length === 1,
  );
  const elapsed = await page.evaluate(
    () => performance.getEntriesByName("slate.block-menu-frame")[0]!.duration,
  );
  const diagnostic = await page.evaluate(() => ({
    dom: performance.getEntriesByName("slate.block-menu-dom")[0]?.duration,
    visible: document.visibilityState,
    focused: document.hasFocus(),
  }));
  console.log(
    `Block menu first frame (${testInfo.project.name}): ${elapsed} ms; ${JSON.stringify(diagnostic)}`,
  );
  await expect.poll(() => readCurrentSheet(page)).toBe("/");
  expect(elapsed).toBeLessThan(50);
});
