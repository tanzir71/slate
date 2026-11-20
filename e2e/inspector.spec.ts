import { expect, test } from "./fixtures";
import { chooseAppearance, openLibrary, workspaceAction } from "./helpers";
import { libraryFile } from "./libraryFiles";
import type { Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";

const source = "\uFEFF---\r\ntitle: Outline golden\n---\r\n\r\n## Alpha\r\nA\n\n### Child\nC\r\n\r\n## Beta\nB\r\n";
const moved = "\uFEFF---\r\ntitle: Outline golden\n---\r\n\r\n## Beta\nB\r\n\r\n## Alpha\r\nA\n\n### Child\nC\r\n";
const incoming = "# Incoming\n\n`[[outline.md|Outline golden]]` is a literal example.\n\nSee [[outline.md|Outline golden]] for scope.\n\nReturn to [[outline.md|Outline golden]] later.\n";
const unlinked = "\uFEFF# Mentions\r\n\r\nOUTLINE GOLDEN\n\nOutline golden\r\n\r\n`Outline golden`\n\n[[outline.md|Outline golden]]\r\n";
const linked = "\uFEFF# Mentions\r\n\r\n[[outline.md|OUTLINE GOLDEN]]\n\n[[outline.md|Outline golden]]\r\n\r\n`Outline golden`\n\n[[outline.md|Outline golden]]\r\n";
const inspector = (page: Page) => page.getByRole("complementary", { name: "Inspector", exact: true });
const heading = (page: Page, label: string) => inspector(page).getByRole("button", { name: new RegExp(`^Jump to ${label} \\(H[1-6]\\)$`) });

async function bytes(page: Page, path: string, text: string) {
  await expect(async () => expect(await libraryFile(page, path)).toEqual(Array.from(Buffer.from(text)))).toPass({ timeout: 5_000 });
}
async function seed(page: Page, split = false, mentions = false, initial = { raw: source, heading: "Beta" }) {
  await openLibrary(page);
  await page.getByLabel("Import files", { exact: true }).setInputFiles([
    { name: "outline.md", mimeType: "text/markdown", buffer: Buffer.from(initial.raw) },
    { name: "incoming.md", mimeType: "text/markdown", buffer: Buffer.from(incoming) },
    ...mentions ? [{ name: "mentions.md", mimeType: "text/markdown", buffer: Buffer.from(unlinked) }] : [],
  ]);
  await expect(page.locator(".sheetRowContainer strong").filter({ hasText: /^Outline golden$/ })).toHaveCount(1);
  await page.keyboard.press("ControlOrMeta+p"); const quick = page.getByRole("dialog", { name: "Quick open", exact: true });
  await quick.locator("input").fill("outline.md"); await quick.getByRole("button").filter({ hasText: "outline.md" }).click();
  await expect(quick).toBeHidden();
  if (split) await page.getByRole("button", { name: "Split editor", exact: true }).click();
  await workspaceAction(page, "Toggle inspector");
  await expect(heading(page, initial.heading).first()).toBeVisible(); await bytes(page, "outline.md", initial.raw);
}

test("the physical Inspector chord preserves editable text and keyboard moves follow duplicate headings", async ({ page }) => {
  const prefix = "\uFEFF---\ntitle: Outline golden\n---\n\n";
  const initial = prefix + "## Repeated\nFirst body.\n\n## Repeated\nSecond body.\n", reordered = prefix + "## Repeated\nSecond body.\n\n## Repeated\nFirst body.\n";
  await seed(page, false, false, { raw: initial, heading: "Repeated" });
  const editor = page.getByRole("region", { name: "Primary editor", exact: true }).locator(".cm-content");
  // Lowercase key + physical KeyI covers the Caps Lock case as well as normal uppercase input.
  await editor.press("ControlOrMeta+Shift+i"); await expect(inspector(page)).toHaveCount(0); await bytes(page, "outline.md", initial);
  await editor.press("ControlOrMeta+Shift+i"); await expect(heading(page, "Repeated")).toHaveCount(2);
  await heading(page, "Repeated").first().press("Alt+ArrowDown"); await bytes(page, "outline.md", reordered); await expect(heading(page, "Repeated").last()).toBeFocused();
  await heading(page, "Repeated").last().press("Alt+ArrowUp"); await bytes(page, "outline.md", initial); await expect(heading(page, "Repeated").first()).toBeFocused();
  await inspector(page).getByRole("button", { name: "Close inspector", exact: true }).click();
  await editor.press("ControlOrMeta+z"); await bytes(page, "outline.md", reordered); await editor.press("ControlOrMeta+z"); await bytes(page, "outline.md", initial);
});

test("outline drag moves a complete raw section, synchronizes a split and restores exact bytes with one Undo", async ({ page }) => {
  await seed(page, true);
  const secondary = page.getByRole("region", { name: "Secondary editor", exact: true }).locator(".cm-content");
  await expect(secondary).toContainText("Child");
  await heading(page, "Beta").dragTo(heading(page, "Alpha")); await bytes(page, "outline.md", moved);
  await inspector(page).getByRole("button", { name: "Close inspector", exact: true }).click();
  for (const name of ["Primary editor", "Secondary editor"]) await expect(page.getByRole("region", { name, exact: true }).locator(".cm-content")).toContainText(/Beta[\s\S]*Alpha[\s\S]*Child/);
  await secondary.press("ControlOrMeta+z"); await bytes(page, "outline.md", source);
  await secondary.press("ControlOrMeta+Shift+z"); await bytes(page, "outline.md", moved);
  await bytes(page, "incoming.md", incoming);
});

test("outline parent drag carries every child to the end without shifting the backlink controls", async ({ page }) => {
  await seed(page);
  const backlinks = inspector(page).getByRole("heading", { name: "Backlinks · 2", exact: true });
  const initial = (await backlinks.boundingBox())!.y;
  await heading(page, "Alpha").hover(); const parent = (await heading(page, "Alpha").boundingBox())!, last = (await heading(page, "Beta").boundingBox())!;
  await page.mouse.move(parent.x + parent.width / 2, parent.y + parent.height / 2); await page.mouse.down();
  await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2, { steps: 8 });
  const end = inspector(page).getByLabel("End of outline", { exact: true }); await expect(end).toBeVisible();
  expect((await backlinks.boundingBox())!.y).toBe(initial);
  const destination = (await end.boundingBox())!;
  await page.mouse.move(destination.x + destination.width / 2, destination.y + destination.height / 2, { steps: 8 });
  // Native dragover needs a second move at the destination across browser engines:
  // https://playwright.dev/docs/input#dragging-manually
  await page.mouse.move(destination.x + destination.width / 2, destination.y + destination.height / 2); await page.mouse.up();
  await bytes(page, "outline.md", moved);
  await page.getByRole("region", { name: "Primary editor", exact: true }).locator(".cm-content").press("ControlOrMeta+z");
  await bytes(page, "outline.md", source);
});

