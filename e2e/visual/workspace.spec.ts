import { expect, test, type Page } from "@playwright/test";
import { workspaceAction } from "../helpers";

test.skip(
  process.platform !== "linux",
  "Pixel baselines require the pinned Linux Chromium reference image.",
);

async function stableFrame(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect(page.getByRole("alert")).toHaveCount(0);
}

async function writingFixture(page: Page) {
  await page.goto("./?sample=1");
  await expect(page.locator(".browserSheetRow")).toHaveCount(7);
  await page
    .getByRole("button", { name: "Keep these sheets", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Keep these sheets", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".browserSheetRow")).toHaveCount(7);
  await page
    .locator('.browserSheetRow[data-path="product/strategy/Launch Plan.md"]')
    .click();
  await expect(page.locator(".cm-content")).toContainText(
    "A focused plan to launch Slate",
  );
  await workspaceAction(page, "Pin sheet");
  await expect(
    page.locator('.browserSheetRow[aria-current="true"] [aria-label="Pinned"]'),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Notebook product/strategy", exact: true })
    .click();
  await expect(page.locator(".browserSheetRow")).toHaveCount(2);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const editor = page.locator(".cm-content");
  await editor.focus();
  await page.keyboard.press("Control+Home");
  for (let line = 0; line < 4; line++) await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("button", { name: "Writing statistics", exact: true }),
  ).toContainText("words");
  await stableFrame(page);
}

for (const theme of ["light", "dark"] as const) {
  test.describe(theme, () => {
    test.beforeEach(async ({ page }) => {
      await page.clock.setFixedTime(new Date("2026-11-17T12:00:00Z"));
      await page.addInitScript((theme) => {
        localStorage.setItem("slate.appearance", theme);
        localStorage.setItem("slate.shortcuts.v2", "seen");
        Object.defineProperty(navigator, "platform", {
          configurable: true,
          value: "Win32",
        });
        Object.defineProperty(navigator.storage, "estimate", {
          configurable: true,
          value: async () => ({ usage: 1_572_864, quota: 1_073_741_824 }),
        });
      }, theme);
    });

    test("A4 snippet picker", async ({ page }) => {
      await writingFixture(page);
      await workspaceAction(page, "Insert snippet");
      await expect(
        page.getByRole("combobox", { name: "Search snippets", exact: true }),
      ).toBeFocused();
      await expect(
        page
          .getByRole("dialog", { name: "Insert snippet", exact: true })
          .getByRole("option"),
      ).toHaveCount(3);
      await stableFrame(page);
      await expect(page).toHaveScreenshot(`a4-snippets-${theme}.png`);
    });

    test("A7 custom block settings", async ({ page }) => {
      await writingFixture(page);
      await workspaceAction(page, "Manage custom blocks");
      const dialog = page.getByRole("dialog", {
        name: "Custom blocks",
        exact: true,
      });
      for (const [name, source] of [
        ["Callout", "> A detail worth remembering.\n"],
        ["Decision", "## Decision\n\n- Context\n- Outcome\n"],
      ]) {
        await dialog
          .getByRole("button", { name: "Add custom block", exact: true })
          .click();
        await dialog
          .getByRole("textbox", { name: "Block name", exact: true })
          .fill(name!);
        await dialog
          .getByRole("textbox", { name: "Block Markdown", exact: true })
          .fill(source!);
        await dialog
          .getByRole("button", { name: "Save block", exact: true })
          .click();
        await expect(
          dialog.getByRole("button", { name: `Edit ${name}.md`, exact: true }),
        ).toBeVisible();
      }
      await expect(dialog.locator("tbody tr")).toHaveCount(2);
      await stableFrame(page);
      await expect(page).toHaveScreenshot(`a7-custom-blocks-${theme}.png`);
    });

    test("A7 snippet settings", async ({ page }) => {
      await writingFixture(page);
      await workspaceAction(page, "Manage snippets");
      const dialog = page.getByRole("dialog", {
        name: "Snippets",
        exact: true,
      });
      await expect(dialog.locator("tbody tr")).toHaveCount(3);
      await stableFrame(page);
      await expect(page).toHaveScreenshot(`a7-snippets-${theme}.png`);
    });

    test("A1 workspace and live Markdown", async ({ page }) => {
      await writingFixture(page);
      await expect(page).toHaveScreenshot(`a1-workspace-${theme}.png`);
    });

    test("A1 selection formatting toolbar", async ({ page }) => {
      await writingFixture(page);
      await page.keyboard.press("Control+Home");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowDown");
      for (let word = 0; word < 3; word++)
        await page.keyboard.press("Control+Shift+ArrowRight");
      await expect(
        page.getByRole("toolbar", {
          name: "Selection formatting",
          exact: true,
        }),
      ).toBeVisible();
      await expect(page).toHaveScreenshot(`a1-selection-${theme}.png`);
    });

    test("A2 slash block menu and preview", async ({ page }) => {
      await writingFixture(page);
      await page.keyboard.press("Control+End");
      await page.keyboard.press("Enter");
      await page.keyboard.press("Enter");
      await page.keyboard.type("/ta");
      const menu = page.getByRole("dialog", {
        name: "Insert block",
        exact: true,
      });
      await expect(menu).toBeVisible();
      await expect(menu.getByRole("option", { selected: true })).toContainText(
        "Table",
      );
      await expect(menu.getByRole("columnheader")).toHaveCount(3);
      await stableFrame(page);
      await expect(page).toHaveScreenshot(`a2-blocks-${theme}.png`);
    });

    test("A3 template gallery and real Markdown preview", async ({ page }) => {
      await writingFixture(page);
      await workspaceAction(page, "New from template");
      const dialog = page.getByRole("dialog", {
        name: "New from template",
        exact: true,
      });
      const title = dialog.getByRole("textbox", { name: "Title", exact: true });
      await expect(title).toBeFocused();
      await title.fill("Design review — editor v2");
      await expect(dialog.getByText("Reading Space templates…")).toHaveCount(0);
      await expect(dialog.locator(".templateCard")).toHaveCount(5);
      await stableFrame(page);
      await expect(page).toHaveScreenshot("a3-templates-" + theme + ".png");
    });

    test("A5 read-only shortcut sheet", async ({ page }) => {
      await writingFixture(page);
      await page
        .getByRole("button", { name: "Keyboard shortcuts", exact: true })
        .click();
      await expect(
        page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("dialog", { name: "Keyboard shortcuts", exact: true })
          .getByText("New from template", { exact: true }),
      ).toBeVisible();
      await expect(
        page
          .locator(".shortcutDialog > header")
          .getByRole("textbox", { name: "Search shortcuts", exact: true }),
      ).toBeVisible();
      await stableFrame(page);
      await expect(page).toHaveScreenshot(`a5-shortcuts-${theme}.png`);
    });

    test("A11 browser first run", async ({ page }) => {
      await page.goto("./");
      await expect(
        page.getByRole("button", { name: "Continue", exact: true }),
      ).toBeEnabled();
      await expect(
        page.getByRole("heading", {
          name: "Where should your writing live?",
          exact: true,
        }),
      ).toBeVisible();
      await stableFrame(page);
      await expect(page).toHaveScreenshot(`a11-first-run-${theme}.png`);
    });
  });
}
