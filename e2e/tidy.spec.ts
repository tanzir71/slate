import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import {
  createSheet,
  expectSavedSheet,
  openLibrary,
  readCurrentSheet,
  showSheets,
  workspaceAction,
} from "./helpers";
import { libraryFile, libraryPaths } from "./libraryFiles";

const dirty = "  #   Draft\n\n+ _One_\n+ __Two__\n";
const clean = "# Draft\n\n- *One*\n- **Two**\n";
const panel = (page: import("@playwright/test").Page) =>
  page.getByRole("complementary", { name: "Tidy review", exact: true });

test("Tidy is searchable in shortcuts and the palette opens review without editing the note", async ({
  page,
}) => {
  await openLibrary(page);
  const editor = await createSheet(page, dirty);
  await workspaceAction(page, "Keyboard shortcuts");
  const shortcuts = page.getByRole("dialog", {
    name: "Keyboard shortcuts",
    exact: true,
  });
  await shortcuts
    .getByRole("textbox", { name: "Search shortcuts", exact: true })
    .fill("tidy");
  const row = shortcuts.locator(".shortcutRow");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Tidy document");
  await expect(row.locator("kbd")).toHaveText(/(?:Alt|⌥).*?(?:Shift|⇧).*F/);
  await page.keyboard.press("Escape");
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog", {
    name: "Command palette",
    exact: true,
  });
  await palette
    .getByRole("textbox", { name: "Search commands", exact: true })
    .fill("tidy");
  await palette.getByRole("button", { name: /Tidy document/ }).click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).locator(".tidyApplyAll")).toBeEnabled();
  expect(await readCurrentSheet(page)).toBe(dirty);
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
  await expect(editor).toBeFocused();
  expect(await readCurrentSheet(page)).toBe(dirty);
});
async function refresh(page: import("@playwright/test").Page) {
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}

type FixGate = {
  hold: boolean;
  waiting: boolean;
  replied: boolean;
  release?: () => void;
};
async function installFixGate(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    const gate: FixGate = { hold: false, waiting: false, replied: false };
    Object.assign(window, { slateTidyFixGate: gate });
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (!String(url).includes("tidy.worker")) return;
        const post = this.postMessage.bind(this);
        this.addEventListener("message", (event: MessageEvent<unknown>) => {
          if (
            typeof event.data === "object" &&
            event.data !== null &&
            "kind" in event.data &&
            event.data.kind === "fix"
          )
            gate.replied = true;
        });
        this.postMessage = (message: unknown) => {
          if (
            gate.hold &&
            typeof message === "object" &&
            message !== null &&
            "kind" in message &&
            message.kind === "fix"
          ) {
            gate.waiting = true;
            gate.release = () => {
              gate.hold = false;
              post(message);
            };
          } else post(message);
        };
      }
    };
  });
}
async function holdFix(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    (window as Window & { slateTidyFixGate: FixGate }).slateTidyFixGate.hold =
      true;
  });
  await panel(page).locator(".tidyApplyAll").click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { slateTidyFixGate: FixGate }).slateTidyFixGate
            .waiting,
      ),
    )
    .toBe(true);
}
async function releaseFix(page: import("@playwright/test").Page) {
  await page.evaluate(() =>
    (
      window as Window & { slateTidyFixGate: FixGate }
    ).slateTidyFixGate.release?.(),
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { slateTidyFixGate: FixGate }).slateTidyFixGate
            .replied,
      ),
    )
    .toBe(true);
}