test("outline touch grip moves a whole parent section and cancellation preserves its exact bytes", async ({ page, context, isMobile }) => {
  test.skip(!isMobile, "Trusted touch input uses the mobile Chromium profile.");
  await seed(page);
  const cdp = await context.newCDPSession(page);
  async function touchParent(label: string, cancel: boolean) {
    const row = (await heading(page, label).boundingBox())!, last = (await inspector(page).locator(".inspectorHeading").last().boundingBox())!;
    const start = { x: row.x + 34, y: row.y + row.height / 2 }, end = last.y + last.height + 4;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
    for (let step = 1; step <= 12; step++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start.x, y: start.y + (end - start.y) * step / 12 }] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: cancel ? "touchCancel" : "touchEnd", touchPoints: [] });
  }
  await touchParent("Alpha", false); await bytes(page, "outline.md", moved);
  await touchParent("Beta", true); await bytes(page, "outline.md", moved);
  await expect(inspector(page).locator('[data-dragging="true"]')).toHaveCount(0);
  await cdp.detach(); await inspector(page).getByRole("button", { name: "Close inspector", exact: true }).click();
  await page.getByRole("region", { name: "Primary editor", exact: true }).locator(".cm-content").press("ControlOrMeta+z"); await bytes(page, "outline.md", source);
});

