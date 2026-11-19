import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  lazy,
  Suspense,
} from "react";
import type { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { flushSync } from "react-dom";
import {
  insertEditorBlock,
  insertEditorBlockAt,
  requestEditorCustomBlock,
  insertEditorCustomBlock,
  type EditorBlockTarget,
  type EditorCustomBlockRequest,
  type BlockQuery,
} from "@slate/editor";
import {
  planBuiltinBlock,
  searchBlockCatalog,
  builtinBlocks,
  type BlockContext,
  type ScopedSnippet,
  type TemplateContext,
  prepareInlineTemplate,
  previewMarkdownTemplate,
  parseSnippetTemplate,
  renderSnippetTemplate,
} from "@slate/core";
import type { SnippetLibrary } from "./snippets/snippetLibrary";
import type { TemplateLibrary } from "./blocks/templateLibrary";
import type { TemplateBlockRequest } from "./blocks/templateSession";
import {
  blockMenuOptionId,
  snippetMenuEntry,
  type CreationMenuEntry,
} from "./blocks/menuCatalog";
import { captureTemplateContext } from "./templates/templateSession";
import { WorkspaceDialog } from "./browser/WorkspaceDialog";
import type { BlockLibrary } from "./blocks/blockLibrary";
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
interface InsertQuery extends BlockQuery {
  target?: EditorBlockTarget;
  selection?: EditorSelection;
}
interface ResourceRequest {
  id: string;
  input: "language" | "image";
  view: EditorView;
  query: InsertQuery;
  source: string;
}
const subscribeEmpty = () => () => undefined;
const getEmpty = () => undefined;
type MenuBlock = CreationMenuEntry;
const TemplateBlockPrompt = lazy(() => import("./blocks/TemplateBlockPrompt"));
export interface BlockMenuNote {
  readonly space: string;
  readonly path: string;
  readonly title: string;
}
export type BlockInsertionContext = TemplateContext & {
  readonly title: string;
};
interface CreationOptions {
  templates?: TemplateLibrary | undefined;
  snippets?: SnippetLibrary | undefined;
  note?: BlockMenuNote | undefined;
  canInsert?: (() => boolean) | undefined;
  onSnippet?:
    | ((
        view: EditorView,
        request: EditorCustomBlockRequest,
        definition: ScopedSnippet,
        separate: boolean,
        context: BlockInsertionContext,
        onInserted: () => void,
      ) => boolean)
    | undefined;
}
const emptyNote: BlockMenuNote = { space: "", path: "", title: "Untitled" };
const keyOf = (query: BlockQuery) => `${query.from}:${query.to}:${query.query}`;

export function useBlockMenu(
  onImportImage: ImportBlockImage | undefined,
  library?: BlockLibrary,
  onManageBlocks?: () => void,
  options: CreationOptions = {},
) {
  const custom = useSyncExternalStore(
    library?.subscribe ?? subscribeEmpty,
    library?.getSnapshot ?? getEmpty,
  );
  const templates = useSyncExternalStore(
    options.templates?.subscribe ?? subscribeEmpty,
    options.templates?.getSnapshot ?? getEmpty,
  );
  const snippets = useSyncExternalStore(
    options.snippets?.subscribe ?? subscribeEmpty,
    options.snippets?.getSnapshot ?? getEmpty,
  );
  const catalog = useMemo<readonly MenuBlock[]>(
    () => [
      ...builtinBlocks,
      ...(custom?.blocks ?? []),
      ...(templates?.items ?? []),
      ...(snippets?.snippets.map(snippetMenuEntry) ?? []),
    ],
    [custom?.blocks, templates?.items, snippets?.snippets],
  );
  const [templatePrompt, setTemplatePrompt] = useState<TemplateBlockRequest>();
  const pending = useRef(false);
  const [anchor, setAnchor] = useState<BlockMenuAnchor & InsertQuery>();
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
          // The controller publishes after CodeMirror's write phase. Commit in
          // that microtask so reconfiguration is safe and no extra frame is needed.
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
    const ranked = searchBlockCatalog(
      catalog,
      query.query,
      usage,
      Date.now(),
    ).filter(
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
    query: InsertQuery,
    extra: Pick<BlockContext, "language" | "image"> = {},
    source = view.state.doc.toString(),
  ) {
    const entry = catalog.find((block) => block.id === id);
    const dynamic = entry && ("source" in entry || "kind" in entry);
    const staleSelection =
      entry &&
      "kind" in entry &&
      query.target &&
      query.selection &&
      !view.state.selection.eq(query.selection);
    if (dynamic && pending.current) return;
    const request = dynamic
      ? requestEditorCustomBlock(view.state, query.target)
      : undefined;
    const context =
      previewContext && active?.id === id
        ? previewContext
        : creationContext(view);
    controller.close(view);
    setAnchor(undefined);
    if (!view.dom.isConnected) return;
    if (dynamic) {
      if (staleSelection) {
        setError("The selection changed. Choose the result again.");
        return;
      }
      if (!request || options.canInsert?.() === false) {
        setError(
          "This position cannot accept an insertion or the Space is read-only.",
        );
        return;
      }
      view.focus();
      pending.current = true;
      void (async () => {
        if ("kind" in entry) {
          if (entry.kind === "snippet") {
            if (!options.snippets || !options.onSnippet)
              throw new Error(
                "Snippets are loading. Choose the snippet again.",
              );
            const definition = await options.snippets.resolve(entry.definition);
            if (options.canInsert?.() === false)
              throw new Error(
                "This Space is read-only. Choose Use here to edit.",
              );
            const accepted = options.onSnippet(
              view,
              request,
              definition,
              !!query.target,
              context,
              () => {
                used(id);
                setError("");
              },
            );
            if (!accepted)
              throw new Error(
                "The sheet changed or is read-only. Choose the snippet again.",
              );
            setError("");
          } else {
            if (!options.templates)
              throw new Error(
                "Templates are loading. Choose the template again.",
              );
            const chosen = await options.templates.resolve(
              id,
              entry.item.template.source,
            );
            const prepared = prepareInlineTemplate(
              chosen.item.template,
              context,
            );
            const target = {
              element: view.contentDOM,
              insert(rendered: NonNullable<typeof prepared.rendered>) {
                if (options.canInsert?.() === false) return false;
                const plan = insertEditorCustomBlock(view, request, {
                  source: rendered.content,
                  ...(rendered.cursor !== undefined
                    ? { cursor: rendered.cursor }
                    : {}),
                });
                if (plan.kind !== "insert") return false;
                used(id);
                setError("");
                return true;
              },
            };
            if (prepared.needsInput) setTemplatePrompt({ ...prepared, target });
            else if (!prepared.rendered || !target.insert(prepared.rendered))
              throw new Error(
                "The sheet changed or is read-only. Choose the template again.",
              );
          }
        } else {
          if (!library)
            throw new Error(
              "Custom blocks are loading. Choose the block again.",
            );
          const block = await library.resolve(id, entry.source);
          const plan = insertEditorCustomBlock(view, request, block);
          if (plan.kind === "insert") {
            setError("");
            used(id);
          } else if (plan.kind === "unavailable") setError(plan.reason);
        }
      })()
        .catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          pending.current = false;
        });
      return;
    }
    const plan = query.target
      ? insertEditorBlockAt(view, query.target, id, {
          ...clockContext(),
          ...extra,
        })
      : insertEditorBlock(
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
  function keyboard(
    event: KeyboardEvent,
    view: EditorView,
    query: InsertQuery,
  ) {
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing)
      return false;
    const matches = results(query, view);
    const current =
      choiceRef.current?.key === keyOf(query)
        ? matches.findIndex((block) => block.id === choiceRef.current?.id)
        : 0;
    if (event.key === "Escape") {
      controller.close(view);
      setAnchor(undefined);
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
    else if (preview.current?.contains(document.activeElement)) {
      if (anchor?.target)
        document
          .querySelector<HTMLInputElement>(".blockMenuSearch input")
          ?.focus();
      else previewView?.focus();
    }
  }, [previewing, previewView, anchor?.target]);
  const matches: MenuBlock[] = anchor ? results(anchor, anchor.view) : [];
  const active =
    matches.find(
      (block) => choice?.key === keyOf(anchor!) && block.id === choice.id,
    ) ?? matches[0];
  function creationContext(view: EditorView): BlockInsertionContext {
    const note = options.note ?? emptyNote,
      selection = view.state.selection.main;
    const notebook = note.path.includes("/")
      ? note.path.slice(0, note.path.lastIndexOf("/"))
      : "";
    return {
      ...captureTemplateContext(
        note.space,
        notebook,
        view.state.sliceDoc(selection.from, selection.to),
      ),
      title: note.title,
    };
  }
  const previewContext = useMemo(
    () =>
      active && "kind" in active && anchor
        ? creationContext(anchor.view)
        : undefined,
    [active, options.note, anchor?.view],
  );
  const creationPreview = useMemo(() => {
    if (!active || !("kind" in active) || !previewContext) return undefined;
    try {
      if (active.kind === "template") {
        const prepared = prepareInlineTemplate(
          active.item.template,
          previewContext,
        );
        return {
          source: previewMarkdownTemplate(active.item.template)
            .replace(/^\uFEFF/, "")
            .replace(/\r\n?|\n/g, "\n"),
          rendered: prepared.rendered?.content,
          error: prepared.error,
        };
      }
      return {
        source: active.definition.body,
        rendered: renderSnippetTemplate(
          parseSnippetTemplate(active.definition.body),
          previewContext,
        ).text,
        error: "",
      };
    } catch (cause) {
      return {
        source: "",
        rendered: undefined,
        error: cause instanceof Error ? cause.message : String(cause),
      };
    }
  }, [active, previewContext]);
  const source = anchor?.view.state.doc.toString() ?? "";
  const plan =
    active && anchor && !("source" in active) && !("kind" in active)
      ? planBuiltinBlock(active.id, {
          source,
          from: anchor.from,
          to: anchor.to,
          separateBlock: Boolean(anchor.target),
          language: "javascript",
          image: { path: "assets/image.png" },
          ...clockContext(),
        })
      : undefined;
  const markdown = creationPreview
    ? creationPreview.source
    : active && "source" in active
      ? active.source.replace(/^\uFEFF/, "").replace(/\r\n?|\n/g, "\n")
      : plan?.kind === "insert"
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
      content.setAttribute(
        "aria-activedescendant",
        blockMenuOptionId(listId, active.id),
      );
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
    openAt(
      view: EditorView,
      target: EditorBlockTarget,
      rect: BlockMenuAnchor["rect"],
    ) {
      controller.close(view);
      setChoice(undefined);
      choiceRef.current = undefined;
      setPreviewing(false);
      setAnchor({
        view,
        target,
        selection: view.state.selection,
        from: target.position,
        to: target.position,
        query: "",
        rect,
      });
    },
    menu: (
      <>
        {anchor && (
          <BlockMenu
            anchor={anchor}
            results={matches}
            active={active}
            markdown={markdown}
            renderedMarkdown={creationPreview?.rendered}
            previewIssue={creationPreview?.error}
            listId={listId}
            previewRef={preview}
            previewing={previewing}
            catalogError={[
              custom?.error,
              templates?.error,
              ...(snippets?.errors ?? []),
            ]
              .filter(Boolean)
              .join(" ")}
            onManage={
              library && onManageBlocks
                ? () => {
                    controller.close(anchor.view);
                    setAnchor(undefined);
                    anchor.view.focus();
                    onManageBlocks();
                  }
                : undefined
            }
            search={
              anchor.target
                ? {
                    value: anchor.query,
                    onChange: (query) => setAnchor({ ...anchor, query }),
                  }
                : undefined
            }
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
        {templatePrompt && (
          <Suspense
            fallback={
              <WorkspaceDialog
                title={`Insert ${templatePrompt.template.name}`}
                returnFocus={templatePrompt.target.element}
                onClose={() => setTemplatePrompt(undefined)}
              >
                <p role="status">Opening template fields…</p>
              </WorkspaceDialog>
            }
          >
            <TemplateBlockPrompt
              request={templatePrompt}
              onClose={() => setTemplatePrompt(undefined)}
            />
          </Suspense>
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