test("real-worker review keeps Diff inert, applies selected/all fixes, and restores source with one undo", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors: string[] = [],
    workers: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("worker", (worker) => workers.push(worker.url()));
  await openLibrary(page);
  const editor = await createSheet(page, dirty);
  await page.keyboard.press("Alt+Shift+f");
  const review = panel(page);
  await expect(review).toBeVisible();
  await expect(review.locator(".tidyApplyAll")).toBeEnabled({
    timeout: 15_000,
  });
  expect(workers.some((url) => /tidy\.worker/.test(url))).toBe(true);
  const assetGeometry = await review.locator(".tidyIcon").evaluateAll((icons) =>
    icons.map((icon) => ({
      width: icon.getBoundingClientRect().width,
      height: icon.getBoundingClientRect().height,
      mask: getComputedStyle(icon).maskImage,
    })),
  );
  expect(assetGeometry).toHaveLength(5);
  for (const icon of assetGeometry) {
    expect(icon.width).toBe(16);
    expect(icon.height).toBe(16);
    expect(icon.mask).not.toBe("none");
    expect(icon.mask).not.toContain("figma.com");
  }
  expect(
    await review.locator(".tidyToggle").evaluate((toggle) => ({
      image: getComputedStyle(toggle).backgroundImage !== "none",
      size: getComputedStyle(toggle).backgroundSize,
    })),
  ).toEqual({ image: true, size: "28px 17px" });
  await review.locator(".tidyApplyAll").hover();
  expect(
    (await new AxeBuilder({ page }).include(".tidyPanel").analyze()).violations,
  ).toEqual([]);
  await expect(page.locator(".tidySourceEditor")).toBeVisible();
  const sourceStyle = await page
    .locator(".tidySourceEditor .cm-content")
    .evaluate((element) => ({
      family: getComputedStyle(element).fontFamily,
      size: getComputedStyle(element).fontSize,
      line: getComputedStyle(element).lineHeight,
      color: getComputedStyle(element).color,
    }));
  expect(sourceStyle.family).toContain("Geist Mono");
  expect(sourceStyle.size).toBe("14px");
  expect(sourceStyle.line).toBe("26px");
  expect(
    await page
      .locator(".tidySourceEditor .cm-line span")
      .evaluateAll((spans) => [
        ...new Set(spans.map((span) => getComputedStyle(span).color)),
      ]),
  ).toEqual([sourceStyle.color]);
  await expect(page.locator(".cm-tidy-line").first()).toBeVisible();
  await expect(
    review.getByRole("switch", { name: "Tidy on save" }),
  ).not.toBeChecked();
  expect(await libraryFile(page, ".slate/tidy.json")).toBeUndefined();
  await review.getByRole("button", { name: "Diff", exact: true }).click();
  const diff = page.getByRole("dialog", { name: "Tidy diff", exact: true });
  await expect(diff).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).include(".tidyDiffDialog").analyze())
      .violations,
  ).toEqual([]);
  expect(await diff.locator("pre").nth(0).textContent()).toBe(dirty);
  expect(await diff.locator("pre").nth(1).textContent()).toBe(clean);
  expect(await readCurrentSheet(page)).toBe(dirty);
  await diff
    .getByRole("button", { name: "Close Tidy diff", exact: true })
    .click();
  const heading = review
    .locator(".tidyFix")
    .filter({ has: page.getByText("heading-space", { exact: true }) });
  await heading.getByRole("button", { name: "Apply", exact: true }).click();
  await expectSavedSheet(page, dirty.replace("#   Draft", "# Draft"));
  await editor.press("ControlOrMeta+z");
  await expectSavedSheet(page, dirty);
  await expect(review.locator(".tidyApplyAll")).toBeEnabled();
  await review.locator(".tidyApplyAll").click();
  await expectSavedSheet(page, clean);
  await editor.press("ControlOrMeta+z");
  await expectSavedSheet(page, dirty);
  const toggle = review.getByRole("switch", { name: "Tidy on save" });
  const offImage = await toggle.evaluate(
    (element) => getComputedStyle(element).backgroundImage,
  );
  await toggle.click();
  await expect(toggle).toBeChecked();
  expect(
    await toggle.evaluate(
      (element) => getComputedStyle(element).backgroundImage,
    ),
  ).not.toBe(offImage);
  expect(
    await toggle.evaluate(
      (element) => getComputedStyle(element).backgroundSize,
    ),
  ).toBe("28px 17px");
  expect(await readCurrentSheet(page)).toBe(dirty);
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  expect(await readCurrentSheet(page)).toBe(dirty);
  await review.getByRole("button", { name: "Close Tidy", exact: true }).click();
  await expect(page.locator(".tidySourceEditor")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a settings draft retains its opening bytes when an external refresh replaces the canonical JSON", async ({
  page,
}) => {
  await openLibrary(page);
  await createSheet(page, dirty);
  const original = '{"version":1,"preset":"slate","future":9007199254740993}';
  const external = '{"version":1,"preset":"github","future":9007199254740999}';
  const proposed = original.replace('"slate"', '"minimal"');
  await libraryFile(page, ".slate/tidy.json", original);
  await refresh(page);
  await page.getByRole("button", { name: "Tidy review", exact: true }).click();
  const review = panel(page);
  await expect(review.locator(".tidyApplyAll")).toBeEnabled({
    timeout: 15_000,
  });
  await review
    .getByRole("button", { name: "Edit rules JSON", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Tidy settings",
    exact: true,
  });
  const input = dialog.getByRole("textbox", {
    name: "Tidy settings JSON",
    exact: true,
  });
  await expect(input).toHaveValue(original);
  await input.fill(proposed);
  await libraryFile(page, ".slate/tidy.json", external);
  await refresh(page);
  await expect(
    review.locator('select[aria-label="Tidy rules preset"]'),
  ).toHaveValue("github");
  await dialog.getByRole("button", { name: "Save rules", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Settings changed outside Slate",
  );
  const decode = (bytes: number[] | undefined) =>
    bytes && new TextDecoder().decode(new Uint8Array(bytes));
  expect(decode(await libraryFile(page, ".slate/tidy.json"))).toBe(external);
  const conflicted = (await libraryPaths(page, true)).find((path) =>
    /^\.slate\/tidy \(conflicted copy .+\)\.json$/.test(path),
  );
  expect(conflicted).toBeDefined();
  expect(decode(await libraryFile(page, conflicted!))).toBe(proposed);
  await expect(input).toHaveValue(proposed);
});

