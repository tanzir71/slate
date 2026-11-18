import { undo, redo } from "@codemirror/commands";
import {
  Compartment,
  EditorSelection,
  EditorState,
  StateEffect,
  Transaction,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseMarkdownPreview } from "@slate/core";
import { createSlateMarkdownExtensions } from "../src/index";
import { createSmartPaste, type SmartPasteOptions } from "../src/smartPaste";
import { convertHtmlToMarkdown } from "../src/htmlToMarkdown";

const views: EditorView[] = [];
// These units verify transactions; browser QA verifies actual geometry.
beforeEach(() => {
  vi.spyOn(window, "requestAnimationFrame").mockReturnValue(0);
});
function editor(
  doc = "",
  anchor = doc.length,
  head = anchor,
  options: SmartPasteOptions = {},
) {
  const view = new EditorView({
    parent: document.body.appendChild(document.createElement("div")),
    state: EditorState.create({
      doc,
      selection: { anchor, head },
      extensions: [createSlateMarkdownExtensions(), createSmartPaste(options)],
    }),
  });
  views.push(view);
  view.focus();
  return view;
}
afterEach(() => {
  for (const view of views.splice(0)) {
    const parent = view.dom.parentElement;
    view.destroy();
    parent?.remove();
  }
  vi.restoreAllMocks();
});
function paste(
  view: EditorView,
  values: Record<string, string>,
  files: File[] = [],
) {
  const getData = vi.fn((type: string) => values[type] ?? "");
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData, files, items: [], types: Object.keys(values) },
  });
  view.contentDOM.dispatchEvent(event);
  return { event, getData };
}
const table = "| A   | B   |\n| --- | --- |\n| C   | D   |";
it.each([
  ["www.example.org/a", "https://www.example.org/a"],
  ["xmpp:writer@example.org", "xmpp:writer@example.org"],
  ["mailto:writer@example.org", "mailto:writer@example.org"],
  ["https://example.org", "https://example.org"],
])("keeps existing URL-over-selection behavior: %s", (source, destination) => {
  const view = editor("Words", 0, 5);
  paste(view, { "text/plain": source });
  expect(view.state.doc.toString()).toBe("[Words](" + destination + ")");
});

it("uses a moved sheet’s current image destination when retrying a pending paste", async () => {
  let finish!: (value: { path: string }) => void;
  const before = vi.fn(
    () =>
      new Promise<{ path: string }>((resolve) => {
        finish = resolve;
      }),
  );
  const after = vi.fn(async () => ({ path: "./assets/moved-1.png" }));
  const onNotice = vi.fn();
  const options = new Compartment();
  const view = editor("Start");
  view.dispatch({
    effects: StateEffect.appendConfig.of(
      options.of(createSmartPaste({ importImage: before, onNotice })),
    ),
  });
  paste(view, {}, [new File(["pixels"], "image.png", { type: "image/png" })]);
  await vi.waitFor(() => expect(before).toHaveBeenCalledTimes(1));
  view.dispatch({
    effects: options.reconfigure(
      createSmartPaste({ importImage: after, onNotice }),
    ),
  });
  finish({ path: "./assets/old-1.png" });
  await vi.waitFor(() => expect(onNotice).toHaveBeenCalledTimes(1));
  expect(view.state.doc.toString()).toBe("Start");
  expect(onNotice.mock.calls[0]![0].retry()).toBe(true);
  await vi.waitFor(() =>
    expect(view.state.doc.toString()).toBe(
      "Start![image](./assets/moved-1.png)",
    ),
  );
  expect(before).toHaveBeenCalledTimes(1);
  expect(after).toHaveBeenCalledTimes(1);
});

it("keeps a pending request through read-only mode and refuses a blocked retry", async () => {
  let finish!: (value: string) => void;
  const onNotice = vi.fn();
  const editable = new Compartment();
  const view = editor("Start", 5, 5, {
    onNotice,
    convertHtml: () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  });
  view.dispatch({
    effects: StateEffect.appendConfig.of(
      editable.of(EditorState.readOnly.of(false)),
    ),
  });
  paste(view, { "text/plain": "Bold", "text/html": "<b>Bold</b>" });
  view.dispatch({
    effects: editable.reconfigure(EditorState.readOnly.of(true)),
  });
  finish("**Bold**");
  await vi.waitFor(() => expect(onNotice).toHaveBeenCalledTimes(1));
  expect(onNotice.mock.calls[0]![0].retry()).toBe(false);
  expect(view.state.doc.toString()).toBe("Start");
});

