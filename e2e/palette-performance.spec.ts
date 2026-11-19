import { expect, test } from "./fixtures";
import { preparePaletteCorpus } from "./paletteCorpus";

test("a 10k-sheet palette opens and shows its first query frame in under 30 ms", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await preparePaletteCorpus(page);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const started = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !event.ctrlKey && !event.metaKey) return;
      window.removeEventListener("keydown", started, true);
      const start = performance.now();
      const frame = () => {
        const modal = document.querySelector<HTMLDialogElement>(".slatePalette[open]");
        if (!modal?.getClientRects().length) { requestAnimationFrame(frame); return; }
        performance.measure("slate.palette-open-frame", { start, end: performance.now() });
      };
      requestAnimationFrame(frame);
    };
    window.addEventListener("keydown", started, true);
  });
  await page.keyboard.press("ControlOrMeta+k");
  const modal = page.getByRole("dialog", { name: "Command palette", exact: true }); await expect(modal).toBeVisible();
  await page.waitForFunction(() => performance.getEntriesByName("slate.palette-open-frame").length === 1);
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>(".paletteInput")!;
    input.addEventListener("beforeinput", () => {
      const start = performance.now();
      const frame = () => {
        const choice = document.querySelector<HTMLElement>('.slatePalette .commandResults button[aria-label="Note 09999"]');
        if (!choice?.getClientRects().length) { requestAnimationFrame(frame); return; }
        performance.measure("slate.palette-query-frame", { start, end: performance.now() });
      };
      requestAnimationFrame(frame);
    }, { once: true });
  });
  await page.keyboard.insertText("Note 09999");
  await page.waitForFunction(() => performance.getEntriesByName("slate.palette-query-frame").length === 1);
  await expect(modal.getByRole("button", { name: "Note 09999", exact: true })).toHaveCount(2);
  const measurements = await page.evaluate(() => ({
    open: performance.getEntriesByName("slate.palette-open-frame")[0]!.duration,
    query: performance.getEntriesByName("slate.palette-query-frame")[0]!.duration,
    visible: document.visibilityState, focused: document.hasFocus(),
  }));
  console.log(`10k-sheet palette (${testInfo.project.name}): ${JSON.stringify(measurements)}`);
  expect(measurements.visible).toBe("visible"); expect(measurements.focused).toBe(true);
  expect(measurements.open).toBeLessThan(30); expect(measurements.query).toBeLessThan(30);
});
