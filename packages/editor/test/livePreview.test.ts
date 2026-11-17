import { EditorState, Compartment, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { forceParsing } from "@codemirror/language";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSlateMarkdownExtensions,
  findEditorWikiLink,
  knownWikiTargets,
  livePreviewSettings,
} from "../src/index";

const mounted: EditorView[] = [];
function editor(text: string, readOnly = false) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const doc = `${text}\n\nActive`;
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [
        createSlateMarkdownExtensions(),
        EditorState.readOnly.of(readOnly),
        knownWikiTargets.of(new Set(["known"])),
      ],
    }),
  });
  mounted.push(view);
  expect(forceParsing(view, view.state.doc.length, 1000)).toBe(true);
  return view;
}
afterEach(() => {
  for (const view of mounted.splice(0)) {
    const parent = view.dom.parentElement;
    view.destroy();
    parent?.remove();
  }
});

describe("live Markdown decorations", () => {
  it("renders ATX headings, nested emphasis, strike, highlight and inline code without modifying text", () => {
    const raw = "# Heading\n\n**bold** *italic* ~~gone~~ ==sun== `code`";
    const view = editor(raw);
    expect(view.dom.querySelector(".cm-slate-heading-1")?.textContent).toBe(
      "Heading",
    );
    for (const [name, text] of [
      ["strong", "bold"],
      ["emphasis", "italic"],
      ["strike", "gone"],
      ["highlight", "sun"],
      ["inline-code", "code"],
    ])
      expect(view.dom.querySelector(`.cm-slate-${name}`)?.textContent).toBe(
        text,
      );
    expect(view.state.doc.toString()).toBe(`${raw}\n\nActive`);
    view.dispatch({ selection: { anchor: 2 } });
    expect(view.dom.querySelector(".cm-slate-heading-1")?.textContent).toBe(
      "# Heading",
    );
    expect(view.dom.querySelector(".cm-slate-source-marker")?.textContent).toBe(
      "# ",
    );
    expect(undo(view)).toBe(false);
  });

  it("uses parser boundaries so escaped syntax, code, images and metadata do not become live widgets", () => {
    const raw =
      "---\ntitle: **raw**\n---\n\n`**literal** #no [[No]] ==no==`\n\n```md\n# code\n**code** #tag\n```\n\n\\*plain\\* \\#not-tag\n\n![#image](image.png)";
    const view = editor(raw);
    expect(view.dom.querySelectorAll(".cm-slate-frontmatter")).toHaveLength(3);
    expect(
      view.dom.querySelectorAll(
        ".cm-slate-strong, .cm-slate-tag, .cm-slate-wiki-link, .cm-slate-highlight, .cm-slate-heading",
      ),
    ).toHaveLength(0);
    expect(view.dom.textContent).toContain("**literal** #no [[No]] ==no==");
    expect(view.state.doc.toString()).toBe(`${raw}\n\nActive`);
  });

  it("renders inline, reference and automatic links while retaining their URL targets", () => {
    const view = editor(
      '[**site**](https://example.com "title") <https://x.test>\n\n[ref]: https://ref.test\n\n[words][ref]',
    );
    const links = [...view.dom.querySelectorAll<HTMLElement>(".cm-slate-link")];
    expect(
      links.map((link) => [link.textContent, link.dataset.slateHref]),
    ).toEqual([
      ["site", "https://example.com"],
      ["https://x.test", "https://x.test"],
      ["words", "https://ref.test"],
    ]);
    expect(view.dom.querySelector(".cm-slate-strong")?.textContent).toBe(
      "site",
    );
  });

  it("only follows parsed wiki links, never link-looking words inside code or escaped brackets", () => {
    const raw =
      "[[Known|alias]] `[[Code]]` \\[[Escaped]]\n\n```\n[[Fenced]]\n```";
    const view = editor(raw);
    expect(findEditorWikiLink(view, raw.indexOf("alias"))?.target).toBe(
      "Known",
    );
    for (const text of ["Code", "Escaped", "Fenced"])
      expect(findEditorWikiLink(view, raw.indexOf(text))).toBeUndefined();
  });

  it("shows aliases, unresolved wiki targets and tag pills, with source on the caret line", () => {
    const view = editor("[[Known|alias]] [[Missing]] #work/project");
    expect(
      [...view.dom.querySelectorAll(".cm-slate-wiki-link")].map(
        (node) => node.textContent,
      ),
    ).toEqual(["alias", "Missing"]);
    expect(
      view.dom.querySelector(".cm-slate-unresolved-link")?.textContent,
    ).toBe("Missing");
    expect(view.dom.querySelector(".cm-slate-tag")?.textContent).toBe(
      "#work/project",
    );
    view.dispatch({ selection: { anchor: 5 } });
    expect(
      view.dom.querySelectorAll(".cm-slate-wiki-link, .cm-slate-tag"),
    ).toHaveLength(0);
    expect(view.dom.textContent).toContain(
      "[[Known|alias]] [[Missing]] #work/project",
    );
  });

  it("toggles a rendered task with one undo, preserves words and disables read-only checkboxes", () => {
    const view = editor("- [ ] keep these words\n- [x] finished");
    const box = view.dom.querySelector<HTMLButtonElement>(
      '[role="checkbox"][aria-label="keep these words"]',
    )!;
    expect(box.getAttribute("aria-checked")).toBe("false");
    box.click();
    expect(view.state.doc.toString()).toBe(
      "- [x] keep these words\n- [x] finished\n\nActive",
    );
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(
      "- [ ] keep these words\n- [x] finished\n\nActive",
    );
    expect(view.dom.querySelector(".cm-slate-task-done")?.textContent).toBe(
      " finished",
    );
    const locked = editor("- [ ] locked", true);
    const disabled =
      locked.dom.querySelector<HTMLButtonElement>('[role="checkbox"]')!;
    expect(disabled.disabled).toBe(true);
    disabled.click();
    expect(locked.state.doc.toString()).toBe("- [ ] locked\n\nActive");
  });

  it("renders bullets, quote rules and horizontal rules, while showing source on the caret line", () => {
    const view = editor("- bullet\n\n1. numbered\n\n> quote\n\n---");
    expect(view.dom.querySelector(".cm-slate-bullet")?.textContent).toBe("•");
    expect(
      view.dom.querySelector(".cm-slate-ordered-marker")?.textContent,
    ).toBe("1.");
    expect(view.dom.querySelector(".cm-slate-quote-line")?.textContent).toBe(
      "quote",
    );
    expect(view.dom.querySelector('[role="separator"]')).not.toBeNull();
    const rule = view.state.doc.toString().indexOf("---");
    view.dispatch({ selection: { anchor: rule } });
    expect(view.dom.querySelector('[role="separator"]')).toBeNull();
  });

  it("switches syntax visibility and marker contrast without adding undo entries or changing bytes", () => {
    const view = editor("# Heading\n\n**words**");
    const compartment = new Compartment();
    const raw = view.state.doc.toString();
    view.dispatch({
      effects: StateEffect.appendConfig.of(
        compartment.of(
          livePreviewSettings.of({
            hideSyntax: false,
            highContrastMarkers: true,
          }),
        ),
      ),
    });
    expect(view.dom.querySelector(".cm-slate-heading-1")?.textContent).toBe(
      "# Heading",
    );
    expect(view.dom.textContent).toContain("**words**");
    expect(
      view.dom.querySelector(".cm-slate-high-contrast-marker"),
    ).not.toBeNull();
    view.dispatch({
      effects: compartment.reconfigure(
        livePreviewSettings.of({
          hideSyntax: true,
          highContrastMarkers: false,
        }),
      ),
    });
    expect(view.dom.querySelector(".cm-slate-heading-1")?.textContent).toBe(
      "Heading",
    );
    expect(view.state.doc.toString()).toBe(raw);
    expect(undo(view)).toBe(false);
  });
});
