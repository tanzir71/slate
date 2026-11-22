import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { nativeFixture } from "./nativeFixture";
import { replaceEditorText } from "../helpers";

async function prepare(page: Page) {
  await nativeFixture(page, { "kept.md": "\ufeffPrior words\r\n" });
  await page.goto("./");
  await expect(page.locator(".cm-content")).toContainText("Prior words");
  await page.locator(".spaceSwitcher").click();
  await page.getByRole("button", { name: "Start a new Space", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Start a new Space", exact: true });
  await expect(dialog.getByRole("textbox", { name: "Space name", exact: true })).toBeFocused();
  return dialog;
}
async function created(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("native-created-space") ?? "null") as { id: string; name: string; path: string } | null);
}
async function welcome(page: Page, id: string) {
  return page.evaluate(id => JSON.parse(localStorage.getItem("native-file:folder:" + id + ":Welcome.md") ?? "null") as number[] | null, id);
}

test("a new Documents Space opens its welcome, saves within its folder, and is remembered after reload", async ({ page }) => {
  const dialog = await prepare(page);
  await expect(dialog.getByRole("textbox", { name: "Space name", exact: true })).toHaveValue("Personal");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: "test-results/native-create-space-form.png" });
  await dialog.getByRole("button", { name: "Create Space", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".cm-content")).toContainText("Welcome to Slate");
  const space = await created(page); expect(space?.name).toBe("Personal"); expect(space?.path.endsWith("\\Documents\\Slate\\Personal")).toBe(true);
  const initial = await welcome(page, space!.id);
  expect(new TextDecoder().decode(new Uint8Array(initial!))).toContain("ordinary Markdown files");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("native-file:space:kept.md") ?? "null") as number[] | null)).toEqual(Array.from(new TextEncoder().encode("\ufeffPrior words\r\n")));
  await replaceEditorText(page, "My new Space words");
  await expect.poll(() => welcome(page, space!.id)).toEqual(Array.from(new TextEncoder().encode("My new Space words")));
  await page.reload();
  await expect(page.locator(".cm-content")).toHaveText("My new Space words");
  expect(await page.evaluate(() => localStorage.getItem("native-last-space"))).toBe(space!.id);
  expect(await page.evaluate(() => localStorage.getItem("native-create-attempts"))).toBe("1");
});

test("a creation conflict keeps the current Space and allows a different folder name", async ({ page }) => {
  const dialog = await prepare(page);
  await page.evaluate(() => localStorage.setItem("native-fail-create", "true"));
  await dialog.getByRole("button", { name: "Create Space", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("already exists");
  await expect(page.locator(".cm-content")).toContainText("Prior words");
  expect(await created(page)).toBeNull();
  await page.evaluate(() => localStorage.removeItem("native-fail-create"));
  await dialog.getByRole("textbox", { name: "Space name", exact: true }).fill("বাংলা Notes");
  await dialog.getByRole("button", { name: "Create Space", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".cm-content")).toContainText("Welcome to Slate");
  expect((await created(page))?.name).toBe("বাংলা Notes");
});

test("a failed open retries the created folder without another creation or welcome overwrite", async ({ page }) => {
  const dialog = await prepare(page);
  await page.evaluate(() => localStorage.setItem("native-fail-remember", "true"));
  await dialog.getByRole("button", { name: "Create Space", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("selection could not be saved");
  await expect(page.locator(".cm-content")).toContainText("Prior words");
  const space = await created(page), initial = await welcome(page, space!.id);
  await expect(dialog.getByRole("textbox", { name: "Space name", exact: true })).toBeDisabled();
  await page.screenshot({ path: "test-results/native-create-space-open-error.png" });
  await page.evaluate(() => localStorage.removeItem("native-fail-remember"));
  await dialog.getByRole("button", { name: "Open Space", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".cm-content")).toContainText("Welcome to Slate");
  expect(await welcome(page, space!.id)).toEqual(initial);
  expect(await page.evaluate(() => localStorage.getItem("native-create-attempts"))).toBe("1");
});

test("a pending creation blocks duplicate submits and closing the dialog", async ({ page }) => {
  const dialog = await prepare(page);
  await page.evaluate(() => localStorage.setItem("native-hold-create", "true"));
  await dialog.getByRole("button", { name: "Create Space", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Create Space", exact: true })).toBeDisabled();
  await dialog.locator("form").evaluate(form => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await page.keyboard.press("Escape"); await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("native-create-attempts"))).toBe("1");
  await page.evaluate(() => localStorage.removeItem("native-hold-create"));
  await expect(dialog).toBeHidden();
  await expect(page.locator(".cm-content")).toContainText("Welcome to Slate");
});

test("back and cancel leave the current folder and its exact bytes unchanged", async ({ page }) => {
  const dialog = await prepare(page);
  await dialog.getByRole("textbox", { name: "Space name", exact: true }).fill("Never created");
  await dialog.getByRole("button", { name: "Back to Spaces", exact: true }).click();
  const spaces = page.getByRole("dialog", { name: "Spaces", exact: true });
  await spaces.getByRole("button", { name: "Close Spaces", exact: true }).click();
  await expect(spaces).toBeHidden();
  expect(await created(page)).toBeNull();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("native-file:space:kept.md") ?? "null") as number[] | null)).toEqual(Array.from(new TextEncoder().encode("\ufeffPrior words\r\n")));
});
