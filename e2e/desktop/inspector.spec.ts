import { expect, test, type Page } from "@playwright/test";
import { nativeFixture } from "./nativeFixture";

const path = "Work/বাংলা note.md", source = "\uFEFF# Native Inspector\r\n\r\n## Details\r\nOriginal words.\r\n";
const inspector = (page: Page) => page.getByRole("complementary", { name: "Inspector", exact: true });
const raw = (page: Page) => page.evaluate(path => JSON.parse(localStorage.getItem("native-file:space:" + path) ?? "null") as number[] | null, path);
async function open(page: Page) {
  await nativeFixture(page, { [path]: source }); await page.goto("./");
  await expect(page.locator(".browserWorkspace")).toHaveAttribute("data-editor-ready", "true");
  await page.locator(".cm-content").press("ControlOrMeta+Shift+i");
  await expect(inspector(page).getByRole("button", { name: "Show in Explorer", exact: true })).toBeVisible();
}

test("native Inspector reads actual IPC file metadata, reveals the captured path and refreshes after saving", async ({ page }) => {
  await open(page);
  await expect(inspector(page).locator(".inspectorFilePath")).toHaveText("C:\\Slate test Space\\Work\\বাংলা note.md");
  await inspector(page).getByRole("button", { name: "Show in Explorer", exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("native-revealed"))).toBe(path);
  expect(await raw(page)).toEqual(Array.from(Buffer.from(source)));
  await inspector(page).getByRole("button", { name: "Info", exact: true }).click();
  const savedBytes = inspector(page).getByText("Saved bytes", { exact: true }).locator("xpath=following-sibling::dd[1]");
  await expect(savedBytes).toHaveText(String(Buffer.byteLength(source)));
  await expect(inspector(page).locator("time")).toHaveAttribute("datetime", "2026-11-20T00:00:00.000Z");
  const editor = page.locator(".cm-content"); await editor.press("ControlOrMeta+End"); await page.keyboard.insertText("More words");
  const changed = source + "More words";
  await expect.poll(() => raw(page)).toEqual(Array.from(Buffer.from(changed)));
  await expect(savedBytes).toHaveText(String(Buffer.byteLength(changed)));
});

test("native reveal failures remain recoverable without changing source or shared Undo", async ({ page }) => {
  await open(page); await page.evaluate(() => localStorage.setItem("native-fail-reveal", "true"));
  await inspector(page).getByRole("button", { name: "Show in Explorer", exact: true }).click();
  await expect(inspector(page).getByRole("alert")).toHaveText("File manager unavailable");
  expect(await raw(page)).toEqual(Array.from(Buffer.from(source)));
  await page.evaluate(() => localStorage.removeItem("native-fail-reveal"));
  await inspector(page).getByRole("button", { name: "Try again", exact: true }).click();
  await expect(inspector(page).getByRole("alert")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("native-revealed"))).toBe(path);
  await page.locator(".cm-content").press("ControlOrMeta+z"); expect(await raw(page)).toEqual(Array.from(Buffer.from(source)));
});

