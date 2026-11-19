import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { libraryFile as file } from "./libraryFiles";
import {
  chooseAppearance,
  createSheet,
  expectSavedSheet,
  openLibrary,
  readCurrentSheet,
} from "./helpers";

async function today(page: Page) {
  await expect(page.locator(".workspaceHeader")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Shift+d");
  await expect(page).toHaveURL(/Daily%2F2026-11-18\.md$/);
}
const previous =
  "---\nexample: |\n  - [ ] Metadata example\n---\n# Yesterday\n\n- [ ] **Ship** the review\n  - [x] Finished child\n  - [ ] Remaining child\n- [x] Finished parent\n  - [ ] Follow-up\n\n```md\n- [ ] Code example\n```\n";

test("Today carries genuine unfinished tasks from the latest earlier daily note and focuses its template caret", async ({
  createContext,
}, testInfo) => {
  const context = await createContext({ timezoneId: "Asia/Dhaka" });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date("2026-11-17T21:30:00Z"));
  await openLibrary(page);
  await createSheet(page, "Original sheet.");
  await file(page, "Daily/2026-11-17.md", previous);
  await file(page, "Daily/2026-11-13.md", "- [ ] Older task");
  await file(page, "Daily/2026-11-19.md", "- [ ] Future task");
  await file(page, "Daily/2026-11-31.md", "- [ ] Invalid date");
  await today(page);
  const editor = page.locator(".cm-content");
  await expect(editor).toBeFocused();
  const created = await readCurrentSheet(page);
  expect(created).toContain('title: "2026-11-18"');
  expect(created).toContain("# Wednesday, November 18");
  expect(created).toContain("- [ ] **Ship** the review");
  expect(created).toContain("- [ ] Remaining child");
  expect(created).toContain("- Finished parent");
  expect(created).toContain("- [ ] Follow-up");
  expect(created).not.toMatch(
    /Finished child|Metadata example|Code example|Older task|Future task|Invalid date|template:|\{\{/,
  );
  await page.keyboard.insertText("Focus today.");
  await expectSavedSheet(
    page,
    created.replace("## Focus\n- \n", "## Focus\n- Focus today.\n"),
  );
  const saved = await readCurrentSheet(page);
  await today(page);
  await expectSavedSheet(page, saved);
  expect(await file(page, "Daily/2026-11-17.md")).toEqual(
    Array.from(new TextEncoder().encode(previous)),
  );
  expect(await file(page, "Daily/2026-11-18 (1).md")).toBeUndefined();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await testInfo.attach("daily-note-light", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await chooseAppearance(page, "dark");
  await testInfo.attach("daily-note-dark", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

test("the confirmed Today launch uses the same carry-over and never appends it again on reopening", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date(2026, 10, 18, 12));
  await openLibrary(page);
  await createSheet(page, "Original sheet.");
  await file(page, "Daily/2026-11-17.md", "- [ ] From yesterday");
  await page.goto("./?action=today");
  const dialog = page.getByRole("dialog", {
    name: "Open in Slate",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  expect(await file(page, "Daily/2026-11-18.md")).toBeUndefined();
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/Daily%2F2026-11-18\.md$/);
  const editor = page.locator(".cm-content");
  await expect(editor).toBeFocused();
  const source = await readCurrentSheet(page);
  expect(source).toContain("- [ ] From yesterday");
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText("Words already written today.");
  await expectSavedSheet(page, source + "Words already written today.");
  const saved = await readCurrentSheet(page);
  await page.goto("./?action=today");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/Daily%2F2026-11-18\.md$/);
  await expectSavedSheet(page, saved);
  expect(saved.split("From yesterday")).toHaveLength(2);
});

for (const [name, bytes] of [
  ["empty", []],
  ["unsupported encoding", [0xff, 0xfe, 0xfd]],
] as const) {
  test(`Today opens an existing ${name} file and preserves its exact bytes`, async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date(2026, 10, 18, 12));
    await openLibrary(page);
    await createSheet(page, "Original sheet.");
    await file(page, "Daily/2026-11-17.md", "- [ ] Must not be appended");
    await file(page, "Daily/2026-11-18.md", [...bytes]);
    await today(page);
    if (bytes.length)
      await expect(
        page.getByRole("heading", {
          name: "This file needs UTF-8.",
          exact: true,
        }),
      ).toBeVisible();
    else await expect(page.locator(".cm-content")).toBeVisible();
    expect(await file(page, "Daily/2026-11-18.md")).toEqual([...bytes]);
    expect(await file(page, "Daily/2026-11-18 (1).md")).toBeUndefined();
  });
}

test("an unreadable previous day is reported before creation and can be repaired without losing it", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date(2026, 10, 18, 12));
  await openLibrary(page);
  await createSheet(page, "Original sheet.");
  await file(page, "Daily/2026-11-17.md", [0xff, 0xfe, 0xfd]);
  const url = page.url();
  await page.keyboard.press("ControlOrMeta+Shift+d");
  await expect(page.getByRole("alert")).toContainText("Daily/2026-11-17.md");
  await expect(page.getByRole("alert")).toContainText("choose Today again");
  await expect(page).toHaveURL(url);
  expect(await file(page, "Daily/2026-11-18.md")).toBeUndefined();
  expect(await file(page, "Daily/2026-11-17.md")).toEqual([0xff, 0xfe, 0xfd]);
  await file(page, "Daily/2026-11-17.md", "- [ ] Repaired task");
  await today(page);
  await expect(page.getByRole("alert")).toBeHidden();
  expect(await readCurrentSheet(page)).toContain("- [ ] Repaired task");
});
