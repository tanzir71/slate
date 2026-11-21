import { expect, test } from "./fixtures";
import { createSheet, expectSavedSheet, openLibrary } from "./helpers";

test("closing Search restores the editor selection before the next input", async ({ page }) => {
  await page.addInitScript(() => {
    const close = HTMLDialogElement.prototype.close;
    HTMLDialogElement.prototype.close = function (returnValue?: string) {
      close.call(this, returnValue);
      if (this.getAttribute("aria-label") !== "Search everywhere") return;
      const editor = document.querySelector<HTMLElement>(".cm-content")!;
      // Reproduce native focus return without a valid editor DOM selection.
      editor.focus();
      document.getSelection()!.removeAllRanges();
      queueMicrotask(() => {
        const selection = document.getSelection();
        Reflect.set(window, "searchReturnedSelection", document.activeElement === editor &&
          selection?.rangeCount === 1 && editor.contains(selection.anchorNode));
      });
    };
  });
  await openLibrary(page);
  const editor = await createSheet(page, "");
  await page.keyboard.press("ControlOrMeta+Shift+f");
  const search = page.getByRole("dialog", { name: "Search everywhere", exact: true });
  await expect(search.getByRole("textbox", { name: /^Search in / })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(search).toBeHidden();
  expect(await page.evaluate(() => Reflect.get(window, "searchReturnedSelection"))).toBe(true);
  await expect(editor).toBeFocused();
  await page.keyboard.insertText("my words");
  await expectSavedSheet(page, "my words");
  await page.keyboard.press("ControlOrMeta+z");
  await expectSavedSheet(page, "");
});
