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

describe("empty states", () => {
  it("shows and clears the no-results sheet search state", async () => {
    const { host } = await renderApp();
    const search = host.querySelector<HTMLInputElement>('input[placeholder="Search sheets..."]');
    if (!search) {
      throw new Error("Missing sheet search input");
    }

    await setInputValue(search, "zzzzzz");

    expect(host.textContent).toContain("No sheets match");

    await click(getButton(host, "Clear search"));

    expect(search.value).toBe("");
    expect(host.textContent).not.toContain("No sheets match");
  });

  it("shows an inspector empty state when a sheet has no backlinks", async () => {
    const { host } = await renderApp();

    await click(getByTestId(host, "sheet-row-writing-principles"));

    expect(host.textContent).toContain("No backlinks yet");
  });
});

async function renderApp(): Promise<RenderedApp> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const rendered = { host, root };
  mounted.push(rendered);

  await act(async () => {
    root.render(createElement(SlateApp));
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

function getButton(host: ParentNode, label: string): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!button) {
    throw new Error(`Missing button "${label}"`);
  }
  return button;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function setInputValue(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
