import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createSlateMarkdownExtensions } from "@slate/editor";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createBlockGutterController } from "../src/blockGutterController";

const views: EditorView[] = [];
beforeEach(() => {
  vi.spyOn(window, "requestAnimationFrame").mockReturnValue(0);
});
afterEach(() => {
  for (const view of views.splice(0)) {
    const parent = view.dom.parentElement;
    view.destroy();
    parent?.remove();
  }
  vi.restoreAllMocks();
});
function setup(readOnly = false) {
  const request = vi.fn();
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: "Alpha\n\nBeta\n\nGamma",
      extensions: [
        createSlateMarkdownExtensions(),
        EditorState.readOnly.of(readOnly),
        createBlockGutterController(request),
      ],
    }),
  });
  views.push(view);
  const measure = vi
    .spyOn(view, "requestMeasure")
    .mockImplementation((request) => {
      if (request) request.write?.(request.read(view), view);
    });
  vi.spyOn(view, "posAtCoords").mockReturnValue(1);
  vi.spyOn(view, "coordsAtPos").mockReturnValue({
    left: 100,
    right: 101,
    top: 100,
    bottom: 120,
  });
  const hover = () =>
    view.contentDOM.querySelector(".cm-line")!.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: 100,
        clientY: 110,
      }),
    );
  return { view, request, measure, hover };
}
it("does no block measurement or React callback while typing and exposes the current block only on action", () => {
  const { view, request, measure } = setup();
  view.dispatch({ changes: { from: 1, insert: "x" } });
  expect(request).not.toHaveBeenCalled();
  expect(measure.mock.calls.filter(([request]) => request)).toHaveLength(0);
  view.dom.querySelector<HTMLButtonElement>(".slateBlockAccess")!.click();
  expect(request).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "actions",
      target: expect.objectContaining({ index: 0, source: view.state.doc }),
    }),
  );
});
it("hover exposes plus/grip, then source edits hide stale controls", () => {
  const { view, request, hover } = setup();
  hover();
  const controls = view.dom.querySelector<HTMLElement>(".slateBlockGutter")!;
  expect(controls.hidden).toBe(false);
  controls
    .querySelector<HTMLButtonElement>('[aria-label="Insert block after"]')!
    .click();
  expect(request).toHaveBeenLastCalledWith(
    expect.objectContaining({
      kind: "insert",
      target: expect.objectContaining({ position: 5 }),
    }),
  );
  view.dispatch({ changes: { from: 0, insert: "Keep " } });
  expect(controls.hidden).toBe(true);
  request.mockClear();
  controls.querySelector<HTMLButtonElement>("button")!.click();
  expect(request).not.toHaveBeenCalled();
});
it("moves only a same-view drag and refuses a drop after newer typing", async () => {
  const { view, hover } = setup();
  const data = new Map<string, string>();
  const transfer = {
    setData: (key: string, value: string) => data.set(key, value),
    getData: (key: string) => data.get(key),
    types: ["application/x-slate-block"],
    effectAllowed: "",
    dropEffect: "",
  };
  function drag(target: Element, kind: string) {
    const event = new MouseEvent(kind, {
      bubbles: true,
      cancelable: true,
      clientY: 130,
    });
    Object.defineProperty(event, "dataTransfer", { value: transfer });
    target.dispatchEvent(event);
  }
  hover();
  drag(view.dom.querySelector('[draggable="true"]')!, "dragstart");
  vi.mocked(view.posAtCoords).mockReturnValue(9);
  drag(view.contentDOM, "drop");
  await Promise.resolve();
  expect(view.state.doc.toString()).toBe("Beta\n\nAlpha\n\nGamma");
  vi.mocked(view.posAtCoords).mockReturnValue(1);
  hover();
  drag(view.dom.querySelector('[draggable="true"]')!, "dragstart");
  view.dispatch({ changes: { from: 0, insert: "Latest " } });
  drag(view.contentDOM, "drop");
  await Promise.resolve();
  expect(view.state.doc.toString()).toBe("Latest Beta\n\nAlpha\n\nGamma");
});
it("read-only editors expose no block controls", () => {
  const { view, request, hover } = setup(true);
  hover();
  expect(view.dom.querySelector<HTMLElement>(".slateBlockAccess")!.hidden).toBe(
    true,
  );
  expect(view.dom.querySelector<HTMLElement>(".slateBlockGutter")!.hidden).toBe(
    true,
  );
  view.dom.querySelector<HTMLButtonElement>(".slateBlockAccess")!.click();
  expect(request).not.toHaveBeenCalled();
});

it("keeps the existing selection toolbar next in the Tab order", () => {
  const { view, hover } = setup();
  hover();
  view.dispatch({ selection: { anchor: 0, head: 5 } });
  expect(
    view.dom.querySelector<HTMLButtonElement>(".slateBlockAccess")!.tabIndex,
  ).toBe(-1);
  expect(view.dom.querySelector<HTMLElement>(".slateBlockGutter")!.hidden).toBe(
    true,
  );
  view.dispatch({ selection: { anchor: 5 } });
  expect(
    view.dom.querySelector<HTMLButtonElement>(".slateBlockAccess")!.tabIndex,
  ).toBe(0);
});

it("retains a hover target when pointer-down only moves an empty caret", () => {
  const { view, hover } = setup();
  hover();
  view.dispatch({ selection: { anchor: 2 } });
  expect(view.dom.querySelector<HTMLElement>(".slateBlockGutter")!.hidden).toBe(
    false,
  );
});

it("drops into the actual blank-line slot instead of the end of the sheet", async () => {
  const { view, hover } = setup();
  vi.mocked(view.posAtCoords).mockReturnValue(14);
  hover();
  const data = new Map<string, string>();
  const transfer = {
    setData: (key: string, value: string) => data.set(key, value),
    getData: (key: string) => data.get(key),
    effectAllowed: "",
  };
  const start = new Event("dragstart", { bubbles: true, cancelable: true });
  Object.defineProperty(start, "dataTransfer", { value: transfer });
  view.dom.querySelector('[draggable="true"]')!.dispatchEvent(start);
  vi.mocked(view.posAtCoords).mockReturnValue(6);
  const drop = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(drop, "dataTransfer", { value: transfer });
  view.contentDOM.dispatchEvent(drop);
  await Promise.resolve();
  expect(view.state.doc.toString()).toBe("Alpha\n\nGamma\n\nBeta");
});
