import { afterEach, expect, it, vi } from "vitest";
import {
  createSnippetInvocation,
  prepareSnippet,
} from "../src/snippets/snippetSession";

afterEach(() => vi.useRealTimers());
it("captures the current source title, notebook, selected text and clock once before prompts", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 19, 9, 30));
  const target = {
    source: "---\ntitle: Current title\n---\n# Other heading",
    selection: "Selected ${2:literal}",
    element: document.createElement("div"),
    insert: vi.fn(),
  };
  const invocation = createSnippetInvocation(
    target,
    "Work",
    "Projects/Plan.md",
  );
  vi.setSystemTime(new Date(2027, 0, 1));
  const prepared = prepareSnippet(invocation, {
    trigger: ";x",
    name: "Test",
    body: "${1:{{title}}} / {{notebook}} / {{selection}} / {{date}} / {{time}}",
    enabled: true,
    expandOn: "tab",
    origin: "space",
  });
  expect(prepared.rendered.text).toBe(
    "Current title / Projects / Selected ${2:literal} / 2026-11-19 / 09:30",
  );
  expect(prepared.rendered.fields.map((field) => field.index)).toEqual([1, 0]);
  expect(prepared.needsInput).toBe(false);
  expect(target.insert).not.toHaveBeenCalled();
});
it("opens explicit input for prompts, clipboard or unresolved variables without inserting on preparation", () => {
  const target = {
    source: "# Title",
    selection: "",
    element: document.createElement("div"),
    insert: vi.fn(),
  };
  const invocation = createSnippetInvocation(target, "Work", "Notes.md");
  for (const body of ["{{prompt:Person|Sam}}", "{{clipboard}}", "{{unknown}}"])
    expect(
      prepareSnippet(invocation, {
        trigger: ";x",
        name: "Test",
        body,
        enabled: true,
        expandOn: "tab",
        origin: "global",
      }).needsInput,
    ).toBe(true);
  expect(target.insert).not.toHaveBeenCalled();
});
