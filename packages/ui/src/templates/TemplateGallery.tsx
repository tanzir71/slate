import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import {
  analyzeMarkdownTemplate,
  planTemplateFile,
  previewMarkdownTemplate,
  readMarkdownTemplate,
  renderMarkdownTemplate,
  type TemplateContext,
} from "@slate/core";
import {
  readSpaceTemplates,
  saveSpaceTemplate,
  type SpaceTemplateRecord,
} from "@slate/storage/browser-space";
import { WorkspaceDialog } from "../browser/WorkspaceDialog";
import type { WorkspaceStore } from "../browser/workspaceStore";
import { shortcutOS } from "../commands";
import { builtinTemplates, type TemplateCatalogItem } from "./builtinTemplates";
import { captureTemplateContext } from "./templateSession";
import "./templateGallery.css";

const icons = {
  plus: new URL("../assets/templates/plus.svg", import.meta.url).href,
  search: new URL("../assets/templates/search.svg", import.meta.url).href,
  close: new URL("../assets/templates/close.svg", import.meta.url).href,
  clock: new URL("../assets/templates/clock.svg", import.meta.url).href,
  feather: new URL("../assets/templates/feather.svg", import.meta.url).href,
  briefcase: new URL("../assets/templates/briefcase.svg", import.meta.url).href,
  code: new URL("../assets/templates/code.svg", import.meta.url).href,
  calendar: new URL("../assets/templates/calendar.svg", import.meta.url).href,
  star: new URL("../assets/templates/star.svg", import.meta.url).href,
  folder: new URL("../assets/templates/folder.svg", import.meta.url).href,
  chevron: new URL("../assets/templates/chevron-down.svg", import.meta.url)
    .href,
};
function Icon({ name }: { name: keyof typeof icons }) {
  return (
    <span
      aria-hidden="true"
      className="templateIcon"
      style={{ maskImage: 'url("' + icons[name] + '")' } as CSSProperties}
    />
  );
}
const categories = [
  { name: "Recent", icon: "clock" },
  { name: "Writing", icon: "feather" },
  { name: "Work", icon: "briefcase" },
  { name: "Engineering", icon: "code" },
  { name: "Personal", icon: "calendar" },
] as const;
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const newSource =
  '---\ntemplate:\n  name: My template\n  description: A starting point for your notes\n  category: Work\n  filename: "{{title|slug}}"\ntitle: "{{title}}"\ndate: "{{date:YYYY-MM-DD}}"\n---\n\n# {{title}}\n\n{{cursor}}';
function recentTemplates(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === "string").slice(0, 12)
      : [];
  } catch {
    return [];
  }
}

