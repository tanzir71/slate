import { expect, test } from "./fixtures";
import {
  createSheet,
  expectSavedSheet as saved,
  readCurrentSheet,
  openLibrary,
  workspaceAction,
} from "./helpers";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function paste(page: Page, text: string, html = "") {
  await page.locator(".cm-content").evaluate(
    (element, values) => {
      const data = new DataTransfer();
      data.setData("text/plain", values.text);
      if (values.html) data.setData("text/html", values.html);
      // Firefox discards constructor-supplied clipboardData on synthetic events.
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: data });
      element.dispatchEvent(event);
    },
    { text, html },
  );
}
async function image(
  page: Page,
  format: "image/png" | "image/jpeg",
  embedded = false,
  delayed = false,
) {
  return page.locator(".cm-content").evaluate(
    async (element, options) => {
      const canvas = document.createElement("canvas");
      canvas.width = 3;
      canvas.height = 2;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#ff0000";
      context.fillRect(0, 0, 3, 2);
      const url = canvas.toDataURL(options.format);
      const bytes = Uint8Array.from(atob(url.split(",")[1]!), (character) =>
        character.charCodeAt(0),
      );
      const file = new File(
        [bytes],
        "Picture." + (options.format === "image/png" ? "png" : "jpg"),
        { type: options.format },
      );
      if (options.delayed) {
        const original = file.arrayBuffer.bind(file);
        const gate = new Promise<void>((resolve) =>
          Reflect.set(window, "finishPasteImage", resolve),
        );
        file.arrayBuffer = async () => {
          await gate;
          return original();
        };
      }
      const data = new DataTransfer();
      data.items.add(file);
      if (options.embedded) {
        data.setData("text/plain", "Before after");
        data.setData(
          "text/html",
          '<p>Before <img src="' + url + '" alt="Diagram"> after</p>',
        );
      }
      // Firefox discards constructor-supplied clipboardData on synthetic events.
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: data });
      element.dispatchEvent(event);
      return [...bytes];
    },
    { format, embedded, delayed },
  );
}
async function asset(page: Page, name: string) {
  return page.evaluate(async (name) => {
    const parts = location.hash.split("/");
    const root = await navigator.storage.getDirectory();
    let directory = await (
      await root.getDirectoryHandle("spaces")
    ).getDirectoryHandle(decodeURIComponent(parts[2]!));
    const path = decodeURIComponent(parts[4]!).split("/");
    for (const part of path.slice(0, -1))
      directory = await directory.getDirectoryHandle(part);
    const file = await (
      await (await directory.getDirectoryHandle("assets")).getFileHandle(name)
    ).getFile();
    return [...new Uint8Array(await file.arrayBuffer())];
  }, name);
}

test("saved paste assertions require exact disk bytes after one unavailable snapshot", async ({
  page,
}) => {
  await openLibrary(page);
  const editor = await createSheet(page, "Start ");
  await editor.press("ControlOrMeta+End");
  await paste(page, "bold", "<b>bold</b>");
  let reads = 0,
    failures = 0;
  await saved(page, "Start **bold**", async (currentPage) => {
    reads++;
    if (failures === 0) {
      failures++;
      // Inject at the assertion reader: a WebKit StorageManager override can
      // miss later reads even though the trace proves the assertion retried.
      await currentPage.evaluate(() => {
        throw new DOMException(
          "One unavailable saved snapshot",
          "NotFoundError",
        );
      });
    }
    return readCurrentSheet(currentPage);
  });
  expect(reads).toBeGreaterThanOrEqual(2);
  expect(failures).toBe(1);
  await page.reload();
  await expect(page.locator(".cm-content")).toBeVisible();
  await saved(page, "Start **bold**");
});

