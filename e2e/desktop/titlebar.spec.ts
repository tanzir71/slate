import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { nativeFixture } from "./nativeFixture";

test.use({ viewport: { width: 1440, height: 900 } });

async function open(page: Page, platform: string) {
  await nativeFixture(page, { "note.md": "Words on disk." });
  await page.addInitScript((value) => Object.defineProperty(navigator, "platform", { configurable: true, get: () => value }), platform);
  await page.goto("./");
  await expect(page.locator(".cm-content")).toHaveText("Words on disk.");
}
const actions = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("native-window-actions") ?? "[]") as string[]);
const disk = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("native-file:space:note.md") ?? "null") as number[] | null);

for (const [platform, expected] of [["Win32", "windows"], ["Linux x86_64", "linux"]] as const) {
  test(`${expected} titlebar controls dispatch IPC and track native maximize/restore`, async ({ page }) => {
    await open(page, platform);
    const header = page.locator(".workspaceHeader");
    await expect(header).toHaveAttribute("data-native-platform", expected);
    await expect(header).toHaveAttribute("data-window-controls", "true");
    const geometry = await header.locator(".nativeWindowControls button").evaluateAll((buttons) => buttons.map((button) => {
      const bounds = button.getBoundingClientRect(); return { width: bounds.width, height: bounds.height };
    }));
    expect(geometry).toEqual(Array.from({ length: 3 }, () => ({ width: 46, height: 40 })));
    const icons = await header.locator(".windowControlIcon").evaluateAll((elements) => elements.map((element) => {
      const bounds = element.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height, mask: getComputedStyle(element).maskImage !== "none" };
    }));
    expect(icons).toEqual(Array.from({ length: 3 }, () => ({ width: 16, height: 16, mask: true })));
    await page.getByRole("button", { name: "Minimize", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Maximize", exact: true }).click();
    await expect(page.getByRole("button", { name: "Restore window", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Restore window", exact: true }).click();
    await expect(page.getByRole("button", { name: "Maximize", exact: true })).toBeVisible();
    await header.locator(".nativeTitlebarDrag").click();
    await expect.poll(() => actions(page)).toEqual([
      "plugin:window|minimize", "plugin:window|toggle_maximize", "plugin:window|toggle_maximize", "plugin:window|start_dragging",
    ]);
    await page.getByRole("button", { name: "Toggle inspector", exact: true }).click();
    await expect(page.getByRole("button", { name: "Toggle inspector", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect((await actions(page)).length).toBe(4);
    expect((await new AxeBuilder({ page }).include(".workspaceHeader").analyze()).violations).toEqual([]);
    await header.screenshot({ path: `test-results/native-titlebar-${expected}-light.png` });
    await page.getByRole("combobox", { name: "Appearance", exact: true }).selectOption("dark");
    await header.screenshot({ path: `test-results/native-titlebar-${expected}-dark.png` });
  });
}

test("macOS reserves 72px for system traffic lights without duplicate HTML controls", async ({ page }) => {
  await open(page, "MacIntel");
  const header = page.locator(".workspaceHeader");
  await expect(header).toHaveAttribute("data-native-platform", "mac");
  await expect(header).toHaveAttribute("data-window-controls", "false");
  await expect(header.locator(".nativeWindowControls")).toHaveCount(0);
  expect(await header.evaluate((element) => parseFloat(getComputedStyle(element).paddingInlineStart))).toBe(80);
  await header.locator(".nativeTitlebarDrag").click();
  await expect.poll(() => actions(page)).toEqual(["plugin:window|start_dragging"]);
  await header.screenshot({ path: "test-results/native-titlebar-macos-layout.png" });
});

test("the titlebar Close keeps a failed draft open and retries through the existing close guard", async ({ page }) => {
  await open(page, "Win32");
  await page.evaluate(() => localStorage.setItem("native-fail-save", "true"));
  const editor = page.locator(".cm-content");
  await editor.click(); await page.keyboard.press("ControlOrMeta+A"); await page.keyboard.insertText("Keep my pending words.");
  await expect(page.getByRole("alert")).toContainText("Disk is read-only");
  await page.getByRole("button", { name: "Close window", exact: true }).click();
  await expect.poll(() => actions(page)).toEqual(["plugin:window|close"]);
  await expect(editor).toHaveText("Keep my pending words.");
  expect(await disk(page)).toEqual(Array.from(new TextEncoder().encode("Words on disk.")));
  expect(await page.evaluate(() => localStorage.getItem("native-destroyed"))).toBeNull();
  await page.evaluate(() => localStorage.removeItem("native-fail-save"));
  await page.getByRole("button", { name: "Close window", exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("native-destroyed"))).toBe("true");
  expect(await disk(page)).toEqual(Array.from(new TextEncoder().encode("Keep my pending words.")));
});

test("startup errors keep the native drag region and window actions available", async ({ page }) => {
  await nativeFixture(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "platform", { configurable: true, get: () => "Win32" });
    localStorage.setItem("native-fail-read", "true");
  });
  await page.goto("./");
  await expect(page.getByRole("alert")).toContainText("Access denied");
  await expect(page.locator(".cm-content")).toHaveCount(0);
  await page.getByRole("button", { name: "Minimize", exact: true }).click();
  await page.locator(".nativeTitlebarDrag").click();
  await page.getByRole("button", { name: "Close window", exact: true }).click();
  await expect.poll(() => actions(page)).toEqual(["plugin:window|minimize", "plugin:window|start_dragging", "plugin:window|close"]);
  await page.screenshot({ path: "test-results/native-titlebar-startup-error.png" });
});

test("window-action failures stay visible without disturbing disk words", async ({ page }) => {
  await open(page, "Win32");
  await page.evaluate(() => localStorage.setItem("native-fail-window", "plugin:window|minimize"));
  await page.getByRole("button", { name: "Minimize", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Window action unavailable");
  await expect(page.locator(".cm-content")).toHaveText("Words on disk.");
  expect(await disk(page)).toEqual(Array.from(new TextEncoder().encode("Words on disk.")));
});

test.describe("touch window controls", () => {
  test.use({ hasTouch: true });
  test("keeps native window actions at least 44px tall for touch input", async ({ page }) => {
    await open(page, "Win32");
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    const bounds = await page.locator(".nativeWindowControls button").evaluateAll((buttons) => buttons.map((button) => {
      const rect = button.getBoundingClientRect(); return { width: rect.width, height: rect.height };
    }));
    expect(bounds.every((rect) => rect.width >= 44 && rect.height >= 44)).toBe(true);
    await page.getByRole("button", { name: "Minimize", exact: true }).tap();
    await expect.poll(() => actions(page)).toEqual(["plugin:window|minimize"]);
    await page.locator(".workspaceHeader").screenshot({ path: "test-results/native-titlebar-touch.png" });
  });
});
