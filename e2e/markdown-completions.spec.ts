import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import {
  createSheet,
  openLibrary,
  readCurrentSheet,
  workspaceAction,
} from "./helpers";

async function saved(page: import("@playwright/test").Page, text: string) {
  await expect.poll(() => readCurrentSheet(page)).toBe(text);
  await expect(page.locator(".workspaceStatus [role=status]")).toHaveText(
    "Saved",
  );
}

test("wiki completion disambiguates equal titles, navigates the chosen file and is one undo", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await openLibrary(page);
  await page.getByLabel("Import files", { exact: true }).setInputFiles([
    {
      name: "Alpha.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Shared\n\nHome words. #home"),
    },
    {
      name: "Beta.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Shared\n\nWork words. #work/project"),
    },
  ]);
  await expect(
    page.getByText("Imported your files. Existing files were kept."),
  ).toBeVisible();
  const source = "# Source\n\n";
  const editor = await createSheet(page, source);
  const sourceURL = page.url();
  await editor.pressSequentially("[[Shared");
  const options = page.locator(".cm-slate-completions").getByRole("option");
  await expect(options).toHaveCount(2);
  await expect(options.nth(0)).toContainText("Alpha.md");
  await expect(options.nth(1)).toContainText("Beta.md");
  const style = await options
    .first()
    .evaluate((element) => ({
      font: getComputedStyle(element).fontFamily,
      height: element.getBoundingClientRect().height,
      touch: matchMedia("(pointer: coarse)").matches,
    }));
  expect(style.font).toContain("Geist");
  expect(style.height).toBeGreaterThanOrEqual(style.touch ? 44 : 28);
  expect(
    (await new AxeBuilder({ page }).include(".cm-slate-completions").analyze())
      .violations,
  ).toEqual([]);
  await editor.press("ArrowDown");
  await editor.press("Enter");
  const linked = source + "[[Beta.md|Shared]]";
  await saved(page, linked);
  await editor.press("ControlOrMeta+z");
  await saved(page, source + "[[Shared");
  await editor.press("Escape");
  await editor.press(
    (await page.evaluate(() => /Mac/.test(navigator.platform)))
      ? "Meta+Shift+z"
      : "Control+y",
  );
  await saved(page, linked);
  await editor.press("ControlOrMeta+Home");
  const link = editor.locator(".cm-slate-wiki-link");
  await expect(link).toHaveText("Shared");
  await link.click({ modifiers: ["ControlOrMeta"] });
  await expect(editor).toContainText("Work words.");
  await expect(page).not.toHaveURL(sourceURL);
  expect(await readCurrentSheet(page)).toBe(
    "# Shared\n\nWork words. #work/project",
  );
  await page.goto(sourceURL);
  await expect(editor).toContainText("Shared");
  expect(await readCurrentSheet(page)).toBe(linked);
});

test("tag suggestions support pointer acceptance, Escape and independent persisted settings", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await openLibrary(page);
  await page.getByLabel("Import files", { exact: true }).setInputFiles({
    name: "Tags.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Tags\n\n#work/project #home"),
  });
  await expect(
    page.getByText("Imported your files. Existing files were kept."),
  ).toBeVisible();
  const source = "# Source\n\n";
  const editor = await createSheet(page, source);
  await editor.pressSequentially("#wor");
  const popup = page.locator(".cm-slate-completions");
  const option = popup.getByRole("option").filter({ hasText: "work/project" });
  await expect(option).toBeVisible();
  await option.click();
  await saved(page, source + "#work/project");
  await editor.press("ControlOrMeta+z");
  await saved(page, source + "#wor");
  await editor.press("Escape");
  await expect(popup).toHaveCount(0);
  await saved(page, source + "#wor");
  await workspaceAction(page, "Editor settings");
  const dialog = page.getByRole("dialog", {
    name: "Editor settings",
    exact: true,
  });
  await dialog
    .getByRole("checkbox", { name: "Suggest tags after #", exact: true })
    .uncheck();
  await expect(
    dialog.getByRole("checkbox", {
      name: "Suggest sheets after [[",
      exact: true,
    }),
  ).toBeChecked();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await editor.press("ControlOrMeta+End");
  await editor.pressSequentially("k");
  await saved(page, source + "#work");
  await expect(popup).toHaveCount(0);
  await page.reload();
  await expect(editor).toBeVisible();
  await workspaceAction(page, "Editor settings");
  await expect(
    dialog.getByRole("checkbox", { name: "Suggest tags after #", exact: true }),
  ).not.toBeChecked();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await editor.press("ControlOrMeta+End");
  await editor.pressSequentially(" [[Tag");
  await expect(
    popup.getByRole("option").filter({ hasText: "Tags.md" }),
  ).toBeVisible();
  await editor.press("Tab");
  await saved(page, source + "#work [[Tags.md|Tags]]");
});
