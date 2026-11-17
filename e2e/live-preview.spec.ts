import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import { createSheet, openLibrary } from "./helpers";

const modifier = process.platform === "darwin" ? "Meta" : "Control";
const raw =
  "# Heading\n\n**Bold** *Italic* ~~Gone~~ ==Bright== `code`.\n\n[site](https://example.test) [[Missing|new idea]] #work/project\n\n- [ ] Keep words\n- [x] Done words\n\n> Quoted words\n\n---\n\nActive here.";

test("live preview renders basic Markdown, toggles tasks with one undo and preserves source bytes", async ({
  page,
  isMobile,
}) => {
  await openLibrary(page);
  const editor = await createSheet(page, raw);
  await expect(page.locator(".cm-slate-heading-1")).toHaveText("Heading");
  for (const [name, text] of [
    ["strong", "Bold"],
    ["emphasis", "Italic"],
    ["strike", "Gone"],
    ["highlight", "Bright"],
    ["inline-code", "code"],
    ["tag", "#work/project"],
  ])
    await expect(page.locator(`.cm-slate-${name}`)).toHaveText(text!);
  await expect(page.locator(".cm-slate-wiki-link")).toHaveText("new idea");
  await expect(page.locator(".cm-slate-wiki-link")).toHaveClass(
    /cm-slate-unresolved-link/,
  );
  await expect(page.locator(".cm-slate-quote-line")).toHaveText("Quoted words");
  await expect(page.locator('.cm-content [role="separator"]')).toBeVisible();
  const checkbox = page.getByRole("checkbox", {
    name: "Keep words",
    exact: true,
  });
  if (isMobile) {
    const target = await checkbox.boundingBox();
    expect(target!.width).toBeGreaterThanOrEqual(44);
    expect(target!.height).toBeGreaterThanOrEqual(44);
  }
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  await expect(page.locator(".workspaceStatus [role=status]")).toHaveText(
    "Saved",
  );
  const saved = await readCurrent(page);
  expect(saved).toBe(raw.replace("[ ] Keep words", "[x] Keep words"));
  await editor.focus();
  await page.keyboard.press(`${modifier}+z`);
  await expect(checkbox).not.toBeChecked();
  await expect(page.locator(".workspaceStatus [role=status]")).toHaveText(
    "Saved",
  );
  expect(await readCurrent(page)).toBe(raw);
  await page.keyboard.press(`${modifier}+Home`);
  await expect(page.locator(".cm-slate-heading-1")).toHaveText("# Heading");
  await page.keyboard.press(`${modifier}+End`);
  await expect(page.locator(".cm-slate-heading-1")).toHaveText("Heading");
  expect(await readCurrent(page)).toBe(raw);
  await page
    .getByRole("combobox", { name: "Appearance", exact: true })
    .selectOption("dark");
  const results = await new AxeBuilder({ page })
    .include(".browserEditor")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("an unresolved wiki link creates its target once and later follows the existing sheet", async ({
  page,
}) => {
  await openLibrary(page);
  const source = "# Source\n\nSee [[New idea|alias]].\n\nActive.";
  await createSheet(page, source);
  await page.locator(".cm-slate-unresolved-link").click();
  await expect(page.locator(".documentToolbar > span")).toHaveText("New idea");
  await expect(page).toHaveURL(/New%20idea\.md$/);
  await page.getByRole("button", { name: /^Source See/ }).click();
  await expect(page.locator(".cm-slate-wiki-link")).toHaveText("alias");
  await expect(page.locator(".cm-slate-wiki-link")).not.toHaveClass(
    /cm-slate-unresolved-link/,
  );
  expect(await readCurrent(page)).toBe(source);
  await page.locator(".cm-slate-wiki-link").click({ modifiers: [modifier] });
  await expect(page.locator(".documentToolbar > span")).toHaveText("New idea");
  const paths = await page.evaluate(async () => {
    const id = decodeURIComponent(location.hash.split("/")[2]!);
    const root = await navigator.storage.getDirectory();
    const inbox = await (
      await (await root.getDirectoryHandle("spaces")).getDirectoryHandle(id)
    ).getDirectoryHandle("Inbox");
    const names: string[] = [];
    for await (const name of inbox.keys()) names.push(name);
    return names.sort();
  });
  expect(paths).toEqual(["New idea.md", "Untitled.md"]);
});

test("Mod-click follows an external Markdown link without evaluating document HTML", async ({
  page,
  context,
}) => {
  await context.route("https://example.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<title>Destination</title><p>Example destination</p>",
    }),
  );
  await openLibrary(page);
  await createSheet(
    page,
    '[site](https://example.test/)\n\n<img src=x onerror="window.slateUnsafe=true">\n\nActive.',
  );
  await expect(
    page.locator(".cm-content img:not(.cm-widgetBuffer), .cm-content script, .cm-content iframe"),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => Reflect.get(window, "slateUnsafe")),
  ).toBeUndefined();
  const popup = page.waitForEvent("popup");
  await page.locator(".cm-slate-link").click({ modifiers: [modifier] });
  const destination = await popup;
  await expect(destination).toHaveURL("https://example.test/");
  await expect(destination.locator("body")).toContainText(
    "Example destination",
  );
  await destination.close();
});

async function readCurrent(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    const parts = location.hash.split("/");
    const id = decodeURIComponent(parts[2]!);
    const path = decodeURIComponent(parts[4]!).split("/");
    const filename = path.pop()!;
    const root = await navigator.storage.getDirectory();
    let directory = await (
      await root.getDirectoryHandle("spaces")
    ).getDirectoryHandle(id);
    for (const part of path)
      directory = await directory.getDirectoryHandle(part);
    return (await (await directory.getFileHandle(filename)).getFile()).text();
  });
}