test("rich paste, URL-over-selection, delimited cells and plain shortcut preserve source and undo", async ({
  page,
}) => {
  await openLibrary(page);
  const editor = await createSheet(page, "Start ");
  await editor.press("ControlOrMeta+End");
  await paste(page, "bold", "<b>bold</b>");
  await saved(page, "Start **bold**");
  await editor.press("ControlOrMeta+z");
  await saved(page, "Start ");
  await editor.press("ControlOrMeta+a");
  await paste(page, "https://example.org/a_(b)");
  await saved(page, "[Start ](https://example.org/a_\\(b\\))");
  await editor.press("ControlOrMeta+z");
  await saved(page, "Start ");
  await editor.press("ControlOrMeta+End");
  await paste(page, "A\tB\nC\tD");
  await saved(page, "Start \n\n| A   | B   |\n| --- | --- |\n| C   | D   |");
  await editor.press("ControlOrMeta+z");
  await saved(page, "Start ");
  await editor.evaluate((element) =>
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "v",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  await paste(page, "A\tB\nC\tD", "<b>Not plain</b>");
  await saved(page, "Start A\tB\nC\tD");
  await editor.press("ControlOrMeta+z");
  await saved(page, "Start ");
});

test("paste rules change immediately, remain independent and survive reload", async ({
  page,
}) => {
  await openLibrary(page);
  const editor = await createSheet(page, "Start ");
  await workspaceAction(page, "Editor settings");
  const settings = page.getByRole("dialog", {
    name: "Editor settings",
    exact: true,
  });
  await settings
    .getByRole("checkbox", {
      name: "Convert rich text to Markdown",
      exact: true,
    })
    .uncheck();
  await settings
    .getByRole("checkbox", { name: "Convert pasted tables", exact: true })
    .uncheck();
  await settings
    .getByRole("checkbox", {
      name: "Link selected text when pasting a URL",
      exact: true,
    })
    .uncheck();
  await expect(
    settings.getByRole("checkbox", { name: "Save pasted images", exact: true }),
  ).toBeChecked();
  await settings.getByRole("button", { name: "Done", exact: true }).click();
  await editor.press("ControlOrMeta+End");
  await paste(page, "plain", "<b>bold</b>");
  await saved(page, "Start plain");
  await editor.press("ControlOrMeta+z");
  await saved(page, "Start ");
  await paste(page, "A\tB\nC\tD");
  await saved(page, "Start A\tB\nC\tD");
  await editor.press("ControlOrMeta+z");
  await saved(page, "Start ");
  await editor.press("ControlOrMeta+a");
  await paste(page, "https://example.org");
  await saved(page, "https://example.org");
  await page.reload();
  await expect(editor).toContainText("https://example.org");
  await workspaceAction(page, "Editor settings");
  for (const name of [
    "Convert rich text to Markdown",
    "Convert pasted tables",
    "Link selected text when pasting a URL",
  ])
    await expect(
      settings.getByRole("checkbox", { name, exact: true }),
    ).not.toBeChecked();
  await expect(
    settings.getByRole("checkbox", { name: "Save pasted images", exact: true }),
  ).toBeChecked();
});

test("PNG bytes stay exact, numbered copies stay beside the sheet and undo keeps saved pixels", async ({
  page,
}) => {
  await openLibrary(page);
  const editor = await createSheet(page, "Start");
  await editor.press("ControlOrMeta+End");
  const original = await image(page, "image/png");
  await saved(page, "Start![Picture](./assets/picture-1.png)");
  expect(await asset(page, "picture-1.png")).toEqual(original);
  await editor.press("ControlOrMeta+z");
  await saved(page, "Start");
  expect(await asset(page, "picture-1.png")).toEqual(original);
  await image(page, "image/png");
  await saved(page, "Start![Picture](./assets/picture-2.png)");
  expect(await asset(page, "picture-1.png")).toEqual(original);
  expect(await asset(page, "picture-2.png")).toEqual(original);
  await page.reload();
  await expect(editor).toContainText("picture-2.png");
});

test("JPEG pixels become a real PNG and embedded HTML reuses its attached image", async ({
  page,
}) => {
  await openLibrary(page);
  const editor = await createSheet(page, "");
  await image(page, "image/jpeg");
  await saved(page, "![Picture](./assets/picture-1.png)");
  const bytes = await asset(page, "picture-1.png");
  expect(bytes.slice(0, 8)).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const decoded = await page.evaluate(async (bytes) => {
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(bytes)], { type: "image/png" }),
    );
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 3;
      canvas.height = 2;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      return {
        width: image.naturalWidth,
        height: image.naturalHeight,
        pixel: [...context.getImageData(1, 1, 1, 1).data],
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  }, bytes);
  expect(decoded.width).toBe(3);
  expect(decoded.height).toBe(2);
  expect(decoded.pixel[0]).toBeGreaterThan(245);
  expect(decoded.pixel[1]).toBeLessThan(10);
  expect(decoded.pixel[2]).toBeLessThan(10);
  await editor.press("ControlOrMeta+z");
  await saved(page, "");
  const original = await image(page, "image/png", true);
  await saved(page, "Before ![Diagram](./assets/picture-2.png) after");
  expect(await asset(page, "picture-2.png")).toEqual(original);
  await expect(asset(page, "picture-3.png")).rejects.toThrow();
});