export default function TemplateGallery({
  store,
  notebook,
  selection,
  returnFocus,
  onClose,
}: {
  store: WorkspaceStore;
  notebook: string;
  selection: string;
  returnFocus: HTMLElement | undefined;
  onClose(): void;
}) {
  const [context] = useState(() =>
    captureTemplateContext(
      store.api.getState().record.name,
      notebook,
      selection,
    ),
  );
  const recentKey =
    "slate.templates.recent.v1." + store.api.getState().record.id;
  const [recent, setRecent] = useState(() => recentTemplates(recentKey));
  const [records, setRecords] = useState<SpaceTemplateRecord[]>([]);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("Work");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(builtinTemplates[0]!.id);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(context.clock!.date);
  const [destination, setDestination] = useState<string>();
  const [prompts, setPrompts] = useState<Record<string, string>>({});
  const [clipboard, setClipboard] = useState("");
  const [editing, setEditing] = useState<string>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const titleInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const items = useMemo(
    () => [
      ...builtinTemplates,
      ...records.flatMap((record): TemplateCatalogItem[] =>
        record.template
          ? [
              {
                id: record.path,
                path: record.path,
                origin: "space",
                template: record.template,
              },
            ]
          : [],
      ),
    ],
    [records],
  );
  const selected = items.find((item) => item.id === selectedId);
  const broken = records.find(
    (record) => record.path === selectedId && record.error,
  );
  const definition = useMemo(
    () => selected && analyzeMarkdownTemplate(selected.template),
    [selected],
  );
  const variables: TemplateContext = {
    ...context,
    title,
    notebook: destination ?? notebook,
    clipboard,
    prompts,
    clock: { ...context.clock!, date },
  };
  const rendered = useMemo(() => {
    if (!selected) return undefined;
    try {
      const output = renderMarkdownTemplate(selected.template, variables);
      return { output, error: "" };
    } catch (error) {
      return { output: undefined, error: message(error) };
    }
  }, [
    selected,
    context,
    title,
    destination,
    notebook,
    clipboard,
    prompts,
    date,
  ]);
  const visible = items
    .filter((item) => {
      const inCategory =
        query ||
        (category === "Recent"
          ? recent.includes(item.id)
          : item.template.category === category);
      return (
        inCategory &&
        (
          item.template.name +
          " " +
          item.template.description +
          " " +
          item.template.category
        )
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase().trim())
      );
    })
    .sort((left, right) =>
      category === "Recent" && !query
        ? recent.indexOf(left.id) - recent.indexOf(right.id)
        : 0,
    );
  const folders = [
    ...new Set([
      notebook,
      ...store.api
        .getState()
        .sheets.map((sheet) => sheet.path.split("/").slice(0, -1).join("/")),
    ]),
  ].sort();
  const knownCategories = [
    ...new Set([
      ...categories.map((entry) => entry.name),
      ...items.map((item) => item.template.category),
    ]),
  ];

  async function load() {
    setLoading(true);
    try {
      const next = await readSpaceTemplates(store.space);
      if (alive.current) {
        setRecords(next);
        setLoadError("");
      }
    } catch (error) {
      if (alive.current) setLoadError(message(error));
    } finally {
      if (alive.current) setLoading(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, [store]);

  function select(id: string) {
    setSelectedId(id);
    setEditing(undefined);
    setError("");
    setNotice("");
    setPrompts({});
    setDestination(undefined);
  }
  function chooseCategory(name: string) {
    setCategory(name);
    setQuery("");
    setEditing(undefined);
    const first =
      name === "Recent"
        ? recent.find((id) => items.some((item) => item.id === id))
        : items.find((item) => item.template.category === name)?.id;
    if (first) select(first);
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    if (!selected || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const plan = planTemplateFile(
        selected.template,
        variables,
        destination === undefined ? {} : { destination },
      );
      await store.createFromTemplate(plan);
      const next = [
        selected.id,
        ...recent.filter((id) => id !== selected.id),
      ].slice(0, 12);
      setRecent(next);
      try {
        localStorage.setItem(recentKey, JSON.stringify(next));
      } catch {
        /* Recents are optional view preferences. */
      }
      onClose();
    } catch (error) {
      setError(message(error));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function save() {
    if (editing === undefined || locked.current || loading) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const current = records.find((record) => record.path === selectedId);
      const saved = await saveSpaceTemplate(
        store.space,
        editing,
        current ? { path: current.path, baseContent: current.source } : {},
      );
      const template = readMarkdownTemplate(saved.content, "My template");
      const record = {
        path: saved.path,
        source: saved.content,
        template,
        error: undefined,
      };
      setRecords((previous) =>
        [...previous.filter((row) => row.path !== saved.path), record].sort(
          (a, b) => a.path.localeCompare(b.path),
        ),
      );
      select(saved.path);
      setCategory(template.category);
      setNotice(
        saved.conflict
          ? "The external edit was kept. Your template is saved as a conflict copy."
          : "Saved to " + saved.path,
      );
    } catch (error) {
      setError(message(error));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function readClipboard() {
    try {
      const text = await navigator.clipboard?.readText();
      if (text === undefined) throw new Error("Clipboard unavailable");
      setClipboard(text);
      setError("");
    } catch {
      setError(
        "Clipboard access was unavailable. Paste its text into the Clipboard field.",
      );
    }
  }
  return (
    <WorkspaceDialog
      title="New from template"
      className="templateGallery"
      onClose={onClose}
      busy={busy}
      initialFocus={titleInput}
      returnFocus={returnFocus}
      closeIcon={<Icon name="close" />}
      headerActions={
        <div className="templateSearch">
          <Icon name="search" />
          <input
            ref={searchInput}
            aria-label="Search templates"
            placeholder={"Search " + items.length + " templates"}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd>{shortcutOS() === "mac" ? "⌘ F" : "Ctrl F"}</kbd>
        </div>
      }
    >
      <div
        className="templateBody"
        onKeyDown={(event) => {
          if (
            (event.metaKey || event.ctrlKey) &&
            event.key.toLowerCase() === "f"
          ) {
            event.preventDefault();
            searchInput.current?.focus();
          }
        }}
      >
        <nav className="templateCategories" aria-label="Template categories">
          <div className="templateCategoryRows">
            {knownCategories.map((name) => (
              <button
                key={name}
                disabled={busy}
                aria-pressed={name === category && !query}
                onClick={() => chooseCategory(name)}
              >
                <Icon
                  name={
                    categories.find((entry) => entry.name === name)?.icon ??
                    "folder"
                  }
                />
                <span>{name}</span>
                <small>
                  {name === "Recent"
                    ? recent.filter((id) =>
                        items.some((item) => item.id === id),
                      ).length
                    : items.filter((item) => item.template.category === name)
                        .length}
                </small>
              </button>
            ))}
          </div>
          <div className="templateMyHeading">
            <span>My templates</span>
            <button
              aria-label="Add template"
              disabled={busy || loading}
              onClick={() => {
                select("new");
                setEditing(newSource);
              }}
            >
              <Icon name="plus" />
            </button>
          </div>
          <div className="templateMyRows">
            {records.map((record) => (
              <button
                key={record.path}
                disabled={busy}
                title={record.path}
                aria-pressed={selectedId === record.path}
                onClick={() => select(record.path)}
              >
                <Icon name="star" />
                <span>
                  {record.template?.name ?? record.path.split("/").at(-1)}
                </span>
                {record.error && <span aria-label="Invalid template">!</span>}
              </button>
            ))}
          </div>
          <p className="templateDiskHint">
            Templates are .md files in
            <br />
            <code>.slate/templates/</code>
          </p>
        </nav>
        <section className="templateGridPanel" aria-label="Templates">
          <h3>{query ? "Search results" : category}</h3>
          {loading && <p role="status">Reading Space templates…</p>}
          {loadError && (
            <p role="alert">
              Space templates could not be read: {loadError}{" "}
              <button onClick={() => void load()} disabled={busy || loading}>
                Retry
              </button>
            </p>
          )}
          <div className="templateCards">
            {visible.map((item) => (
              <button
                type="button"
                className="templateCard"
                key={item.id}
                disabled={busy}
                aria-pressed={selectedId === item.id}
                onClick={() => select(item.id)}
              >
                <span className="templateThumbnail" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
                <span className="templateCardText">
                  <strong>{item.template.name}</strong>
                  <span>{item.template.description}</span>
                </span>
              </button>
            ))}
          </div>
          {!visible.length && !loading && (
            <p className="quiet">
              {query
                ? "No templates match your search."
                : category === "Recent"
                  ? "Templates you use will appear here."
                  : "No templates in this category."}
            </p>
          )}
        </section>
        <section className="templateDetail" aria-label="Template details">
          <div className="templateDetailTitle">
            <h3>
              {editing !== undefined && selectedId === "new"
                ? "My template"
                : (selected?.template.name ??
                  broken?.path.split("/").at(-1) ??
                  "Choose a template")}
            </h3>
            {selected && (
              <small>
                {selected.origin === "built-in" ? "built-in" : "Space"}
              </small>
            )}
          </div>
          {editing !== undefined ? (
            <>
              <p className="templateEditHint">
                {selected?.origin === "built-in"
                  ? "Save a copy in this Space to customize this built-in."
                  : "Edit plain Markdown and optional template properties."}
              </p>
              <label className="templateSourceEditor">
                Template source
                <textarea
                  spellCheck={false}
                  value={editing}
                  onChange={(event) => setEditing(event.target.value)}
                  disabled={busy}
                />
              </label>
              <div className="templateFooter">
                <button disabled={busy} onClick={() => setEditing(undefined)}>
                  Cancel edit
                </button>
                <button
                  className="primaryButton"
                  disabled={busy || loading}
                  onClick={() => void save()}
                >
                  {busy ? "Saving…" : "Save template"}
                </button>
              </div>
            </>
          ) : selected ? (
            <>
              <pre
                className="templateSource"
                role="region"
                tabIndex={0}
                aria-label="Template Markdown"
              >
                {previewMarkdownTemplate(selected.template)
                  .split(/(\{\{[^{}]*\}\})/g)
                  .map((text, index) =>
                    text.startsWith("{{") ? (
                      <span className="templateVariable" key={index}>
                        {text}
                      </span>
                    ) : (
                      text
                    ),
                  )}
              </pre>
              <form
                id="templateCreate"
                onSubmit={(event) => void create(event)}
                className="templateFields"
              >
                <h4>Fill in</h4>
                <label>
                  Title
                  <input
                    ref={titleInput}
                    value={title}
                    required
                    placeholder="Give your note a title"
                    disabled={busy}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </label>
                <label>
                  Date
                  <input
                    type="date"
                    value={date}
                    required
                    disabled={busy}
                    onChange={(event) => setDate(event.target.value)}
                  />
                </label>
                <label>
                  Notebook
                  <span className="templateNotebook">
                    <Icon name="folder" />
                    <input
                      aria-label="Notebook"
                      list="templateNotebooks"
                      value={
                        destination ?? rendered?.output?.destination ?? notebook
                      }
                      disabled={busy}
                      onChange={(event) => setDestination(event.target.value)}
                    />
                    <Icon name="chevron" />
                  </span>
                </label>
                <datalist id="templateNotebooks">
                  {folders.map((folder) => (
                    <option key={folder} value={folder} />
                  ))}
                </datalist>
                {definition?.prompts.map((prompt) => (
                  <label key={prompt.label}>
                    {prompt.label}
                    <input
                      value={prompts[prompt.label] ?? prompt.defaultValue ?? ""}
                      disabled={busy}
                      onChange={(event) =>
                        setPrompts({
                          ...prompts,
                          [prompt.label]: event.target.value,
                        })
                      }
                    />
                  </label>
                ))}
                {definition?.variables.includes("clipboard") && (
                  <label>
                    Clipboard
                    <textarea
                      aria-label="Clipboard"
                      value={clipboard}
                      onChange={(event) => setClipboard(event.target.value)}
                      disabled={busy}
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void readClipboard()}
                    >
                      Read clipboard
                    </button>
                  </label>
                )}
              </form>
              {rendered?.error && <p role="alert">{rendered.error}</p>}
              {!!rendered?.output?.issues.length && (
                <p className="templateWarning">
                  Unresolved variables stay in the new note:{" "}
                  {[
                    ...new Set(
                      rendered.output.issues.map((entry) => entry.issue.raw),
                    ),
                  ].join(", ")}
                </p>
              )}
              <div className="templateFooter">
                <button
                  disabled={busy || loading}
                  onClick={() => {
                    setError("");
                    setEditing(selected.template.source);
                  }}
                >
                  Edit template
                </button>
                <button
                  form="templateCreate"
                  type="submit"
                  className="primaryButton"
                  disabled={busy || !!rendered?.error}
                >
                  {busy ? "Creating…" : "Create ↵"}
                </button>
              </div>
            </>
          ) : broken ? (
            <>
              <p role="alert">
                This template could not be read: {broken.error}. Its original
                file is unchanged.
              </p>
              {broken.source !== undefined && (
                <button
                  disabled={busy || loading}
                  onClick={() => setEditing(broken.source)}
                >
                  Repair template
                </button>
              )}
            </>
          ) : (
            <p>Choose a template to preview its Markdown and create a note.</p>
          )}
          {error && (
            <p role="alert" className="templateError">
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
        </section>
      </div>
    </WorkspaceDialog>
  );
}
