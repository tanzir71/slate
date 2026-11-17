import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { chooseAppearance, createSheet, openLibrary } from "./helpers";

const modifier = process.platform === "darwin" ? "Meta" : "Control";

test("selection toolbar preserves words, stays outside the selection and gives each action one undo", async ({
  page,
}) => {
  await openLibrary(page);
  const editor = await createSheet(page, "words");
  const toolbar = page.getByRole("toolbar", { name: "Selection formatting" });
  await expect(toolbar).toBeHidden();
  const actions = [
    ["Bold", "**words**"],
    ["Italic", "*words*"],
    ["Strikethrough", "~~words~~"],
    ["Inline code", "`words`"],
    ["Insert link", "[words](url)"],
    ["Highlight", "==words=="],
    ["Comment", "<!-- words -->"],
  ];
  for (const [label, expected] of actions) {
    await page.keyboard.press(`${modifier}+a`);
    await expect(toolbar).toBeVisible();
    const bounds = await toolbar.boundingBox();
    const selection = await page.evaluate(() => {
      const bounds = window
        .getSelection()!
        .getRangeAt(0)
        .getBoundingClientRect();
      return { top: bounds.top, bottom: bounds.bottom };
    });
    expect(
      bounds!.y + bounds!.height <= selection.top ||
        bounds!.y >= selection.bottom,
    ).toBe(true);
    await toolbar.getByRole("button", { name: label!, exact: true }).click();
    await expect(editor).toHaveText(expected!);
    await expect(editor).toBeFocused();
    await page.keyboard.press(`${modifier}+z`);
    await expect(editor).toHaveText("words");
  }
  await page.keyboard.press(`${modifier}+a`);
  await toolbar
    .getByRole("combobox", { name: "Turn selection into" })
    .selectOption("format.heading2");
  await expect(editor).toHaveText("## words");
  await page.keyboard.press(`${modifier}+z`);
  await expect(editor).toHaveText("words");
  await page.keyboard.press("Escape");
  await expect(toolbar).toBeHidden();
});

test("selection toolbar is keyboard reachable, accessible in Dark and hidden for a read-only tab", async ({
  page,
  context,
  browserName,
}) => {
  await openLibrary(page);
  const editor = await createSheet(page, "words");
  await chooseAppearance(page, "dark");
  await editor.focus();
  await page.keyboard.press(`${modifier}+a`);
  const toolbar = page.getByRole("toolbar", { name: "Selection formatting" });
  await expect(toolbar).toBeVisible();
  await expect(
    toolbar.getByRole("button", { name: "Bold", exact: true }),
  ).toHaveAttribute("title", /Bold \((Ctrl|⌘) B\)/);
  const results = await new AxeBuilder({ page })
    .include(".selectionToolbar")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
  // Safari's default macOS navigation uses Option-Tab for buttons and links.
  await page.keyboard.press(process.platform === "darwin" && browserName === "webkit" ? "Alt+Tab" : "Tab");
  await expect(
    toolbar.getByRole("button", { name: "Bold", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(
    toolbar.getByRole("button", { name: "Italic", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(editor).toHaveText("*words*");
  await page.keyboard.press(`${modifier}+z`);
  const reader = await context.newPage();
  await reader.goto("./");
  await expect(reader.locator(".cm-content")).toHaveAttribute(
    "contenteditable",
    "false",
  );
  await reader.locator(".cm-content").click();
  await reader.keyboard.press(`${modifier}+a`);
  await expect(
    reader.getByRole("toolbar", { name: "Selection formatting" }),
  ).toBeHidden();
  await expect(editor).toHaveText("words");
});