test("a delayed image never replaces later writing and its notice retries without duplicate assets", async ({
  page,
}, testInfo) => {
  await openLibrary(page);
  const editor = await createSheet(page, "Start");
  await editor.press("ControlOrMeta+End");
  const original = await image(page, "image/png", false, true);
  await page.keyboard.insertText(" kept");
  await page.evaluate(() =>
    (Reflect.get(window, "finishPasteImage") as () => void)(),
  );
  const notice = page.locator(".pasteNotice");
  await expect(notice).toContainText(
    "The sheet changed before the paste finished.",
  );
  await expect(notice).toHaveCSS("display", "flex");
  await testInfo.attach("paste-retry-notice", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  expect(
    (await new AxeBuilder({ page }).include(".pasteNotice").analyze())
      .violations,
  ).toEqual([]);
  await saved(page, "Start kept");
  await notice
    .getByRole("button", { name: "Retry paste", exact: true })
    .click();
  await saved(page, "Start kept![Picture](./assets/picture-1.png)");
  expect(await asset(page, "picture-1.png")).toEqual(original);
  await expect(asset(page, "picture-2.png")).rejects.toThrow();
  await editor.press("ControlOrMeta+z");
  await saved(page, "Start kept");
});

test("clipboard HTML and SVG conversion execute no markup and request no external pixels", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (request) => {
    if (
      /^https?:/.test(request.url()) &&
      new URL(request.url()).hostname !== "127.0.0.1"
    )
      external.push(request.url());
  });
  await openLibrary(page);
  const editor = await createSheet(page, "");
  await paste(
    page,
    "Words",
    '<p>Words</p><script>window.clipboardExecuted = true</script><iframe src="https://clipboard.invalid/frame"></iframe><img src="https://clipboard.invalid/pixel.png" onerror="window.clipboardExecuted=true" alt="Remote">',
  );
  await saved(page, "Words\n\n![Remote](https://clipboard.invalid/pixel.png)");
  expect(
    await page.evaluate(() => Reflect.get(window, "clipboardExecuted")),
  ).toBeUndefined();
  await editor.press("ControlOrMeta+z");
  await saved(page, "");
  await editor.evaluate((element) => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="3" height="2" onload="parent.clipboardExecuted=true"><script>parent.clipboardExecuted=true</script><image href="https://clipboard.invalid/svg-pixel.png" width="3" height="2"/><rect width="3" height="2" fill="red"/></svg>';
    const data = new DataTransfer();
    data.items.add(new File([svg], "Vector.svg", { type: "image/svg+xml" }));
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: data });
    element.dispatchEvent(event);
  });
  await saved(page, "![Vector](./assets/vector-1.png)");
  expect((await asset(page, "vector-1.png")).slice(0, 8)).toEqual([
    137, 80, 78, 71, 13, 10, 26, 10,
  ]);
  expect(
    await page.evaluate(() => Reflect.get(window, "clipboardExecuted")),
  ).toBeUndefined();
  expect(external).toEqual([]);
});
