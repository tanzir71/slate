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

describe("editor modes", () => {
  it("toggles focus, typewriter, and full-screen mode classes from toolbar controls", async () => {
    const { host } = await renderApp();
    const app = host.querySelector(".slateApp");
    const focus = getButton(host, "Toggle focus mode");
    const typewriter = getButton(host, "Toggle typewriter mode");
    const fullscreen = getButton(host, "Toggle full-screen mode");

    await click(focus);
    expect(app?.classList.contains("focusMode")).toBe(true);
    expect(focus.getAttribute("aria-pressed")).toBe("true");

    await click(typewriter);
    expect(app?.classList.contains("typewriterMode")).toBe(true);
    expect(typewriter.getAttribute("aria-pressed")).toBe("true");

    await click(fullscreen);
    expect(app?.classList.contains("fullscreenMode")).toBe(true);
    expect(fullscreen.getAttribute("aria-pressed")).toBe("true");
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

function getButton(host: ParentNode, label: string): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!button) {
    throw new Error(`Missing button "${label}"`);
  }
  return button;
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}