test("an imported CRLF note preserves exact line endings through Tidy, Undo and reload", async ({
  page,
}) => {
  await openLibrary(page);
  const source = dirty.replaceAll("\n", "\r\n"),
    expected = clean.replaceAll("\n", "\r\n");
  await page.getByLabel("Import files", { exact: true }).setInputFiles({
    name: "CRLF.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(source),
  });
  await showSheets(page);
  await page.locator('.browserSheetRow[data-path="CRLF.md"]').click();
  await expect(page).toHaveURL(/CRLF\.md$/);
  expect(await readCurrentSheet(page)).toBe(source);
  await page.getByRole("button", { name: "Tidy review", exact: true }).click();
  const review = panel(page);
  await expect(review.locator(".tidyApplyAll")).toBeEnabled({
    timeout: 15_000,
  });
  await review.locator(".tidyApplyAll").click();
  await expectSavedSheet(page, expected);
  await page.locator(".cm-content").press("ControlOrMeta+z");
  await expectSavedSheet(page, source);
  await page.reload();
  await expect(page.locator(".cm-content")).toBeVisible();
  expect(await readCurrentSheet(page)).toBe(source);
});

test("an imported UTF-8 BOM survives Tidy and one-step Undo byte-for-byte", async ({
  page,
}) => {
  await openLibrary(page);
  const source = "\uFEFF" + dirty.replaceAll("\n", "\r\n");
  const expected = "\uFEFF" + clean.replaceAll("\n", "\r\n");
  await page.getByLabel("Import files", { exact: true }).setInputFiles({
    name: "BOM.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(source),
  });
  await showSheets(page);
  await page.locator('.browserSheetRow[data-path="BOM.md"]').click();
  await expect(page).toHaveURL(/BOM\.md$/);
  const raw = async (target: import("@playwright/test").Page) =>
    new TextDecoder("utf-8", { ignoreBOM: true }).decode(
      new Uint8Array((await libraryFile(target, "BOM.md"))!),
    );
  expect(await raw(page)).toBe(source);
  await page.getByRole("button", { name: "Tidy review", exact: true }).click();
  const review = panel(page);
  await expect(review.locator(".tidyApplyAll")).toBeEnabled({
    timeout: 15_000,
  });
  await review.locator(".tidyApplyAll").click();
  await expectSavedSheet(page, expected, raw);
  await page.locator(".cm-content").press("ControlOrMeta+z");
  await expectSavedSheet(page, source, raw);
});