it("keeps successful images when another file fails and retries the whole paste without duplicate copies", async () => {
  const first = new File(["one"], "first.png", { type: "image/png" });
  const second = new File(["two"], "second.png", { type: "image/png" });
  let failed = false;
  const importImage = vi.fn(async (file: File) => {
    if (file === second && !failed) {
      failed = true;
      throw new Error("Interrupted");
    }
    return { path: "./assets/" + file.name, alt: file.name };
  });
  const onNotice = vi.fn();
  const view = editor("Start", 5, 5, { importImage, onNotice });
  paste(view, { "text/plain": "Words" }, [first, second]);
  await vi.waitFor(() => expect(onNotice).toHaveBeenCalledTimes(1));
  expect(view.state.doc.toString()).toBe("Start");
  onNotice.mock.calls[0]![0].retry();
  await vi.waitFor(() =>
    expect(view.state.doc.toString()).toContain("./assets/second.png"),
  );
  expect(
    importImage.mock.calls.filter(([file]) => file === first),
  ).toHaveLength(1);
  expect(
    importImage.mock.calls.filter(([file]) => file === second),
  ).toHaveLength(2);
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("Start");
});
it.each(["A\tB\nC\tD", "A,B\nC,D"])(
  "turns delimited clipboard text into a real GFM table: %j",
  (plain) => {
    const view = editor();
    paste(view, { "text/plain": plain });
    expect(view.state.doc.toString()).toBe(table);
    expect(
      parseMarkdownPreview(view.state.doc.toString()).children?.[0]?.type,
    ).toBe("table");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("");
    expect(redo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(table);
  },
);
it("honors explicitly declared single-column CSV and leaves a comma sentence alone", () => {
  const view = editor();
  paste(view, { "text/plain": "One\nTwo", "text/csv": "One\nTwo" });
  expect(view.state.doc.toString()).toBe("| One |\n| --- |\n| Two |");
  const literal = editor();
  paste(literal, { "text/plain": "Hello, friend" });
  expect(literal.state.doc.toString()).toBe("Hello, friend");
});
it.each([
  ["Before after", 7, "Before \n\n" + table + "\n\nafter"],
  [
    "> - Before after",
    11,
    "> - Before \n>   \n>   " +
      table.split("\n").join("\n>   ") +
      "\n>   \n>   after",
  ],
  ["- [ ] ", 6, "- [ ] \n  \n  " + table.split("\n").join("\n  ")],
])(
  "inserts blocks without losing surrounding words or list/quote context: %s",
  (source, anchor, expected) => {
    const view = editor(source as string, anchor as number);
    paste(view, { "text/plain": "A\tB\nC\tD" });
    expect(view.state.doc.toString()).toBe(expected);
    expect(view.state.selection.main.head).toBe(
      (expected as string).lastIndexOf("|") + 1,
    );
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
    expect(view.state.selection.main.head).toBe(anchor);
  },
);
it.each([
  [
    "Keep **bold**",
    "[Keep **bold**](https://example.test/a\\(b\\)?x=1\\&copy;=2)",
  ],
  [
    "Use [literal]",
    "[Use \\[literal\\]](https://example.test/a\\(b\\)?x=1\\&copy;=2)",
  ],
  [
    "Use " +
      String.fromCharCode(96) +
      "[x]" +
      String.fromCharCode(96) +
      " here",
    "[Use " +
      String.fromCharCode(96) +
      "[x]" +
      String.fromCharCode(96) +
      " here](https://example.test/a\\(b\\)?x=1\\&copy;=2)",
  ],
])(
  "wraps selected Markdown in an escaped URL and restores a reversed selection: %s",
  (source, expected) => {
    const view = editor(source, source.length, 0);
    paste(view, { "text/plain": "https://example.test/a(b)?x=1&copy;=2" });
    expect(view.state.doc.toString()).toBe(expected);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
    expect(view.state.selection.main.anchor).toBe(source.length);
    expect(view.state.selection.main.head).toBe(0);
  },
);
it("keeps the paste separate from preceding typing", () => {
  const view = editor("Before ");
  view.dispatch({
    changes: { from: 7, insert: "label" },
    selection: { anchor: 7, head: 12 },
    annotations: Transaction.userEvent.of("input.type"),
  });
  paste(view, { "text/plain": "https://example.test" });
  expect(view.state.doc.toString()).toBe(
    "Before [label](https://example.test)",
  );
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("Before label");
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("Before ");
});
it("snapshots HTML synchronously and converts only eligible rich paste", async () => {
  const convertHtml = vi.fn(async (html: string) =>
    html === "<b>Rich</b>" ? "**Rich**" : "wrong",
  );
  const values = { "text/plain": "Rich", "text/html": "<b>Rich</b>" };
  const view = editor("", 0, 0, { convertHtml });
  const event = paste(view, values);
  values["text/html"] = "<b>Changed clipboard</b>";
  await vi.waitFor(() => expect(view.state.doc.toString()).toBe("**Rich**"));
  expect(convertHtml).toHaveBeenCalledExactlyOnceWith("<b>Rich</b>");
  expect(event.getData.mock.calls.map(([type]) => type)).toEqual([
    "text/plain",
    "text/html",
    "text/csv",
    "text/tab-separated-values",
  ]);
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("");
});
it("plain-paste shortcut bypasses HTML, URL wrapping and table detection", () => {
  const convertHtml = vi.fn(async () => "**Rich**");
  const view = editor("label", 0, 5, { convertHtml });
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "V",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  paste(view, { "text/plain": "A\tB\nC\tD", "text/html": "<table></table>" });
  expect(view.state.doc.toString()).toBe("A\tB\nC\tD");
  expect(convertHtml).not.toHaveBeenCalled();
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("label");
});
it("falls back to complete plain text when rich conversion fails", async () => {
  const onNotice = vi.fn();
  const view = editor("", 0, 0, {
    convertHtml: async () => {
      throw new Error("Unavailable");
    },
    onNotice,
  });
  paste(view, {
    "text/plain": "All my words",
    "text/html": "<b>All my words</b>",
  });
  await vi.waitFor(() =>
    expect(view.state.doc.toString()).toBe("All my words"),
  );
  expect(onNotice).toHaveBeenCalledWith(
    expect.objectContaining({ message: expect.stringContaining("plain text") }),
  );
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("");
});
it("never overwrites newer words and retains an explicit retry using the current caret", async () => {
  let resolve!: (value: string) => void;
  const converted = new Promise<string>((done) => {
    resolve = done;
  });
  const onNotice = vi.fn();
  const view = editor("Start", 5, 5, {
    convertHtml: () => converted,
    onNotice,
  });
  paste(view, { "text/plain": "Rich", "text/html": "<b>Rich</b>" });
  expect(view.state.doc.toString()).toBe("Start");
  view.dispatch({
    changes: { from: 5, insert: " newer" },
    selection: { anchor: 11 },
  });
  resolve("**Rich**");
  await vi.waitFor(() => expect(onNotice).toHaveBeenCalledTimes(1));
  expect(view.state.doc.toString()).toBe("Start newer");
  onNotice.mock.calls[0]![0].retry();
  await vi.waitFor(() =>
    expect(view.state.doc.toString()).toBe("Start newer**Rich**"),
  );
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("Start newer");
});
it("rejects a changed caret while async work is pending", async () => {
  let resolve!: (value: string) => void;
  const onNotice = vi.fn();
  const view = editor("Start", 5, 5, {
    convertHtml: () =>
      new Promise<string>((done) => {
        resolve = done;
      }),
    onNotice,
  });
  paste(view, { "text/plain": "Rich", "text/html": "<b>Rich</b>" });
  view.dispatch({ selection: { anchor: 0 } });
  resolve("**Rich**");
  await vi.waitFor(() => expect(onNotice).toHaveBeenCalledTimes(1));
  expect(view.state.doc.toString()).toBe("Start");
});
it.each(["- ", "> ", ""])(
  "keeps rich paste disabled independently: %j",
  async (prefix) => {
    const convertHtml = vi.fn(async () => "**Rich**");
    const view = editor(prefix, prefix.length, prefix.length, {
      richText: false,
      convertHtml,
    });
    paste(view, { "text/plain": "Rich", "text/html": "<b>Rich</b>" });
    expect(view.state.doc.toString()).toBe(prefix + "Rich");
    expect(convertHtml).not.toHaveBeenCalled();
  },
);
it("disables table and URL rules independently", () => {
  const view = editor("label", 0, 5, { links: false });
  paste(view, { "text/plain": "https://example.test" });
  expect(view.state.doc.toString()).toBe("https://example.test");
  const table = editor("", 0, 0, { tables: false });
  paste(table, { "text/plain": "A\tB\nC\tD" });
  expect(table.state.doc.toString()).toBe("A\tB\nC\tD");
});
it("keeps ordinary paste literal inside code and front matter", () => {
  const convertHtml = vi.fn(async () => "**Rich**");
  for (const source of [
    "---\ntitle: X",
    "    code",
    String.fromCharCode(96).repeat(3) + "md\ncode",
  ]) {
    const view = editor(source, source.length, source.length, { convertHtml });
    paste(view, { "text/plain": "A\tB\nC\tD", "text/html": "<table></table>" });
    expect(view.state.doc.toString()).toBe(source + "A\tB\nC\tD");
  }
  expect(convertHtml).not.toHaveBeenCalled();
});
it("does not apply a result after its editor is detached", async () => {
  let resolve!: (value: string) => void;
  const onNotice = vi.fn();
  const view = editor("Start", 5, 5, {
    convertHtml: () =>
      new Promise<string>((done) => {
        resolve = done;
      }),
    onNotice,
  });
  paste(view, { "text/plain": "Rich", "text/html": "<b>Rich</b>" });
  view.dom.remove();
  resolve("**Rich**");
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(view.state.doc.toString()).toBe("Start");
});

it.each([
  ["[old **words**](https://old.test)", "[old **words**](https://new.test)"],
  ["Read [docs](https://old.test) now", "[Read docs now](https://new.test)"],
  ["Use [docs][missing]", "[Use \\[docs\\]\\[missing\\]](https://new.test)"],
  [
    "![Picture](./assets/picture.png)",
    "[![Picture](./assets/picture.png)](https://new.test)",
  ],
])(
  "keeps labels and valid inline content when replacing a selected link target: %s",
  (source, expected) => {
    const view = editor(source, 0, source.length);
    paste(view, { "text/plain": "https://new.test" });
    expect(view.state.doc.toString()).toBe(expected);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
  },
);
it("resolves reference labels without changing their definitions", () => {
  const selected = "Read [docs][id] now";
  const definition = "\n\n[id]: https://old.test";
  const view = editor(selected + definition, 0, selected.length);
  paste(view, { "text/plain": "https://new.test" });
  expect(view.state.doc.toString()).toBe(
    "[Read docs now](https://new.test)" + definition,
  );
});
it("keeps autolink label characters literal under a new target", () => {
  const source = "<https://old.test/a\\)&copy;[x]*>";
  const view = editor(source, 0, source.length);
  const before = parseMarkdownPreview(source).children?.[0]?.children?.[0];
  paste(view, { "text/plain": "https://new.test" });
  const after = parseMarkdownPreview(view.state.doc.toString()).children?.[0]
    ?.children?.[0];
  expect(after?.url).toBe("https://new.test");
  expect(after?.children?.map((node) => node.value).join("")).toBe(
    before?.children?.map((node) => node.value).join(""),
  );
});
it("wraps multiple selections in one undo without changing their main range", () => {
  const view = editor("One Two");
  view.dispatch({
    effects: StateEffect.appendConfig.of(
      EditorState.allowMultipleSelections.of(true),
    ),
  });
  const selection = EditorSelection.create(
    [EditorSelection.range(0, 3), EditorSelection.range(4, 7)],
    1,
  );
  view.dispatch({ selection });
  paste(view, { "text/plain": "https://example.test" });
  expect(view.state.doc.toString()).toBe(
    "[One](https://example.test) [Two](https://example.test)",
  );
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("One Two");
  expect(view.state.selection.eq(selection)).toBe(true);
});
it("imports clipboard images once and retains the saved asset through undo", async () => {
  const file = new File(["pixels"], "image.png", { type: "image/png" });
  const importImage = vi.fn(async () => ({
    path: "./assets/image-1.png",
    alt: "[literal] &copy; *bold* _word_",
  }));
  const view = editor("", 0, 0, { importImage });
  paste(view, {}, [file]);
  await vi.waitFor(() => expect(importImage).toHaveBeenCalledTimes(1));
  await vi.waitFor(() =>
    expect(view.state.doc.toString()).toContain("./assets/image-1.png"),
  );
  const image = parseMarkdownPreview(view.state.doc.toString()).children?.[0]
    ?.children?.[0];
  expect(image?.alt).toBe("[literal] &copy; *bold* _word_");
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("");
  expect(redo(view)).toBe(true);
  expect(importImage).toHaveBeenCalledExactlyOnceWith(file);
});
it("retries interrupted image insertion without saving another copy of the same file", async () => {
  const file = new File(["pixels"], "image.png", { type: "image/png" });
  let resolve!: (value: { path: string }) => void;
  const importImage = vi.fn(
    () =>
      new Promise<{ path: string }>((done) => {
        resolve = done;
      }),
  );
  const onNotice = vi.fn();
  const view = editor("Start", 5, 5, { importImage, onNotice });
  paste(view, {}, [file]);
  await vi.waitFor(() => expect(importImage).toHaveBeenCalledTimes(1));
  view.dispatch({
    changes: { from: 5, insert: " newer" },
    selection: { anchor: 11 },
  });
  resolve({ path: "./assets/image-1.png" });
  await vi.waitFor(() => expect(onNotice).toHaveBeenCalledTimes(1));
  expect(view.state.doc.toString()).toBe("Start newer");
  onNotice.mock.calls[0]![0].retry();
  await vi.waitFor(() =>
    expect(view.state.doc.toString()).toContain(
      "Start newer![image](./assets/image-1.png)",
    ),
  );
  expect(importImage).toHaveBeenCalledTimes(1);
});
it("keeps selected words when rich clipboard content converts to nothing", async () => {
  const convertHtml = vi.fn(async () => "");
  const view = editor("Keep me", 0, 7, { convertHtml });
  paste(view, { "text/html": "<div></div>" });
  await vi.waitFor(() => expect(convertHtml).toHaveBeenCalledTimes(1));
  expect(view.state.doc.toString()).toBe("Keep me");
  expect(undo(view)).toBe(false);
});
it("keeps the text and image positions of a mixed rich clipboard copy", async () => {
  const file = new File(["pixels"], "image.png", { type: "image/png" });
  const importImage = vi.fn(async () => ({
    path: "./assets/image-1.png",
    alt: "File",
  }));
  const view = editor("", 0, 0, {
    importImage,
    convertHtml: async (html) => convertHtmlToMarkdown(html),
  });
  paste(
    view,
    {
      "text/plain": "Before Picture After",
      "text/html":
        '<p>Before</p><img src="data:image/png;base64,AP+A" alt="Picture"><p>After</p>',
    },
    [file],
  );
  await vi.waitFor(() =>
    expect(view.state.doc.toString()).toBe(
      "Before\n\n![Picture](./assets/image-1.png)\n\nAfter",
    ),
  );
  expect(importImage).toHaveBeenCalledExactlyOnceWith(file);
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("");
});
it("pastes embedded image pixels independently of rich-text conversion", async () => {
  const importImage = vi.fn(async () => ({
    path: "./assets/picture-1.png",
    alt: "File",
  }));
  const convertHtml = vi.fn(async () => "**Wrong**");
  const view = editor("", 0, 0, { importImage, richText: false, convertHtml });
  paste(view, {
    "text/html": '<img src="data:image/png;base64,AP+A" alt="Picture">',
  });
  await vi.waitFor(() =>
    expect(view.state.doc.toString()).toBe(
      "![Picture](./assets/picture-1.png)",
    ),
  );
  expect(convertHtml).not.toHaveBeenCalled();
  expect(importImage).toHaveBeenCalledTimes(1);
});
it("retains the entire mixed clipboard request when saving its image fails", async () => {
  const file = new File(["pixels"], "image.png", { type: "image/png" });
  const importImage = vi
    .fn<NonNullable<SmartPasteOptions["importImage"]>>()
    .mockRejectedValueOnce(new Error("No write"))
    .mockResolvedValue({ path: "./assets/image-1.png" });
  const onNotice = vi.fn();
  const view = editor("Start", 5, 5, {
    importImage,
    onNotice,
    convertHtml: async (html) => convertHtmlToMarkdown(html),
  });
  paste(
    view,
    {
      "text/plain": "Before Picture After",
      "text/html":
        '<p>Before</p><img src="data:image/png;base64,AP+A" alt="Picture"><p>After</p>',
    },
    [file],
  );
  await vi.waitFor(() => expect(onNotice).toHaveBeenCalledTimes(1));
  expect(view.state.doc.toString()).toBe("Start");
  onNotice.mock.calls[0]![0].retry();
  await vi.waitFor(() =>
    expect(view.state.doc.toString()).toBe(
      "Start\n\nBefore\n\n![Picture](./assets/image-1.png)\n\nAfter",
    ),
  );
  expect(importImage).toHaveBeenCalledTimes(2);
  expect(undo(view)).toBe(true);
  expect(view.state.doc.toString()).toBe("Start");
});