test("unlinked mentions add canonical links only to prose and retain exact-byte Undo after closing the Inspector", async ({ page }) => {
  await seed(page, false, true);
  await expect(inspector(page).getByRole("button", { name: "Unlinked mentions · 2", exact: true })).toBeVisible();
  await inspector(page).getByRole("button", { name: "Link all", exact: true }).click(); await bytes(page, "mentions.md", linked);
  await bytes(page, "outline.md", source); await bytes(page, "incoming.md", incoming);
  await inspector(page).getByRole("button", { name: "Close inspector", exact: true }).click();
  await workspaceAction(page, "Toggle inspector");
  await expect(inspector(page).getByRole("button", { name: "Unlinked mentions · 0", exact: true })).toBeVisible();
  await inspector(page).getByRole("button", { name: "Undo linking", exact: true }).click(); await bytes(page, "mentions.md", unlinked);
  await expect(inspector(page).getByRole("button", { name: "Unlinked mentions · 2", exact: true })).toBeVisible();
});

test("outline keyboard movement carries children, jumping selects the heading, and backlinks open the source file", async ({ page }) => {
  await seed(page); await heading(page, "Beta").press("Alt+ArrowUp"); await bytes(page, "outline.md", moved);
  await expect(heading(page, "Beta")).toBeFocused();
  await heading(page, "Child").click(); await expect(heading(page, "Child")).toHaveAttribute("aria-current", "location");
  const editor = page.getByRole("region", { name: "Primary editor", exact: true }).locator(".cm-content"); await expect(editor).toBeFocused();
  await inspector(page).getByRole("button", { name: "Info", exact: true }).click(); await expect(inspector(page).getByText("UTF-8 bytes", { exact: true })).toBeVisible();
  await inspector(page).getByRole("button", { name: /^Incoming/ }).click(); await expect(page).toHaveURL(/\/sheet\/incoming\.md$/);
  await expect(editor).toContainText("for scope."); await bytes(page, "outline.md", moved); await bytes(page, "incoming.md", incoming);
});

test("Inspector shows semantic backlink counts and accessible light/dark controls with actual icon and touch geometry", async ({ page, isMobile }, testInfo) => {
  await seed(page, false, true);
  await expect(inspector(page).getByRole("heading", { name: "Backlinks · 3", exact: true })).toBeVisible();
  await expect(inspector(page).locator(".inspectorBacklink")).toHaveCount(2);
  await expect(inspector(page).getByRole("button", { name: /^Incoming/ }).locator(".inspectorSnippet")).toHaveText("See Outline golden for scope.");
  await expect(inspector(page).getByRole("button", { name: "Links · 3", exact: true })).toHaveAttribute("title", "3 incoming links from 2 sheets");
  for (const theme of ["light", "dark"] as const) {
    await chooseAppearance(page, theme);
    const controls = await inspector(page).locator("button").evaluateAll(buttons => buttons.map(button => {
      const box = button.getBoundingClientRect();
      return { name: button.getAttribute("aria-label") ?? button.textContent, width: box.width, height: box.height };
    }));
    await testInfo.attach(`${theme}-inspector-controls`, { body: JSON.stringify(controls, null, 2), contentType: "application/json" });
    if (isMobile) for (const control of controls) { expect(control.width, control.name ?? "button").toBeGreaterThanOrEqual(44); expect(control.height, control.name ?? "button").toBeGreaterThanOrEqual(44); }
    if (!isMobile) expect((await inspector(page).boundingBox())!.width).toBe(300);
    await heading(page, "Alpha").hover();
    for (const selector of [".inspectorGlyph--close", ".inspectorGlyph--link", ".inspectorHeading:nth-of-type(1) .inspectorGlyph--grip"]) {
      const icon = inspector(page).locator(selector).first();
      if (selector.includes("grip")) await heading(page, "Alpha").focus();
      // Check a displayed grip rather than a hidden neighboring row.
      const displayed = selector.includes("grip") ? heading(page, "Alpha").locator(".inspectorGlyph--grip") : icon;
      const box = await displayed.boundingBox(); expect(box?.width, selector).toBe(16); expect(box?.height, selector).toBe(16);
      expect(await displayed.evaluate(element => getComputedStyle(element).maskImage)).not.toBe("none");
    }
    const accessibility = await new AxeBuilder({ page }).include(".browserInspector").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(accessibility.violations).toEqual([]);
    await testInfo.attach(`${theme}-inspector`, { body: await inspector(page).screenshot(), contentType: "image/png" });
  }
});