test("ignoring one rule persists through reload without editing the note or rounding unknown settings", async ({
  page,
}) => {
  await openLibrary(page);
  await createSheet(page, dirty);
  const original = '\uFEFF{\r\n "version":1,"future":9007199254740993\r\n}\r\n';
  await libraryFile(page, ".slate/tidy.json", original);
  await refresh(page);
  await page.getByRole("button", { name: "Tidy review", exact: true }).click();
  const review = panel(page);
  const heading = review
    .locator(".tidyFix")
    .filter({ has: page.getByText("heading-space", { exact: true }) });
  await expect(heading).toBeVisible({ timeout: 15_000 });
  await heading.getByRole("button", { name: "Ignore", exact: true }).click();
  await expect(heading).toHaveCount(0);
  const raw = new TextDecoder("utf-8", { ignoreBOM: true }).decode(
    new Uint8Array((await libraryFile(page, ".slate/tidy.json"))!),
  );
  expect(raw.startsWith("\uFEFF")).toBe(true);
  expect(raw).toContain('"future":9007199254740993');
  expect(JSON.parse(raw.slice(1))).toMatchObject({
    rules: { "heading-space": false },
  });
  expect(await readCurrentSheet(page)).toBe(dirty);
  await page.reload();
  await expect(page.locator(".cm-content")).toBeVisible();
  await page.getByRole("button", { name: "Tidy review", exact: true }).click();
  await expect(review.locator(".tidyApplyAll")).toBeEnabled({
    timeout: 15_000,
  });
  await expect(heading).toHaveCount(0);
  await review.locator(".tidyApplyAll").click();
  await expectSavedSheet(page, clean.replace("# Draft", "#   Draft"));
});

test("malformed settings stay visible and require explicit JSON repair before any fix can apply", async ({
  page,
}) => {
  await openLibrary(page);
  await createSheet(page, dirty);
  await libraryFile(page, ".slate/tidy.json", "{broken");
  await refresh(page);
  await page.getByRole("button", { name: "Tidy review", exact: true }).click();
  const review = panel(page);
  await expect(review.getByRole("alert")).toBeVisible();
  await expect(review.locator(".tidyApplyAll")).toBeDisabled();
  expect(await readCurrentSheet(page)).toBe(dirty);
  await review
    .getByRole("button", { name: "Edit rules JSON", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Tidy settings",
    exact: true,
  });
  const input = dialog.getByRole("textbox", {
    name: "Tidy settings JSON",
    exact: true,
  });
  await expect(input).toHaveValue("{broken");
  const repaired = '{"version":1,"preset":"minimal"}\n';
  await input.fill(repaired);
  await dialog.getByRole("button", { name: "Save rules", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(
    review.getByRole("combobox", { name: "Tidy rules preset" }),
  ).toHaveValue("minimal");
  expect(
    new TextDecoder().decode(
      new Uint8Array((await libraryFile(page, ".slate/tidy.json"))!),
    ),
  ).toBe(repaired);
  expect(await readCurrentSheet(page)).toBe(dirty);
});

test("unsupported settings bytes remain untouched and cannot be saved over in the repair dialog", async ({
  page,
}) => {
  await openLibrary(page);
  await createSheet(page, dirty);
  const bytes = [0xff, 0xfe, 0];
  await libraryFile(page, ".slate/tidy.json", bytes);
  await refresh(page);
  await page.getByRole("button", { name: "Tidy review", exact: true }).click();
  const review = panel(page);
  await expect(review.getByRole("alert")).toContainText("not valid UTF-8");
  await expect(review.locator(".tidyApplyAll")).toBeDisabled();
  await review
    .getByRole("button", { name: "Edit rules JSON", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Tidy settings",
    exact: true,
  });
  await expect(
    dialog.getByRole("textbox", { name: "Tidy settings JSON", exact: true }),
  ).toHaveAttribute("readonly", "");
  await expect(
    dialog.getByRole("button", { name: "Save rules", exact: true }),
  ).toBeDisabled();
  expect(await libraryFile(page, ".slate/tidy.json")).toEqual(bytes);
  expect(await readCurrentSheet(page)).toBe(dirty);
});

test("a delayed fix cannot apply after another tab takes write ownership", async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);
  await installFixGate(page);
  await openLibrary(page);
  await createSheet(page, dirty);
  await page.getByRole("button", { name: "Tidy review", exact: true }).click();
  const review = panel(page);
  await expect(review.locator(".tidyApplyAll")).toBeEnabled({
    timeout: 15_000,
  });
  await holdFix(page);
  const other = await context.newPage();
  await other.goto(page.url());
  await other.getByRole("button", { name: "Use here", exact: true }).click();
  await expect(page.locator(".cm-content")).toHaveAttribute(
    "contenteditable",
    "false",
  );
  await page.bringToFront();
  await releaseFix(page);
  await expect(review.getByRole("alert")).toContainText("read-only");
  expect(await readCurrentSheet(page)).toBe(dirty);
  expect(
    (await page.locator(".cm-content .cm-line").allTextContents()).join("\n"),
  ).toBe(dirty);
});

