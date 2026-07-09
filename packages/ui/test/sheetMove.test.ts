import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { SlateApp } from "../src/SlateApp";

interface RenderedApp {
  host: HTMLDivElement;
  root: Root;
}

const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
actGlobal.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: RenderedApp[] = [];

afterEach(async () => {
  for (const rendered of mounted.splice(0)) {
    await act(async () => {
      rendered.root.unmount();
    });
    rendered.host.remove();
  }
});

describe("sheet moves", () => {
  it("moves a dragged sheet to a notebook through the injected move adapter", async () => {
    const moves: Array<{ fromPath: string; toPath: string }> = [];
    const { host } = await renderApp({
      sheetMoveWriter: {
        moveSheet: async (fromPath: string, toPath: string) => {
          moves.push({ fromPath, toPath });
        }
      }
    });

    const launchPlan = getByTestId(host, "sheet-row-launch-plan");
    const draftsNotebook = getByTestId(host, "notebook-drop-drafts");
    const dataTransfer = createDragTransfer();

    await act(async () => {
      dispatchDrag(launchPlan, "dragstart", dataTransfer);
      dispatchDrag(draftsNotebook, "dragover", dataTransfer);
      dispatchDrag(draftsNotebook, "drop", dataTransfer);
      await Promise.resolve();
    });

    expect(moves).toEqual([
      {
        fromPath: "product/strategy/launch-plan.md",
        toPath: "writing/drafts/launch-plan.md"
      }
    ]);
    expect(launchPlan.textContent).toContain("#writing/drafts");
  });
});

async function renderApp(props: Record<string, unknown>): Promise<RenderedApp> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const rendered = { host, root };
  mounted.push(rendered);

  await act(async () => {
    root.render(createElement(SlateApp, props));
  });

  return rendered;
}

function getByTestId(host: ParentNode, testId: string): HTMLElement {
  const element = host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (!element) {
    throw new Error(`Missing element with data-testid="${testId}"`);
  }
  return element;
}

interface DragTransferStub {
  dropEffect: string;
  effectAllowed: string;
  getData(format: string): string;
  setData(format: string, value: string): void;
}

function createDragTransfer(): DragTransferStub {
  const values = new Map<string, string>();
  return {
    dropEffect: "move",
    effectAllowed: "move",
    getData: (format) => values.get(format) ?? "",
    setData: (format, value) => {
      values.set(format, value);
    }
  };
}

function dispatchDrag(element: HTMLElement, type: string, dataTransfer: DragTransferStub): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: dataTransfer
  });
  element.dispatchEvent(event);
}
