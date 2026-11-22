import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { nativeFixture } from "./nativeFixture";
import { workspaceAction } from "../helpers";
import { editorSource } from "../editorSource";
const manifest = JSON.parse(
  readFileSync(
    new URL(
      "../../packages/ui/src/assets/shortcuts/manifest.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { entries: { file: string; sha256: string }[] };
const source =
  '\ufeff{\r\n  "version":1,\r\n  "bindings":{},\r\n  "note":"keep"\r\n}\r\n';
test.use({ viewport: { width: 1440, height: 900 } });

test("waits for Space shortcuts before exposing an editable sheet", async ({
  page,
}) => {
  await nativeFixture(page, {
    "note.md": "words",
    ".slate/keymap.json": '{"version":1,"bindings":{"format.bold":"Mod+j"}}',
  });
  await page.addInitScript(() =>
    localStorage.setItem("native-hold-keymap-read", "true"),
  );
  await page.goto("./");
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("native-keymap-read-waiting")),
    )
    .toBe("true");
  await expect(
    page.getByRole("status").filter({ hasText: "Loading shortcuts…" }),
  ).toBeVisible();
  await expect(page.locator(".cm-content")).toHaveCount(0);
  await page.evaluate(() => localStorage.removeItem("native-hold-keymap-read"));
  const editor = page.locator(".cm-content");
  await expect(editor).toBeVisible();
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+j");
  await expect.poll(() => editorSource(editor)).toBe("**words**");
});

test("native rebinding retains configuration BOM and CRLF, updates the editor and preserves all four original assets", async ({
  page,
}) => {
  await nativeFixture(page, {
    "note.md": "words",
    ".slate/keymap.json": source,
  });
  await page.goto("./");
  await expect(page.locator(".cm-content")).toBeVisible();
  await workspaceAction(page, "Keyboard shortcuts");
  const sheet = page.getByRole("dialog", {
    name: "Keyboard shortcuts",
    exact: true,
  });
  await page.evaluate(() => document.fonts.ready);
  expect((await sheet.boundingBox())?.height).toBe(720);
  const slots = await sheet
    .locator("[data-shortcut-asset]")
    .evaluateAll((elements) =>
      elements.map((element) => {
        const box = element.getBoundingClientRect();
        return {
          name: element.getAttribute("data-shortcut-asset")!,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          mask: getComputedStyle(element).maskImage,
        };
      }),
    );
  expect(slots.map((slot) => slot.name).sort()).toEqual([
    "close",
    "keyboard",
    "print",
    "search",
  ]);
  const targets: Record<string, { x: number; y: number }> = {
    keyboard: { x: 185, y: 112.5 },
    search: { x: 873, y: 112.5 },
    close: { x: 1245, y: 112.5 },
    print: { x: 1126, y: 775 },
  };
  for (const slot of slots)
    for (const key of ["x", "y"] as const)
      expect(
        Math.abs(slot[key] - targets[slot.name]![key]),
      ).toBeLessThanOrEqual(1 / 64);
  await page.evaluate(() => {
    window.print = () => {
      Reflect.set(window, "__printedShortcuts", true);
    };
  });
  await sheet
    .getByRole("button", { name: "Print cheat sheet", exact: true })
    .click();
  expect(
    await page.evaluate(() => Reflect.get(window, "__printedShortcuts")),
  ).toBe(true);
  for (const slot of slots) {
    expect([slot.width, slot.height]).toEqual([16, 16]);
    const url = slot.mask.match(/^url\(["']?(.*?)["']?\)$/)?.[1];
    expect(url).toBeDefined();
    const response = await page.request.get(url!);
    expect(response.ok()).toBe(true);
    const expected = manifest.entries.find(
      (entry) => entry.file === `${slot.name}.svg`,
    )!;
    expect(
      createHash("sha256")
        .update(await response.body())
        .digest("hex"),
    ).toBe(expected.sha256);
  }
  await sheet.getByRole("button", { name: "Customize", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Customize shortcuts",
    exact: true,
  });
  await dialog
    .getByRole("textbox", { name: "Shortcut for Bold", exact: true })
    .fill("Mod+j");
  await dialog
    .getByRole("button", { name: "Save shortcuts", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await expect(sheet).toBeVisible();
  const bytes = await page.evaluate(
    () =>
      JSON.parse(
        localStorage.getItem("native-file:space:.slate/keymap.json")!,
      ) as number[],
  );
  expect(bytes.slice(0, 3)).toEqual([239, 187, 191]);
  const saved = new TextDecoder("utf-8", { ignoreBOM: true }).decode(
    new Uint8Array(bytes),
  );
  expect(saved.replaceAll("\r\n", "")).not.toContain("\n");
  expect(JSON.parse(saved.slice(1))).toEqual({
    version: 1,
    bindings: { "format.bold": "Mod+j" },
    note: "keep",
  });
  await page.keyboard.press("Escape");
  const editor = page.locator(".cm-content");
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+j");
  await expect.poll(() => editorSource(editor)).toBe("**words**");
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => editorSource(editor)).toBe("words");
});

test("invalid native keymap can be repaired explicitly without changing note bytes", async ({
  page,
}) => {
  await nativeFixture(page, {
    "note.md": "words",
    ".slate/keymap.json": "{bad",
  });
  await page.goto("./");
  await expect(page.locator(".cm-content")).toBeVisible();
  await workspaceAction(page, "Keyboard shortcuts");
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Customize shortcuts",
    exact: true,
  });
  await expect(
    dialog.getByRole("button", { name: "Save shortcuts", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole("textbox", { name: "Keymap JSON", exact: true })
    .fill('{"version":1,"bindings":{"sheet.new":null}}');
  await dialog
    .getByRole("button", { name: "Save shortcuts", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("native-file:space:note.md")!),
    ),
  ).toEqual([...new TextEncoder().encode("words")]);
});
