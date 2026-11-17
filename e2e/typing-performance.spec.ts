import { expect, test } from "./fixtures";
import {
  createSheet,
  openLibrary,
  readCurrentSheet,
  showSheets,
} from "./helpers";
import type { Page } from "@playwright/test";

const sampleText = "writing with room to think and keep my words ".repeat(5);

async function typingSamples(page: Page) {
  await page.bringToFront();
  await expect
    .poll(() => page.evaluate(() => document.visibilityState))
    .toBe("visible");
  await page.evaluate(() => {
    performance.clearMeasures("slate.typing-frame");
    performance.clearMeasures("slate.recovery-sync");
    performance.clearMeasures("slate.typing-handler");
    const content = document.querySelector(".cm-content")!;
    let inputStart = 0;
    content.addEventListener(
      "beforeinput",
      () => {
        const started = performance.now();
        inputStart = started;
        requestAnimationFrame((frameTime) =>
          performance.measure("slate.typing-frame", {
            start: started,
            end: performance.now(),
            detail: {
              frameTime,
              visibility: document.visibilityState,
              focused: document.hasFocus(),
            },
          }),
        );
      },
      { capture: true },
    );
    content.addEventListener("input", () =>
      performance.measure("slate.typing-handler", {
        start: inputStart,
        end: performance.now(),
      }),
    );
  });
  await page.keyboard.type(sampleText, { delay: 30 });
  await page.waitForFunction(
    (count) =>
      performance.getEntriesByName("slate.typing-frame").length >= count,
    sampleText.length,
  );
  return page.evaluate(() =>
    performance
      .getEntriesByName("slate.typing-frame")
      .map((entry) => entry.duration)
      .sort((a, b) => a - b),
  );
}

test("50k-word typing reaches the next frame within the p95 budget", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000); // More than 200 real inputs per document make the p95 estimate meaningful.
  await page.addInitScript(() => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      const started = performance.now();
      write.call(this, key, value);
      if (
        key.startsWith("slate.recovery.") ||
        key.startsWith("slate.recovery-v2.")
      )
        performance.measure("slate.recovery-sync", {
          start: started,
          end: performance.now(),
        });
    };
  });
  const paragraph = Array.from(
    { length: 100 },
    (_, index) => `word${index}`,
  ).join(" ");
  const markdown = Array.from({ length: 500 }, () => paragraph).join("\n\n");
  await openLibrary(page);
  const short = await createSheet(page, "Short document.");
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await short.focus();
  const baseline = await typingSamples(page);
  await expect(page.locator(".workspaceStatus [role=status]")).toHaveText("Saved");
  expect(await readCurrentSheet(page)).toBe(`Short document.${sampleText}`);
  // Open a real 50k-word file; bulk contenteditable insertion is a separate paste workload.
  await page.getByLabel("Import files", { exact: true }).setInputFiles({
    name: "Fifty Thousand Words.md", mimeType: "text/markdown", buffer: Buffer.from(markdown),
  });
  await showSheets(page);
  const imported = page.locator('.browserSheetRow[data-path="Fifty Thousand Words.md"]');
  await expect(imported).toBeVisible({ timeout: 15_000 });
  await imported.click();
  await expect(page).toHaveURL(/Fifty%20Thousand%20Words\.md$/);
  const editor = page.locator(".cm-content");
  await expect(editor).toContainText("word0 word1");
  expect(
    (await readCurrentSheet(page)) === markdown,
    "The benchmark starts with all 50,000 words saved in the selected sheet",
  ).toBe(true);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  // Wait for actual FTS readiness, so background WASM startup is a separate budget.
  const search = page.getByRole("textbox", {
    name: "Search sheets",
    exact: true,
  });
  await showSheets(page);
  await search.fill("word99 word0");
  await expect(page.locator(".browserSheetRow")).toHaveCount(1);
  await search.fill("");
  if (await page.locator(".browserEditor").isHidden())
    await page
      .getByRole("button", { name: /word0 word1/ })
      .first()
      .click();
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+Home");
  const samples = await typingSamples(page);
  const p95 = samples[Math.ceil(samples.length * 0.95) - 1]!;
  const recovery = await page.evaluate(() =>
    performance
      .getEntriesByName("slate.recovery-sync")
      .map((entry) => entry.duration)
      .sort((a, b) => a - b),
  );
  const clockStep = await page.evaluate(() => {
    let previous = performance.now();
    let minimum = Infinity;
    const until = previous + 20;
    while (performance.now() < until) {
      const next = performance.now();
      if (next > previous) minimum = Math.min(minimum, next - previous);
      previous = next;
    }
    return minimum;
  });
  const events = await page.evaluate(() =>
    performance
      .getEntriesByName("slate.typing-frame")
      .map((entry) => ({
        start: entry.startTime,
        duration: entry.duration,
        detail: (entry as PerformanceMeasure).detail,
      })),
  );
  const handlers = await page.evaluate(() =>
    performance
      .getEntriesByName("slate.typing-handler")
      .map((entry) => entry.duration)
      .sort((a, b) => a - b),
  );
  console.log(
    `50k-word typing (${testInfo.project.name}): p95 ${p95.toFixed(1)} ms, ${samples.length} inputs; short-document baseline ${baseline[Math.ceil(baseline.length * 0.95) - 1]!.toFixed(1)} ms; recovery write p95 ${recovery[Math.ceil(recovery.length * 0.95) - 1] ?? 0} ms; clock step ${clockStep.toFixed(3)} ms`,
  );
  await testInfo.attach("typing-latency", {
    body: JSON.stringify({
      p95,
      samples,
      baseline,
      recovery,
      clockStep,
      handlers,
      events,
    }),
    contentType: "application/json",
  });
  await expect(page.locator(".workspaceStatus [role=status]")).toHaveText(
    "Saved",
  );
  expect(
    (await readCurrentSheet(page)) === `${sampleText}${markdown}`,
    "Every word and measured keystroke must be saved unchanged",
  ).toBe(true);
  expect(p95).toBeLessThan(16);
});
