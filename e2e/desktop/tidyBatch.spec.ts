import { expect, test } from "@playwright/test";
import { nativeFixture } from "./nativeFixture";

const original = "\uFEFF  #   One\r\n\r\nWords kept\r\n";
const second = "  #   Two\n\nWords kept\n";
const bytes = (source: string) => Array.from(Buffer.from(source));
async function action(page: import("@playwright/test").Page, name: string) {
  await page.getByRole("button", { name: "Sheet actions", exact: true }).click();
  await page.getByRole("button", { name, exact: true }).click();
}

test("native batch review writes only selected notes, keeps raw originals and undoes after closing", async ({ page }) => {
  await nativeFixture(page, { "one.md": original, "two.md": second });
  await page.goto("./");
  await expect(page.locator(".browserWorkspace")).toHaveAttribute("data-editor-ready", "true");
  await action(page, "Command palette");
  const commands = page.getByRole("dialog", { name: "Command palette", exact: true });
  await commands.getByRole("textbox", { name: "Search commands", exact: true }).fill("Batch Tidy");
  await commands.getByRole("button", { name: "Batch Tidy", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Batch Tidy", exact: true });
  await expect(dialog.getByRole("button", { name: "Apply to 2 sheets", exact: true })).toBeEnabled();
  const read = (path: string) => page.evaluate((path) => JSON.parse(localStorage.getItem("native-file:space:" + path) ?? "null") as number[] | null, path);
  expect(await read("one.md")).toEqual(bytes(original));
  await dialog.getByRole("checkbox", { name: "Apply fixes to two.md", exact: true }).uncheck();
  await dialog.getByRole("button", { name: "Apply to 1 sheet", exact: true }).click();
  await expect(dialog.getByRole("article", { name: "one.md", exact: true })).toContainText("Applied");
  expect(await read("one.md")).toEqual(bytes(original.replace("  #   ", "# ")));
  expect(await read("two.md")).toEqual(bytes(second));
  const histories = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("native-file:space:.slate/history/")).map((key) => key.slice("native-file:space:".length)));
  expect(histories).toHaveLength(1);
  expect(await read(histories[0]!)).toEqual(bytes(original));
  await dialog.getByRole("button", { name: "Close Batch Tidy", exact: true }).click();
  await action(page, "Undo batch Tidy");
  await expect.poll(() => read("one.md")).toEqual(bytes(original));
  await page.reload();
  await expect(page.locator(".browserWorkspace")).toHaveAttribute("data-editor-ready", "true");
  expect(await read("one.md")).toEqual(bytes(original));
  expect(await read(histories[0]!)).toEqual(bytes(original));
});

test("native batch review preserves a file changed through an external watcher event", async ({ page }) => {
  await nativeFixture(page, { "one.md": original, "two.md": second });
  await page.goto("./");
  await expect(page.locator(".browserWorkspace")).toHaveAttribute("data-editor-ready", "true");
  await action(page, "Batch Tidy");
  const dialog = page.getByRole("dialog", { name: "Batch Tidy", exact: true });
  await expect(dialog.getByRole("button", { name: "Apply to 2 sheets", exact: true })).toBeEnabled();
  await page.evaluate(() => {
    localStorage.setItem("native-file:space:one.md", JSON.stringify(Array.from(new TextEncoder().encode("External words\r\n"))));
    const fixture = Reflect.get(window, "__NATIVE_FIXTURE__") as { emit(event: string, payload: unknown): void };
    fixture.emit("slate://workspace-changed", { scope: "space", error: null });
  });
  await dialog.getByRole("button", { name: "Apply to 2 sheets", exact: true }).click();
  await expect(dialog.getByRole("article", { name: "one.md", exact: true })).toContainText("Changed since review");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("native-file:space:one.md")!) as number[])).toEqual(bytes("External words\r\n"));
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("native-file:space:two.md")!) as number[])).toEqual(bytes(second));
});
