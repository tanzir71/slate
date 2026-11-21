import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { nativeCaretDistance } from "../../../e2e/nativeCaret";

const original = Object.getOwnPropertyDescriptor(Range.prototype, "getBoundingClientRect");
let rectangle = (_range: Range) => new DOMRect(5, 180, 1, 20);
beforeAll(() => {
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true,
    value(this: Range) { return rectangle(this); } });
});
afterAll(() => {
  if (original) Object.defineProperty(Range.prototype, "getBoundingClientRect", original);
  else Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
});
afterEach(() => { getSelection()?.removeAllRanges(); document.body.replaceChildren(); rectangle = () => new DOMRect(5, 180, 1, 20); });
function editor(text = "Kept words.") {
  const scroller = document.body.appendChild(document.createElement("div")); scroller.className = "cm-scroller";
  Object.defineProperty(scroller, "clientHeight", { value: 400 });
  scroller.getBoundingClientRect = () => new DOMRect(0, 10, 300, 400);
  const content = scroller.appendChild(document.createElement("div")); content.className = "cm-content";
  const line = content.appendChild(document.createElement("div")); line.className = "cm-line"; line.textContent = text;
  const select = (node: Node, offset: number) => { const range = document.createRange(); range.setStart(node, offset); range.collapse(true); const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range); };
  return { content, line, select };
}

it("reports a missing native selection as pending and measures it when it becomes available", () => {
  const { content, line, select } = editor(); getSelection()!.removeAllRanges();
  expect(nativeCaretDistance(content)).toBe(Infinity);
  select(line.firstChild!, 2); expect(nativeCaretDistance(content)).toBe(0);
});
it("keeps a selection outside the editor pending", () => {
  const { content, select } = editor(), outside = document.body.appendChild(document.createElement("div"));
  outside.textContent = "Other text"; select(outside.firstChild!, 1);
  expect(nativeCaretDistance(content)).toBe(Infinity);
});
it("keeps the exact two-pixel boundary and larger measured errors", () => {
  const { content, line, select } = editor(); select(line.firstChild!, 2);
  rectangle = () => new DOMRect(5, 182, 1, 20); expect(nativeCaretDistance(content)).toBe(2);
  rectangle = () => new DOMRect(5, 230, 1, 20); expect(nativeCaretDistance(content)).toBe(50);
});
it("retains the native parent-boundary text rectangle fallback", () => {
  const { content, line, select } = editor(); select(line, 1);
  rectangle = range => range.startContainer.nodeType === Node.TEXT_NODE ? new DOMRect(5, 180, 1, 20) : new DOMRect();
  expect(nativeCaretDistance(content)).toBe(0);
});
it("retains the empty-line native rectangle fallback", () => {
  const { content, line, select } = editor(""); select(line, 0);
  rectangle = () => new DOMRect(); line.getBoundingClientRect = () => new DOMRect(5, 180, 1, 20);
  expect(nativeCaretDistance(content)).toBe(0);
});
it("still rejects a present native caret with no measurable line rectangle", () => {
  const { content, line, select } = editor(); select(line.firstChild!, 2); rectangle = () => new DOMRect();
  expect(() => nativeCaretDistance(content)).toThrow("The native caret has no measurable line rectangle");
});
