import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  createSheet,
  openLibrary,
  expectSavedSheet as saved,
  readCurrentSheet,
} from "./helpers";
const actions = (page: Page) =>
  page.getByRole("dialog", { name: "Block actions", exact: true });

test("block-action save assertions tolerate one unavailable snapshot and still require exact bytes", async ({
  page,
}) => {
  await openLibrary(page);
  const editor = await createSheet(page, "# First\n\nKeep these words.");
  await editor.press("ControlOrMeta+Home");
  await page
    .getByRole("button", { name: "Block actions", exact: true })
    .click();
  await actions(page)
    .getByRole("button", { name: "Move block down", exact: true })
    .click();
  await expect(page.locator(".workspaceStatus [role=status]")).toHaveText(
    "Saved",
  );
  let reads = 0,
    failures = 0;
  await saved(page, "Keep these words.\n\n# First", async (currentPage) => {
    reads++;
    if (failures === 0) {
      failures++;
      await currentPage.evaluate(() => {
        throw new DOMException(
          "One unavailable block snapshot",
          "NotFoundError",
        );
      });
    }
    return readCurrentSheet(currentPage);
  });
  expect(reads).toBeGreaterThanOrEqual(2);
  expect(failures).toBe(1);
  await page.reload();
  await expect(editor).toBeVisible();
  await saved(page, "Keep these words.\n\n# First");
});

test("touch and keyboard block actions move complete Markdown with one undo and expose Turn into", async ({
  page,
}) => {
  await openLibrary(page);
  const fence = "\x60\x60\x60";
  const original =
    "# First\n\n- Keep\n  - nested 🙂\n\n" +
    fence +
    "js\n// exact bytes\n" +
    fence;
  const editor = await createSheet(page, original);
  await editor.press("ControlOrMeta+Home");
  const access = page.getByRole("button", {
    name: "Block actions",
    exact: true,
  });
  await access.focus();
  await page.keyboard.press("Enter");
  await expect(actions(page)).toContainText("Heading 1");
  await expect(
    actions(page).getByRole("button", { name: "Move block up", exact: true }),
  ).toBeDisabled();
  const bounds = await access.boundingBox();
  expect(bounds!.width).toBeGreaterThanOrEqual(44);
  expect(bounds!.height).toBeGreaterThanOrEqual(44);
  expect(
    (
      await new AxeBuilder({ page })
        .include('dialog[aria-label="Block actions"]')
        .analyze()
    ).violations,
  ).toEqual([]);
  await actions(page)
    .getByRole("button", { name: "Move block down", exact: true })
    .click();
  await saved(
    page,
    "- Keep\n  - nested 🙂\n\n# First\n\n" +
      fence +
      "js\n// exact bytes\n" +
      fence,
  );
  await editor.press("ControlOrMeta+z");
  await saved(page, original);
  await editor.press("ControlOrMeta+Home");
  await access.focus();
  await page.keyboard.press("Enter");
  await actions(page)
    .getByRole("button", { name: "Select block to format", exact: true })
    .click();
  const toolbar = page.getByRole("toolbar", {
    name: "Selection formatting",
    exact: true,
  });
  await toolbar
    .getByRole("combobox", { name: "Turn selection into", exact: true })
    .selectOption("format.heading2");
  await saved(page, original.replace("# First", "## First"));
  await editor.press("ControlOrMeta+z");
  await saved(page, original);
});

test("gutter insertion searches the shared catalog without changing source on cancel", async ({
  page,
}) => {
  await openLibrary(page);
  const original = "# First\n\nKeep these exact words.";
  const editor = await createSheet(page, original);
  await editor.press("ControlOrMeta+Home");
  const access = page.getByRole("button", {
    name: "Block actions",
    exact: true,
  });
  await access.focus();
  await page.keyboard.press("Enter");
  await actions(page)
    .getByRole("button", { name: "Insert block after", exact: true })
    .click();
  const picker = page.getByRole("dialog", {
    name: "Insert block",
    exact: true,
  });
  const search = picker.getByRole("combobox", {
    name: "Find a block",
    exact: true,
  });
  await expect(search).toBeFocused();
  await search.fill("code");
  await search.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Code language", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await saved(page, original);
  await editor.press("ControlOrMeta+Home");
  await access.focus();
  await page.keyboard.press("Enter");
  await actions(page)
    .getByRole("button", { name: "Insert block after", exact: true })
    .click();
  await search.fill("quote");
  await search.press("Tab");
  await expect(
    picker.getByRole("region", { name: "Block preview" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(search).toBeFocused();
  expect(
    (await new AxeBuilder({ page }).include(".slateBlockMenu").analyze())
      .violations,
  ).toEqual([]);
  await search.press("Enter");
  await saved(page, "# First\n\n> \n\nKeep these exact words.");
  await editor.press("ControlOrMeta+z");
  await saved(page, original);
});

test("inline catalog entries create their own paragraph after a closed fence", async ({
  page,
}) => {
  await openLibrary(page);
  await page.clock.setFixedTime(new Date("2026-11-18T12:00:00Z"));
  const source = "~~~js\nkeep();\n~~~\n\nTail";
  const editor = await createSheet(page, source);
  await editor.press("ControlOrMeta+Home");
  await page
    .getByRole("button", { name: "Block actions", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await actions(page)
    .getByRole("button", { name: "Insert block after", exact: true })
    .click();
  const search = page.getByRole("combobox", {
    name: "Find a block",
    exact: true,
  });
  await search.fill("date");
  await search.press("Enter");
  await saved(page, "~~~js\nkeep();\n~~~\n\n2026-11-18\n\nTail");
  await editor.press("ControlOrMeta+z");
  await saved(page, source);
});

test("hover plus and drag grip preserve complete blocks and undo", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "Touch uses the 44 px block actions button.");
  await openLibrary(page);
  const original = "Alpha\n\nBeta\n\nGamma";
  const editor = await createSheet(page, original);
  const alpha = editor.locator(".cm-line").filter({ hasText: /^Alpha$/ });
  await alpha.hover();
  const plus = page.getByRole("button", {
    name: "Insert block after",
    exact: true,
  });
  await expect(plus).toBeVisible();
  await plus.click();
  const picker = page.getByRole("dialog", {
    name: "Insert block",
    exact: true,
  });
  await expect(picker).toBeVisible();
  await page.keyboard.press("Escape");
  await saved(page, original);
  await alpha.hover();
  const grip = page.getByRole("button", {
    name: "Move or change block",
    exact: true,
  });
  await grip.dragTo(editor.locator(".cm-line").filter({ hasText: /^Gamma$/ }), {
    targetPosition: { x: 12, y: 2 },
  });
  await saved(page, "Beta\n\nAlpha\n\nGamma");
  await editor.press("ControlOrMeta+z");
  await saved(page, original);
});