test("unsupported file bytes keep native information and reveal while outline and mentions explain their unavailable state", async ({ page }) => {
  const path = "unsupported.md", original = [0xff, 0xfe, 0x23, 0, 0x41];
  await nativeFixture(page, { [path]: "# Placeholder" }); await page.goto("./");
  await expect(page.locator(".browserWorkspace")).toHaveAttribute("data-editor-ready", "true");
  await page.evaluate(({ path, original }) => localStorage.setItem("native-file:space:" + path, JSON.stringify(original)), { path, original });
  await page.reload(); await expect(page.getByRole("heading", { name: "This file needs UTF-8.", exact: true })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Shift+i");
  await expect(inspector(page).getByText("The outline is unavailable for this file's encoding.", { exact: true })).toBeVisible();
  await expect(inspector(page).getByText("Mentions are unavailable for this file's encoding.", { exact: true })).toBeVisible();
  await inspector(page).getByRole("button", { name: "Info", exact: true }).click();
  await expect(inspector(page).getByText("UTF-8 bytes", { exact: true })).toHaveCount(0);
  await expect(inspector(page).getByText("Saved bytes", { exact: true }).locator("xpath=following-sibling::dd[1]")).toHaveText("5");
  await inspector(page).getByRole("button", { name: "Show in Explorer", exact: true }).click();
  expect(await page.evaluate(path => JSON.parse(localStorage.getItem("native-file:space:" + path) ?? "null") as number[] | null, path)).toEqual(original);
});

test("native A9 Inspector uses real outline, three links in two source cards, two mentions and its four exact icon slots", async ({ page }, testInfo) => {
  const launchPath = "Work/product/strategy/launch-plan.md";
  const launch = "# Launch plan\n\n## Goals\nRelease goals.\n\n## Phases\n\n## Success metric\n\n## Risks\n\n### Data loss during Tidy\n\n### Shortcut conflicts\n\n## Open questions\n";
  const files = { [launchPath]: launch,
    "q4-okrs.md": `# Q4 OKRs\n\n…ship everything in [[${launchPath}|Launch plan]] before the beta…\n\n[[${launchPath}|Launch plan]] guides the beta.\n`,
    "product-vision.md": `# Product vision\n\nSee [[${launchPath}|Launch plan]] for scope and phrasing.\n`,
    "notes.md": "# Notes\n\nReview Launch plan tomorrow.\n\nLaunch plan owns the dates.\n" };
  await page.setViewportSize({ width: 1440, height: 900 });
  await nativeFixture(page, files); await page.addInitScript(() => { localStorage.setItem("slate.appearance", "dark"); localStorage.setItem("slate.shortcuts.v2", "seen"); }); await page.goto("./");
  await expect(page.locator(".browserWorkspace")).toHaveAttribute("data-editor-ready", "true");
  await page.keyboard.press("ControlOrMeta+p"); const quick = page.getByRole("dialog", { name: "Quick open", exact: true });
  await quick.locator("input").fill("launch-plan.md"); await quick.getByRole("button").filter({ hasText: "launch-plan.md" }).click(); await expect(quick).toBeHidden();
  await page.locator(".cm-content").press("ControlOrMeta+Shift+i");
  await expect(inspector(page).getByRole("heading", { name: "Backlinks · 3", exact: true })).toBeVisible();
  await expect(inspector(page).locator(".inspectorBacklink")).toHaveCount(2);
  await expect(inspector(page).getByRole("button", { name: "Unlinked mentions · 2", exact: true })).toBeVisible();
  await expect(inspector(page).getByRole("button", { name: "Show in Explorer", exact: true })).toBeVisible();
  expect((await inspector(page).boundingBox())!.width).toBe(300);
  const outline = inspector(page).getByRole("region", { name: "Document outline", exact: true });
  expect((await outline.boundingBox())!.height).toBe(254);
  const goals = inspector(page).getByRole("button", { name: "Jump to Goals (H2)", exact: true }); await goals.click(); await expect(goals).toHaveAttribute("aria-current", "location");
  await inspector(page).getByRole("button", { name: "Jump to Success metric (H2)", exact: true }).hover();
  const metric = (await inspector(page).getByRole("button", { name: "Jump to Success metric (H2)", exact: true }).boundingBox())!;
  const risks = (await inspector(page).getByRole("button", { name: "Jump to Risks (H2)", exact: true }).boundingBox())!;
  await page.mouse.move(metric.x + metric.width / 2, metric.y + metric.height / 2); await page.mouse.down();
  await page.mouse.move(risks.x + risks.width / 2, risks.y + risks.height / 2, { steps: 8 }); await page.mouse.move(risks.x + risks.width / 2, risks.y + risks.height / 2);
  await expect(inspector(page).getByRole("button", { name: "Jump to Risks (H2)", exact: true })).toHaveAttribute("data-drop-before", "true");
  expect((await outline.boundingBox())!.height).toBe(254);
  const marker = await inspector(page).getByRole("button", { name: "Jump to Risks (H2)", exact: true }).evaluate(element => {
    const style = getComputedStyle(element, "::before"); return { width: style.width, height: style.height };
  });
  expect(marker).toEqual({ width: "270px", height: "2px" });
  const geometry = [];
  for (const name of ["close", "grip", "link", "folder"]) {
    const icon = name === "grip" ? inspector(page).getByRole("button", { name: "Jump to Success metric (H2)", exact: true }).locator(".inspectorGlyph--grip") : inspector(page).locator(`.inspectorGlyph--${name}`).first();
    const metrics = await icon.evaluate(element => { const box = element.getBoundingClientRect(); return { width: box.width, height: box.height, mask: getComputedStyle(element).maskImage }; });
    expect(metrics.width, name).toBe(16); expect(metrics.height, name).toBe(16); expect(metrics.mask, name).not.toBe("none"); geometry.push({ name, ...metrics });
  }
  await testInfo.attach("A9-four-icon-geometry", { body: JSON.stringify(geometry, null, 2), contentType: "application/json" });
  await testInfo.attach("A9-native-inspector", { body: await inspector(page).screenshot(), contentType: "image/png" });
  await page.keyboard.press("Escape"); await page.mouse.up();
  for (const [path, text] of Object.entries(files)) expect(await page.evaluate(path => JSON.parse(localStorage.getItem("native-file:space:" + path) ?? "null") as number[] | null, path)).toEqual(Array.from(Buffer.from(text)));
});
