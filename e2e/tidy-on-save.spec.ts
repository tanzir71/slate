import { expect, test } from "./fixtures";
import {
  createSheet,
  expectSavedSheet,
  openLibrary,
  readCurrentSheet,
} from "./helpers";
import { libraryFile } from "./libraryFiles";

const dirty = "#   Draft\n\nWords.\n";
const clean = "# Draft\n\nWords.\n";
type Gate = {
  hold: boolean;
  fail: boolean;
  fixes: number;
  waiting: boolean;
  release?: () => void;
};
declare global {
  interface Window {
    slateOnSaveGate: Gate;
  }
}
async function installGate(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    const gate: Gate = { hold: false, fail: false, fixes: 0, waiting: false };
    Object.assign(window, { slateOnSaveGate: gate });
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (!String(url).includes("tidy.worker")) return;
        const post = this.postMessage.bind(this);
        this.postMessage = (message: unknown) => {
          if (
            typeof message === "object" &&
            message !== null &&
            "kind" in message &&
            message.kind === "fix"
          ) {
            gate.fixes++;
            if (gate.fail && "id" in message) {
              queueMicrotask(() =>
                this.dispatchEvent(
                  new MessageEvent("message", {
                    data: {
                      id: message.id,
                      kind: "error",
                      message: "On-save worker failed",
                    },
                  }),
                ),
              );
              return;
            }
            if (gate.hold) {
              gate.waiting = true;
              gate.release = () => {
                gate.hold = false;
                post(message);
              };
              return;
            }
          }
          post(message);
        };
      }
    };
  });
}
async function gate(
  page: import("@playwright/test").Page,
  change?: Partial<Pick<Gate, "hold" | "fail">>,
) {
  return page.evaluate((change) => {
    const current = window.slateOnSaveGate;
    Object.assign(current, change);
    return { fixes: current.fixes, waiting: current.waiting };
  }, change);
}
async function enabled(page: import("@playwright/test").Page) {
  await libraryFile(page, ".slate/tidy.json", '{"version":1,"onSave":true}');
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.keyboard.press("Alt+Shift+f");
  const review = page.getByRole("complementary", {
    name: "Tidy review",
    exact: true,
  });
  await expect(
    review.getByRole("switch", { name: "Tidy on save" }),
  ).toBeChecked();
  await review.getByRole("button", { name: "Close Tidy", exact: true }).click();
}

test("explicit Save formats an unchanged note; enabling and opening alone keep its bytes", async ({
  page,
}) => {
  await installGate(page);
  await openLibrary(page);
  const editor = await createSheet(page, dirty);
  expect(await libraryFile(page, ".slate/tidy.json")).toBeUndefined();
  await enabled(page);
  // Cover both autosave/lint debounce windows to rule out a background settings edit.
  await page.waitForTimeout(850);
  expect(await readCurrentSheet(page)).toBe(dirty);
  expect((await gate(page)).fixes).toBe(0);
  await page.reload();
  await expect(page.locator(".cm-content")).toBeVisible();
  await page.waitForTimeout(850);
  expect(await readCurrentSheet(page)).toBe(dirty);
  expect((await gate(page)).fixes).toBe(0);
  await editor.press("ControlOrMeta+s");
  await expectSavedSheet(page, clean);
  expect((await gate(page)).fixes).toBe(1);
  await editor.press("ControlOrMeta+z");
  await expectSavedSheet(page, dirty);
  await page.waitForTimeout(850);
  expect(await readCurrentSheet(page)).toBe(dirty);
  expect((await gate(page)).fixes).toBe(1);
  await editor.press("ControlOrMeta+s");
  await expectSavedSheet(page, clean);
  expect((await gate(page)).fixes).toBe(2);
});

test("autosave persists original input before the worker, with one Undo and no Tidy or history loop", async ({
  page,
}) => {
  await installGate(page);
  await openLibrary(page);
  const editor = await createSheet(page, dirty);
  await enabled(page);
  await gate(page, { hold: true });
  await editor.press("ControlOrMeta+End");
  await page.keyboard.insertText("More.");
  await expect.poll(async () => (await gate(page)).waiting).toBe(true);
  expect(await readCurrentSheet(page)).toBe(dirty + "More.");
  await page.evaluate(() => window.slateOnSaveGate.release?.());
  const formatted = clean + "More.\n";
  await expectSavedSheet(page, formatted);
  await page.waitForTimeout(850);
  expect((await gate(page)).fixes).toBe(1);
  await editor.press("ControlOrMeta+z");
  await expectSavedSheet(page, dirty + "More.");
  await page.waitForTimeout(850);
  expect(await readCurrentSheet(page)).toBe(dirty + "More.");
  expect((await gate(page)).fixes).toBe(1);
  await editor.press(process.platform === "darwin" ? "Meta+Shift+z" : "ControlOrMeta+y");
  await expectSavedSheet(page, formatted);
  await page.waitForTimeout(850);
  expect((await gate(page)).fixes).toBe(1);
  await editor.press("ControlOrMeta+End");
  await page.keyboard.insertText("Next.");
  await expectSavedSheet(page, formatted + "Next.\n");
  expect((await gate(page)).fixes).toBe(2);
});

test("an on-save worker failure retains the successfully saved input and reports the error", async ({
  page,
}) => {
  await installGate(page);
  await openLibrary(page);
  const editor = await createSheet(page, dirty);
  await enabled(page);
  await gate(page, { fail: true });
  await editor.press("ControlOrMeta+End");
  await page.keyboard.insertText("Kept.");
  await expect.poll(async () => (await gate(page)).fixes).toBe(1);
  await expectSavedSheet(page, dirty + "Kept.");
  await page.keyboard.press("Alt+Shift+f");
  await expect(
    page.getByText("On-save worker failed", { exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(850);
  expect((await gate(page)).fixes).toBe(1);
  expect(await readCurrentSheet(page)).toBe(dirty + "Kept.");
});

test("malformed on-save settings preserve input and the original settings bytes", async ({
  page,
}) => {
  await installGate(page);
  await openLibrary(page);
  const editor = await createSheet(page, dirty);
  const settings = '{"version":1,"onSave":true,broken';
  await libraryFile(page, ".slate/tidy.json", settings);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await editor.press("ControlOrMeta+End");
  await page.keyboard.insertText("Kept.");
  await expectSavedSheet(page, dirty + "Kept.");
  await page.waitForTimeout(850);
  expect(await readCurrentSheet(page)).toBe(dirty + "Kept.");
  expect((await gate(page)).fixes).toBe(0);
  expect(await libraryFile(page, ".slate/tidy.json")).toEqual(
    Array.from(new TextEncoder().encode(settings)),
  );
});
