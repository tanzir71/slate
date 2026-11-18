import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { flushSync } from "react-dom";
import { insertEditorBlock, type BlockQuery } from "@slate/editor";
import {
  planBuiltinBlock,
  searchBuiltinBlocks,
  type BlockContext,
  type BlockDefinition,
} from "@slate/core";
import { BlockMenu } from "./BlockMenu";
import {
  BlockResourcePicker,
  type ImportBlockImage,
} from "./BlockResourcePicker";
import {
  createBlockMenuController,
  type BlockMenuAnchor,
} from "./blockMenuController";
import { readBlockUsage } from "./blockUsage";
import "./blockMenu.css";

function clockContext() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
  };
}
interface ResourceRequest {
  id: string;
  input: "language" | "image";
  view: EditorView;
  query: BlockQuery;
  source: string;
}
const keyOf = (query: BlockQuery) => `${query.from}:${query.to}:${query.query}`;

export function useBlockMenu(onImportImage: ImportBlockImage | undefined) {
  const [anchor, setAnchor] = useState<BlockMenuAnchor>();
  const [choice, setChoice] = useState<{ key: string; id: string }>();
  const choiceRef = useRef(choice);
  const [resource, setResource] = useState<ResourceRequest>();
  const [error, setError] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [usage, setUsage] = useState(() => {
    try {
      return readBlockUsage(localStorage.getItem("slate.block-usage"));
    } catch {
      return {};
    }
  });
  const preview = useRef<HTMLElement>(null);
  const listId = `block-results-${useId()}`;
  const handler = useRef<
    (event: KeyboardEvent, view: EditorView, query: BlockQuery) => boolean
  >(() => false);
  const controller = useMemo(
    () =>
      createBlockMenuController(
        (next) => {
          // CodeMirror calls this in its frame's write phase. Commit before that
          // frame paints instead of scheduling another React frame for the menu.
          if (next) flushSync(() => setAnchor(next));
          else {
            setAnchor(undefined);
            setPreviewing(false);
          }
        },
        (...args) => handler.current(...args),
      ),
    [],
  );
  function results(query: BlockQuery, view: EditorView) {
    const ranked = searchBuiltinBlocks(query.query, usage, Date.now()).filter(
      (block) =>
        (block.id !== "image" || onImportImage) &&
        (block.id !== "frontmatter" ||
          query.from === (view.state.sliceDoc(0, 1) === "\uFEFF" ? 1 : 0)),
    );
    return [...new Set(ranked.map((block) => block.group))].flatMap((group) =>
      ranked.filter((block) => block.group === group),
    );
  }
  function choose(id: string, query: BlockQuery) {
    const next = { key: keyOf(query), id };
    if (choiceRef.current?.key === next.key && choiceRef.current.id === id)
      return;
    choiceRef.current = next;
    setChoice(next);
  }
  function used(id: string) {
    const next = {
      ...usage,
      [id]: { count: (usage[id]?.count ?? 0) + 1, lastUsed: Date.now() },
    };
    setUsage(next);
    try {
      localStorage.setItem("slate.block-usage", JSON.stringify(next));
    } catch {
      /* Optional ranking history never blocks writing. */
    }
  }
  function insert(
    id: string,
    view: EditorView,
    query: BlockQuery,
    extra: Pick<BlockContext, "language" | "image"> = {},
    source = view.state.doc.toString(),
  ) {
    controller.close(view);
    if (!view.dom.isConnected) return;
    const plan = insertEditorBlock(
      view,
      id,
      { from: query.from, to: query.to, ...clockContext(), ...extra },
      source,
    );
    if (plan.kind === "insert") {
      setError("");
      used(id);
    } else if (plan.kind === "unavailable") setError(plan.reason);
    else if (plan.input === "language" || plan.input === "image")
      setResource({ id, input: plan.input, view, query, source });
  }
  function keyboard(event: KeyboardEvent, view: EditorView, query: BlockQuery) {
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing)
      return false;
    const matches = results(query, view);
    const current =
      choiceRef.current?.key === keyOf(query)
        ? matches.findIndex((block) => block.id === choiceRef.current?.id)
        : 0;
    if (event.key === "Escape") {
      controller.close(view);
      view.focus();
      return true;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const index =
        (Math.max(0, current) +
          (event.key === "ArrowDown" ? 1 : matches.length - 1)) %
        matches.length;
      if (matches[index]) choose(matches[index]!.id, query);
      return true;
    }
    if (event.key === "Enter") {
      const block = matches[Math.max(0, current)];
      if (block) insert(block.id, view, query);
      return true;
    }
    if (event.key === "Tab") {
      setPreviewing((value) => !value);
      return true;
    }
    return false;
  }
  useLayoutEffect(() => {
    handler.current = keyboard;
  });
  const previewView = anchor?.view;
  useLayoutEffect(() => {
    if (previewing) preview.current?.focus();
    else if (preview.current?.contains(document.activeElement))
      previewView?.focus();
  }, [previewing, previewView]);
  const matches: BlockDefinition[] = anchor ? results(anchor, anchor.view) : [];
  const active =
    matches.find(
      (block) => choice?.key === keyOf(anchor!) && block.id === choice.id,
    ) ?? matches[0];
  const source = anchor?.view.state.doc.toString() ?? "";
  const plan =
    active && anchor
      ? planBuiltinBlock(active.id, {
          source,
          from: anchor.from,
          to: anchor.to,
          language: "javascript",
          image: { path: "assets/image.png" },
          ...clockContext(),
        })
      : undefined;
  const markdown =
    plan?.kind === "insert"
      ? plan.changes
          .map((change) => change.text)
          .join("\n")
          .trim()
      : "";
  useLayoutEffect(() => {
    const content = anchor?.view.contentDOM;
    if (!content) return;
    content.setAttribute("aria-controls", listId);
    content.setAttribute("aria-autocomplete", "list");
    content.setAttribute("aria-haspopup", "listbox");
    if (active)
      content.setAttribute("aria-activedescendant", `${listId}-${active.id}`);
    return () => {
      for (const name of [
        "aria-controls",
        "aria-autocomplete",
        "aria-haspopup",
        "aria-activedescendant",
      ])
        content.removeAttribute(name);
    };
  }, [anchor, active, listId]);
  return {
    extension: controller.extension,
    menu: (
      <>
        {anchor && (
          <BlockMenu
            anchor={anchor}
            results={matches}
            active={active}
            markdown={markdown}
            listId={listId}
            previewRef={preview}
            previewing={previewing}
            onSelect={(id) => choose(id, anchor)}
            onInsert={(id) => insert(id, anchor.view, anchor)}
            onKey={(event) => {
              if (keyboard(event.nativeEvent, anchor.view, anchor)) {
                event.preventDefault();
                event.stopPropagation();
              }
            }}
          />
        )}
        {resource && (
          <BlockResourcePicker
            kind={resource.input}
            onImage={onImportImage}
            onClose={() => {
              setResource(undefined);
              resource.view.focus();
            }}
            onChoose={(extra) => {
              setResource(undefined);
              insert(
                resource.id,
                resource.view,
                resource.query,
                extra,
                resource.source,
              );
            }}
          />
        )}
        {error && (
          <div className="blockMenuError" role="alert">
            {error}
            <button onClick={() => setError("")}>Dismiss</button>
          </div>
        )}
      </>
    ),
  };
}
