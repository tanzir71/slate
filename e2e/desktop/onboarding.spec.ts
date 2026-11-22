import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { nativeFixture } from "./nativeFixture";
import { sourceImportFixture } from "../sourceImportFixtures";
import { workspaceAction } from "../helpers";

const manifest = JSON.parse(readFileSync(new URL("../../packages/ui/src/assets/onboarding/manifest.json", import.meta.url), "utf8")) as { entries: { file: string; sha256: string }[] };

test.use({ viewport: { width: 1440, height: 900 } });
const heading = "Where should your writing live?";
const folder = { id: "12345678-1234-4321-9876-123456789abc", name: "Existing library", path: "C:\\Existing library" };
const original = "\ufeff# Existing words\r\n\r\nKeep these exact words.\r\n";
const sourceFiles: Record<string, string> = { logo: "3d191.svg", minus: "847f0.svg", square: "87c1a.svg", close: "bf41a.svg", folder: "baa7d.svg", sparkles: "955fb.svg", download: "0eced.svg", feather: "2ba84.svg", code: "95ffd.svg", flask: "fa28e.svg", book: "75bdc.svg", check: "0e816.svg", lock: "bcbd8.svg", drive: "c08b3.svg" };
type NativeEvents = { openFiles(files: { space: typeof folder; path: string }[]): void; emit(name: string, payload: unknown): void };
async function fresh(page: Page) { await nativeFixture(page, {}); }
async function choose(page: Page, name: string) { const radio = page.getByRole("radio", { name, exact: true }); await radio.locator("..").click(); await expect(radio).toBeChecked(); }
const files = (page: Page, id = "native-default") => page.evaluate(id => {
  const prefix = "native-file:" + (id === "native-default" ? "space" : "folder:" + id) + ":";
  return Object.fromEntries(Object.keys(localStorage).filter(key => key.startsWith(prefix)).map(key => [key.slice(prefix.length), JSON.parse(localStorage.getItem(key)!) as number[]]));
}, id);
const created = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("native-created-space") ?? "null") as { id: string; path: string } | null);
async function create(page: Page) {
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Create Space", exact: true }).click();
}
async function pickable(page: Page) {
  await page.addInitScript(({ folder, original }) => {
    localStorage.setItem("native-picked-space", JSON.stringify(folder));
    const key = "native-file:folder:" + folder.id + ":";
    if (!localStorage.getItem(key + "Existing.md")) localStorage.setItem(key + "Existing.md", JSON.stringify(Array.from(new TextEncoder().encode(original))));
  }, { folder, original });
}
test("fresh A10 matches its design geometry and all original asset slots without creating a workspace", async ({ page }) => {
  await fresh(page); await page.goto("./"); await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  expect(await files(page)).toEqual({}); expect(await page.evaluate(() => localStorage.getItem("native-last-space"))).toBeNull();
  await expect(page.getByRole("radio", { name: "Start a new Space", exact: true })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Writer", exact: true })).toBeChecked();
  expect(await page.getByRole("radio").count()).toBe(8);
  const box = await page.locator(".nativeOnboardingContent").boundingBox(); expect(box?.x).toBe(280); expect(box?.width).toBe(880);
  expect((await page.locator(".nativeOnboardingBrand").boundingBox())?.y).toBe(150);
  expect((await page.locator(".nativeStartupTitle").boundingBox())?.x).toBe(14);
  expect((await page.getByRole("button", { name: "Continue", exact: true }).boundingBox())?.width).toBe(80);
  const cardGeometry = await page.locator(".nativeOnboardingChoice").evaluateAll(elements => elements.map(element => {
    const box = element.getBoundingClientRect(); return { x: box.x, width: box.width, height: box.height };
  }));
  for (const [index, target] of [{ x: 280, width: 283.66668701171875, height: 190 }, { x: 577.6666870117188, width: 284.6666564941406, height: 175 }, { x: 876.3333740234375, width: 283.6666564941406, height: 190 }].entries()) {
    for (const key of ["x", "width", "height"] as const) expect(Math.abs(cardGeometry[index]![key] - target[key])).toBeLessThanOrEqual(1 / 64);
  }
  expect((await page.locator(".nativeOnboardingChoice[data-selected=true] .nativeOnboardingChoiceDescription").boundingBox())?.height).toBe(32);
  expect(await page.locator(".nativeOnboardingPreset").evaluateAll(elements => elements.map(element => element.getBoundingClientRect().width))).toEqual([86, 111, 118, 97, 97]);
  const slots = await page.locator("[data-asset-slot]").evaluateAll(elements => elements.map(element => ({ slot: element.getAttribute("data-asset-slot"), icon: element.getAttribute("data-icon")!, width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height, mask: getComputedStyle(element).maskImage })));
  expect(slots.map(slot => slot.slot).sort()).toEqual(["brand", "window-minimize", "window-maximize", "window-close", "choice-folder", "choice-new", "choice-import", "preset-writer", "preset-developer", "preset-researcher", "preset-student", "preset-minimal", "no-account", "offline", "local", "cache"].sort());
  for (const slot of slots) {
    expect(slot.width).toBe(slot.icon === "logo" ? 34 : 16); expect(slot.height).toBe(slot.icon === "logo" ? 34 : 16);
    const url = /^url\(["']?(.+?)["']?\)$/.exec(slot.mask)?.[1]; expect(url).toBeDefined(); expect(url).not.toContain("figma.com");
    const response = await page.request.get(url!); expect(response.ok()).toBe(true);
    expect(createHash("sha256").update(await response.body()).digest("hex")).toBe(manifest.entries.find(entry => entry.file === sourceFiles[slot.icon])?.sha256);
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: "test-results/a10-first-run-light.png" });
});
for (const preset of [
  { id: "writer", name: "Writer", template: "Writer - Draft.md", block: "Writing review.md", trigger: ";draft" },
  { id: "developer", name: "Developer", template: "Developer - Technical design.md", block: "Change checklist.md", trigger: ";code" },
  { id: "researcher", name: "Researcher", template: "Researcher - Source notes.md", block: "Evidence record.md", trigger: ";source" },
  { id: "student", name: "Student", template: "Student - Lecture notes.md", block: "Recall questions.md", trigger: ";question" },
  { id: "minimal", name: "Minimal", template: "", block: "", trigger: "" },
]) test(`A10 ${preset.name} creates a real Documents Space with the selected reusable libraries`, async ({ page }) => {
  await fresh(page); await page.goto("./"); await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  await choose(page, preset.name); await create(page);
  await expect(page.locator(".cm-content")).toContainText("Welcome");
  const space = await created(page); expect(space).not.toBeNull(); expect(await page.evaluate(() => localStorage.getItem("native-last-space"))).toBe(space!.id);
  const disk = await files(page, space!.id), libraries = Object.keys(disk).filter(path => path.startsWith(".slate/templates/") || path.startsWith(".slate/blocks/") || path === ".slate/snippets.json");
  if (preset.id === "minimal") expect(libraries).toEqual([]);
  else {
    expect(libraries).toHaveLength(4); expect(disk[".slate/templates/" + preset.template]).toBeDefined(); expect(disk[".slate/blocks/" + preset.block]).toBeDefined();
    expect(new TextDecoder().decode(new Uint8Array(disk[".slate/snippets.json"]!))).toContain(preset.trigger);
  }
  expect(await files(page)).toEqual({});
  if (preset.id === "writer") {
    await workspaceAction(page, "New from template");
    const gallery = page.getByRole("dialog", { name: "New from template", exact: true });
    await gallery.getByRole("navigation", { name: "Template categories" }).getByRole("button", { name: "Writer 2", exact: true }).click();
    await expect(gallery.locator(".templateCard strong").filter({ hasText: /^Draft$/ })).toBeVisible();
    await page.keyboard.press("Escape"); await expect(gallery).toBeHidden();
    await workspaceAction(page, "Insert snippet");
    const snippets = page.getByRole("dialog", { name: "Insert snippet", exact: true });
    await expect(snippets.getByText("Draft heading", { exact: true })).toBeVisible(); await page.keyboard.press("Escape"); await expect(snippets).toBeHidden();
    await workspaceAction(page, "Manage custom blocks");
    const blocks = page.getByRole("dialog", { name: "Custom blocks", exact: true }); await expect(blocks.getByRole("button", { name: "Edit Writing review.md", exact: true })).toBeVisible(); await page.keyboard.press("Escape"); await expect(blocks).toBeHidden();
  }
});
test("Skip opens an empty managed Space without creating starter files and is remembered after reload", async ({ page }) => {
  await fresh(page); await page.goto("./"); await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.locator(".browserWorkspace")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("native-last-space"))).toBe("native-default"); expect(await files(page)).toEqual({});
  await page.reload(); await expect(page.locator(".workspaceHeader")).toBeVisible(); await expect(page.getByRole("heading", { name: heading })).toHaveCount(0);
});
test("Open folder preserves its note/configuration bytes and Ctrl O also works in the workspace", async ({ page }) => {
  await fresh(page); await pickable(page);
  await page.addInitScript(id => localStorage.setItem("native-file:folder:" + id + ":.slate/snippets.json", JSON.stringify([255, 0, 10])), folder.id);
  await page.goto("./"); await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  await choose(page, "Student"); await page.keyboard.press("ControlOrMeta+o");
  await expect(page.locator(".cm-content")).toContainText("Existing words");
  const disk = await files(page, folder.id); expect(disk["Existing.md"]).toEqual(Array.from(Buffer.from(original))); expect(disk[".slate/snippets.json"]).toEqual([255, 0, 10]);
  expect(disk[".slate/templates/Student - Lecture notes.md"]).toBeDefined();
  await page.keyboard.press("ControlOrMeta+o"); await expect(page.locator(".cm-content")).toContainText("Existing words");
  expect((await files(page, folder.id))["Existing.md"]).toEqual(Array.from(Buffer.from(original)));
});
test("cancelled picker and Back from creation keep the first-run screen and disk unchanged", async ({ page }) => {
  await fresh(page); await page.goto("./"); await choose(page, "Open a folder");
  await page.getByRole("button", { name: "Continue", exact: true }).click(); await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
  await choose(page, "Start a new Space"); await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Back to setup", exact: true }).click(); expect(await files(page)).toEqual({});
  expect(await page.evaluate(() => localStorage.getItem("native-last-space"))).toBeNull();
});
test("the import choice reaches the reviewed converter and saves real Notion files", async ({ page }) => {
  await fresh(page); await page.goto("./"); await choose(page, "Minimal");
  await choose(page, "Import from another app"); await create(page);
  const dialog = page.getByRole("dialog", { name: "Import from another app", exact: true });
  await expect(dialog).toBeVisible(); await dialog.getByRole("combobox", { name: "Source application", exact: true }).selectOption("notion");
  await dialog.getByLabel("Choose export files", { exact: true }).setInputFiles(await sourceImportFixture("notion"));
  await expect(dialog.getByRole("region", { name: "Import preview" })).toBeVisible();
  await dialog.getByRole("button", { name: "Import notes", exact: true }).click(); await expect(dialog).toBeHidden(); await expect(page.locator(".cm-content")).toContainText("From Notion");
  const disk = await files(page, (await created(page))!.id); expect(disk["Imported from Notion/Parent.md"]).toBeDefined(); expect(disk["Imported from Notion/Parent/Child.md"]).toBeDefined();
});
test("partial preset failure retries the same created Space and retains a user's edited addition", async ({ page }) => {
  await fresh(page); await page.addInitScript(() => localStorage.setItem("native-fail-create-file", ".slate/blocks/Writing review.md"));
  await page.goto("./"); await create(page);
  const dialog = page.getByRole("dialog", { name: "Start a new Space", exact: true }); await expect(dialog.getByRole("alert")).toContainText("Starter file is unavailable");
  expect(await page.evaluate(() => localStorage.getItem("native-last-space"))).toBeNull(); const id = (await created(page))!.id;
  await page.evaluate(id => { localStorage.removeItem("native-fail-create-file"); localStorage.setItem("native-file:folder:" + id + ":.slate/templates/Writer - Draft.md", JSON.stringify(Array.from(new TextEncoder().encode("Edited during recovery")))); }, id);
  await dialog.getByRole("button", { name: "Open Space", exact: true }).click(); await expect(page.locator(".cm-content")).toContainText("Welcome");
  expect(await page.evaluate(() => localStorage.getItem("native-create-attempts"))).toBe("1"); expect(new TextDecoder().decode(new Uint8Array((await files(page, id))[".slate/templates/Writer - Draft.md"]!))).toBe("Edited during recovery");
});
test("an OS file delivered while first run is visible takes priority without creating a new Space", async ({ page }) => {
  await fresh(page); await pickable(page); await page.goto("./"); await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  await page.evaluate(folder => (Reflect.get(window, "__NATIVE_FIXTURE__") as NativeEvents).openFiles([{ space: folder, path: "Existing.md" }]), folder);
  await expect(page.locator(".cm-content")).toContainText("Existing words"); expect(await created(page)).toBeNull(); expect((await files(page, folder.id))["Existing.md"]).toEqual(Array.from(Buffer.from(original)));
});
test("short desktop and dark appearance keep all onboarding actions reachable", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 700 }); await page.emulateMedia({ colorScheme: "dark" }); await fresh(page); await page.goto("./");
  await expect(page.getByRole("heading", { name: heading })).toBeVisible(); await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeInViewport({ ratio: 1 });
  await choose(page, "Minimal"); expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: "test-results/a10-first-run-dark-short.png" });
});
test("an OS file queued during preset writes waits for them and then opens its admitted Space", async ({ page }) => {
  await fresh(page); await pickable(page); await page.addInitScript(() => localStorage.setItem("native-hold-create-file", ".slate/templates/Writer - Draft.md"));
  await page.goto("./"); await create(page);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("native-create-file-waiting"))).toBe(".slate/templates/Writer - Draft.md");
  const personal = (await created(page))!.id;
  await page.evaluate(folder => (Reflect.get(window, "__NATIVE_FIXTURE__") as NativeEvents).openFiles([{ space: folder, path: "Existing.md" }]), folder);
  await expect(page.getByRole("dialog", { name: "Start a new Space", exact: true })).toBeVisible();
  await page.evaluate(() => localStorage.removeItem("native-hold-create-file"));
  await expect(page.locator(".cm-content")).toContainText("Existing words");
  expect((await files(page, personal))[".slate/snippets.json"]).toBeDefined(); expect((await files(page, folder.id))["Existing.md"]).toEqual(Array.from(Buffer.from(original)));
});
test("native Close waits for the complete starter-library batch", async ({ page }) => {
  await fresh(page); await page.addInitScript(() => localStorage.setItem("native-hold-create-file", ".slate/templates/Writer - Draft.md"));
  await page.goto("./"); await create(page);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("native-create-file-waiting"))).toBe(".slate/templates/Writer - Draft.md");
  await page.evaluate(() => (Reflect.get(window, "__NATIVE_FIXTURE__") as NativeEvents).emit("tauri://close-requested", null));
  expect(await page.evaluate(() => localStorage.getItem("native-destroyed"))).toBeNull();
  const personal = (await created(page))!.id; await page.evaluate(() => localStorage.removeItem("native-hold-create-file"));
  await expect.poll(() => page.evaluate(() => localStorage.getItem("native-destroyed"))).toBe("true");
  const disk = await files(page, personal); expect(disk[".slate/templates/Writer - Draft.md"]).toBeDefined(); expect(disk[".slate/templates/Writer - Story outline.md"]).toBeDefined(); expect(disk[".slate/blocks/Writing review.md"]).toBeDefined(); expect(disk[".slate/snippets.json"]).toBeDefined();
});