test("typing while a fix is delayed keeps the newer source and discards the old proposal", async ({
  page,
}) => {
  await installFixGate(page);
  await openLibrary(page);
  const editor = await createSheet(page, dirty);
  await page.getByRole("button", { name: "Tidy review", exact: true }).click();
  await expect(panel(page).locator(".tidyApplyAll")).toBeEnabled({
    timeout: 15_000,
  });
  await holdFix(page);
  await panel(page)
    .getByRole("button", { name: "Close Tidy", exact: true })
    .click();
  await editor.press("ControlOrMeta+End");
  await page.keyboard.insertText("Newer words.");
  await expectSavedSheet(page, dirty + "Newer words.");
  await releaseFix(page);
  await page.getByRole("button", { name: "Tidy review", exact: true }).click();
  await expect(panel(page).locator(".tidyApplyAll")).toBeEnabled();
  expect(await readCurrentSheet(page)).toBe(dirty + "Newer words.");
});

test("switching to another sheet with identical text discards a delayed proposal for the old path", async ({
  page,
}) => {
  await installFixGate(page);
  await openLibrary(page);
  await createSheet(page, dirty);
  const firstURL = page.url();
  const firstPath = decodeURIComponent(new URL(firstURL).hash.split("/")[4]!);
  await createSheet(page, dirty);
  const secondPath = decodeURIComponent(
    new URL(page.url()).hash.split("/")[4]!,
  );
  expect(secondPath).not.toBe(firstPath);
  await page.getByRole("button", { name: "Tidy review", exact: true }).click();
  await expect(panel(page).locator(".tidyApplyAll")).toBeEnabled({
    timeout: 15_000,
  });
  await holdFix(page);
  await panel(page)
    .getByRole("button", { name: "Close Tidy", exact: true })
    .click();
  await showSheets(page);
  await page
    .locator(`.browserSheetRow[data-path=${JSON.stringify(firstPath)}]`)
    .click();
  await expect(page).toHaveURL(firstURL);
  await releaseFix(page);
  await page.getByRole("button", { name: "Tidy review", exact: true }).click();
  await expect(panel(page).locator(".tidyApplyAll")).toBeEnabled();
  expect(await readCurrentSheet(page)).toBe(dirty);
  for (const path of [firstPath, secondPath])
    expect(
      new TextDecoder().decode(
        new Uint8Array((await libraryFile(page, path))!),
      ),
    ).toBe(dirty);
});
