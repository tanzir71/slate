import { expect, it } from "vitest";
import { typewriterScrollTop } from "../src/writingMode";
import { createWritingModeExtensions } from "../src/writingMode";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createSlateMarkdownExtensions } from "../src/index";

it("keeps the entire math source block in paragraph focus, including its fences and blank lines", () => {
  const source = "Before\n\n$$\nx^2\n\n+y^2\n$$\n\nAfter", host = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({ parent: host, state: EditorState.create({ doc: source, selection: { anchor: source.indexOf("x^2") + 1 }, extensions: [createSlateMarkdownExtensions(), createWritingModeExtensions({ focus: "paragraph", typewriter: false, zen: false })] }) });
  try {
    const lines = [...view.contentDOM.querySelectorAll(".cm-line")];
    expect(lines.filter(line => line.classList.contains("cm-writing-dim")).map(line => line.textContent)).toEqual(["Before", "", "", "After"]);
    expect(lines.filter(line => !line.classList.contains("cm-writing-dim")).map(line => line.textContent)).toEqual(["$$", "x^2", "", "+y^2", "$$"]);
  } finally { view.destroy(); host.remove(); }
});

it("places the actual caret centre at45% of the scroll viewport independently of its page offset", () => {
  expect(typewriterScrollTop(200, 100, 600, 450, 486)).toBe(298);
  expect(typewriterScrollTop(0, 0, 900, 387, 423)).toBe(0);
  expect(typewriterScrollTop(600, 80, 400, 400, 428)).toBe(754);
});
it("keeps a caret already at45% stationary and clamps scrolling above the document", () => {
  expect(typewriterScrollTop(250, 100, 600, 352, 388)).toBe(250);
  expect(typewriterScrollTop(10, 200, 600, 200, 236)).toBe(0);
});
