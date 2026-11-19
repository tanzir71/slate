import { expect, type Page } from "@playwright/test";
import { createSheet, openLibrary } from "./helpers";
import { writePaletteCorpusFiles } from "./paletteCorpusWorker";

/** Populate actual OPFS files with the app unmounted, then await its real metadata. */
export async function preparePaletteCorpus(page: Page) {
  await openLibrary(page);
  await createSheet(page, "# Note 00000\n\nWords kept in real file 00000. #reference\n");
  const appURL = page.url();
  const location = await page.evaluate(() => ({
    id: decodeURIComponent(window.location.hash.split("/")[2]!),
    firstPath: decodeURIComponent(window.location.hash.split("/")[4]!),
  }));
  // Stay on the same origin but outside the app service-worker scope. Background
  // refresh/indexing must not compete with preparation of the benchmark corpus.
  const preparationURL = new URL("/__slate_palette_corpus", appURL).href;
  await page.route(preparationURL, (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Preparing palette corpus</title>" }));
  await page.goto(preparationURL);
  expect(await writePaletteCorpusFiles(page, location.id, 10_000)).toBe(9_999);
  const count = await page.evaluate(async ({ id, firstPath }) => {
    const root = await (await (await navigator.storage.getDirectory()).getDirectoryHandle("spaces")).getDirectoryHandle(id);
    localStorage.setItem(`slate.last-sheet.${id}`, firstPath);
    async function markdownCount(directory: FileSystemDirectoryHandle): Promise<number> {
      let files = 0;
      for await (const [name, handle] of directory.entries()) {
        if (name === ".slate") continue;
        if (handle.kind === "directory") files += await markdownCount(handle as FileSystemDirectoryHandle);
        else if (/\.md$/i.test(name)) files++;
      }
      return files;
    }
    return markdownCount(root);
  }, location);
  expect(count).toBe(10_000);
  await page.goto(appURL);
  await expect(page.locator(".listHeading > small")).toHaveText("10000", { timeout: 90_000 });
  await expect(page.locator(".browserSheetRows")).toHaveAttribute("aria-busy", "false", { timeout: 90_000 });
  await expect(page.locator(".cm-content")).toBeVisible(); await page.bringToFront();
}
