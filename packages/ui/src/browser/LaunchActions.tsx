import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { parseLaunchActionParameters, templateOutputPath, type LaunchAction } from "@slate/core";
import { addBrowserImportEntry } from "@slate/storage/browser-import";
import type { WorkspaceStore } from "./workspaceStore";
import type { EditorDocumentPool } from "./editorDocumentPool";
import { createLaunchAppendSession } from "./launchAppendSession";
import { WorkspaceDialog } from "./WorkspaceDialog";

interface QueuedLaunch { targetURL?: string; files?: readonly { getFile(): Promise<File> }[] }
interface LaunchQueueWindow extends Window {
  launchQueue?: { setConsumer(consumer: (launch: QueuedLaunch) => void): void };
}
export interface LaunchTemplateRequest {
  readonly template: string;
  readonly title?: string | undefined;
  readonly notebook?: string | undefined;
  readonly text?: string | undefined;
}
const message = (error: unknown) => error instanceof Error ? error.message : "The action failed. Your files were kept.";
function parseRequest(url: URL, files: File[] = []) {
  const params = url.searchParams;
  try {
    if (url.origin !== location.origin || url.pathname !== location.pathname)
      throw new Error("Open a link for this Slate app. Your files were kept.");
    return { action: parseLaunchActionParameters(params), error: "", params, files };
  } catch (error) { return { action: undefined, error: message(error), params, files: [] }; }
}
type Request = ReturnType<typeof parseRequest> & { id: number };
interface LaunchProps {
  store: WorkspaceStore; pool: EditorDocumentPool;
  onSearch(query: string): void;
  onTemplate(request: LaunchTemplateRequest): Promise<void>;
  templatesReady: boolean;
  onSwitchSpace(): Promise<void>;
  onTakeover(): Promise<void>;
  onDialogChange(open: boolean): void;
  onNavigate(): void;
}
function actionText(action: LaunchAction | undefined) { return action && "text" in action ? action.text : ""; }

/** Links review writes; read actions and template previews use existing workspace flows. */
export function LaunchActions(props: LaunchProps) {
  const [initialURL] = useState(() => new URL(location.href));
  const [current, setCurrent] = useState<Request | undefined>(() => {
    const request = parseRequest(initialURL);
    return request.action || request.error ? { ...request, id: 0 } : undefined;
  });
  const active = useRef(current), queue = useRef<Request[]>([]), serial = useRef(0);
  const [waiting, setWaiting] = useState(0);
  function activate(entry: Request) {
    // Keep an incoming confirmation recoverable across reload or Space switch.
    const url = new URL(location.href); url.search = entry.params.toString();
    history.replaceState(history.state, "", url);
    active.current = entry; setCurrent(entry);
  }
  useEffect(() => {
    let mounted = true, first = true, pending = Promise.resolve();
    function enqueue(request: ReturnType<typeof parseRequest>) {
      if (!mounted || !request.action && !request.error && !request.files.length) return;
      const entry = { ...request, id: ++serial.current };
      if (!active.current && !queue.current.length) activate(entry);
      else { queue.current.push(entry); setWaiting(queue.current.length); }
    }
    (window as LaunchQueueWindow).launchQueue?.setConsumer(launch => {
      const firstDelivery = first; first = false;
      // Resolve file handles in delivery order. Later launches never replace a
      // confirmation or words already being reviewed in the current request.
      pending = pending.then(async () => {
        try {
          const url = new URL(launch.targetURL ?? location.href);
          if (!launch.targetURL) url.search = "";
          if (firstDelivery && active.current?.id === 0 && !launch.files?.length && url.origin === initialURL.origin
            && url.pathname === initialURL.pathname && url.search === initialURL.search) return;
          const files = await Promise.all((launch.files ?? []).map(handle => handle.getFile()));
          enqueue(parseRequest(url, files));
        } catch (failure) {
          enqueue({ action: undefined, error: message(failure), params: new URLSearchParams(), files: [] });
        }
      });
    });
    return () => { mounted = false; };
  }, [initialURL]);
  function finish(id: number) {
    if (active.current?.id !== id) return;
    active.current = undefined; setCurrent(undefined);
    if (new URLSearchParams(location.search).toString() === current?.params.toString()) {
      const url = new URL(location.href);
      for (const key of ["action", "space", "notebook", "title", "text", "url", "template", "path", "query", "q"]) url.searchParams.delete(key);
      history.replaceState(history.state, "", url);
    }
  }
  function next() {
    if (active.current) return;
    const entry = queue.current.shift();
    if (entry) activate(entry);
    setWaiting(queue.current.length);
  }
  return <>
    {waiting > 0 && <div className="notice" role="status">{waiting} incoming {waiting === 1 ? "request" : "requests"} waiting.
      <button type="button" disabled={!!current} onClick={next}>Review next request</button></div>}
    {current && <LaunchRequest key={current.id} {...props} request={current} onDone={() => finish(current.id)} />}
  </>;
}

function LaunchRequest({ store, pool, onSearch, onTemplate, templatesReady, onSwitchSpace, onTakeover, onDialogChange, onNavigate, request: initial, onDone }: LaunchProps & {
  request: Request; onDone(): void;
}) {
  const [action] = useState(initial.action);
  const [text, setText] = useState(() => actionText(initial.action));
  const [title, setTitle] = useState(() => initial.action?.kind === "new" ? initial.action.title : "Untitled");
  const [notebook, setNotebook] = useState(() => initial.action?.kind === "new" ? initial.action.notebook : "Inbox");
  const [files, setFiles] = useState<File[]>(initial.files), [busy, setBusy] = useState(false), [error, setError] = useState(initial.error);
  const owned = useStore(store.api, state => state.owned);
  const locked = useRef(false), autoStarted = useRef(false);
  const append = useRef<ReturnType<typeof createLaunchAppendSession> | undefined>(undefined);
  const capturePath = useRef<string | undefined>(undefined);
  const wrongSpace = !!action?.space && action.space !== store.api.getState().record.id;
  const template = action?.kind === "new" ? action.template : undefined;
  const readAction = action?.kind === "open" || action?.kind === "search" || !!template;
  const writing = files.length > 0 || action?.kind === "new" && !template || action?.kind === "append" || action?.kind === "capture" || action?.kind === "today";

  function dismiss() {
    onDone();
  }
  async function confirm() {
    if (locked.current || wrongSpace || (!action && !files.length)) return;
    locked.current = true; setBusy(true); setError("");
    try {
      if (writing && !store.api.getState().owned) throw new Error("This Space is read-only. Choose Use here to edit.");
      if (files.length) {
        const entries: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>;
        for (const file of files) addBrowserImportEntry(entries, file.name, new Uint8Array(await file.arrayBuffer()));
        await store.importFiles(entries);
      } else if (action?.kind === "new") {
        if (action.template) {
          await onTemplate({ template: action.template,
            title: initial.params.has("title") ? action.title : undefined,
            notebook: initial.params.has("notebook") ? action.notebook : undefined,
            text: initial.params.has("text") ? action.text : undefined });
        } else {
          const parsed = parseLaunchActionParameters([["action", "new"], ["title", title], ["notebook", notebook], ["text", text]]);
          if (parsed?.kind !== "new") throw new Error("Review the new sheet before saving.");
          await store.createPlanned({ path: templateOutputPath(parsed.notebook, parsed.title), content: parsed.text });
        }
      } else if (action?.kind === "today") await store.openToday();
      else if (action?.kind === "open") { await store.openSheet(action.path); onNavigate(); }
      else if (action?.kind === "search") { dismiss(); onSearch(action.query); return; }
      else if (action?.kind === "append" || action?.kind === "capture") {
        if (!text) throw new Error("Enter text before saving.");
        if (!append.current) {
          let path = action.kind === "append" ? action.path : capturePath.current ?? "Inbox/Capture.md";
          if (action.kind === "capture" && await store.space.read(path) === undefined) {
            const sheet = await store.createPlanned({ path, content: "" });
            path = sheet.path; capturePath.current = path;
          }
          append.current = createLaunchAppendSession(store, pool, path, action.kind === "capture" ? text + "\n" : text);
        }
        await append.current.apply();
        onNavigate();
      } else return;
      dismiss();
    } catch (failure) { setError(message(failure)); }
    finally { locked.current = false; setBusy(false); }
  }
  useEffect(() => {
    if (!readAction || wrongSpace || files.length || locked.current || autoStarted.current || template && !templatesReady) return;
    autoStarted.current = true;
    void confirm();
  });
  async function takeOver() {
    if (locked.current) return;
    locked.current = true; setBusy(true);
    try { await onTakeover(); setError(""); }
    catch (failure) { setError(message(failure)); }
    finally { locked.current = false; setBusy(false); }
  }

  const visible = !!(action || files.length || error)
    && !(readAction && !files.length && !error && !wrongSpace && (!template || templatesReady));
  useLayoutEffect(() => {
    onDialogChange(visible);
    return () => onDialogChange(false);
  }, [visible, onDialogChange]);
  if (!visible) return null;
  const heading = files.length ? "Import opened Markdown files?" : action?.kind === "capture" ? "Capture a thought"
    : action?.kind === "today" ? "Open today’s note?" : action?.kind === "append" ? "Append to this sheet?"
    : action?.kind === "new" && !template ? "Create a new sheet?" : action?.kind === "open-files" ? "Open Markdown files" : "Open in Slate";
  const retained = append.current?.hasApplied() ?? false;
  return <WorkspaceDialog title="Open in Slate" busy={busy} onClose={dismiss} headerContent={<header><h2>{heading}</h2></header>}>
    <form onSubmit={event => { event.preventDefault(); void confirm(); }}>
      {wrongSpace && <p role="alert">This link targets another Space. Switch Spaces to continue.</p>}
      {wrongSpace && <button type="button" disabled={busy} onClick={() => void onSwitchSpace().catch(failure => setError(message(failure)))}>Switch Space</button>}
      {files.length > 0 && <p>{files.map(file => file.name).join(", ")}. Existing files will be kept.</p>}
      {action?.kind === "open-files" && !files.length && <label>Choose Markdown files<input type="file" accept=".md" multiple disabled={busy} onChange={event => setFiles(Array.from(event.target.files ?? []))} /></label>}
      {action?.kind === "new" && !template && <>
        <label>Title<input aria-label="Title" value={title} disabled={busy} onChange={event => setTitle(event.target.value)} required /></label>
        <label>Notebook<input aria-label="Notebook" value={notebook} disabled={busy} onChange={event => setNotebook(event.target.value)} /></label>
        <label>Text<textarea aria-label="New sheet text" rows={6} value={text} disabled={busy} onChange={event => setText(event.target.value)} /></label>
      </>}
      {(action?.kind === "capture" || action?.kind === "append") && <>
        {action.kind === "append" && <p>Append to {action.path}. Existing words will be kept.</p>}
        <label>{action.kind === "capture" ? "Save to Inbox" : "Text to append"}<textarea autoFocus aria-label={action.kind === "capture" ? "Capture text" : "Text to append"}
          rows={6} value={text} disabled={busy || retained} onChange={event => { setText(event.target.value); append.current = undefined; }} required /></label>
      </>}
      {template && !templatesReady && <p role="status">Loading templates…</p>}
      {writing && !owned && <p>This Space is read-only. <button type="button" disabled={busy} onClick={() => void takeOver()}>Use here</button></p>}
      {error && <p role="alert">{error}</p>}
      <div className="dialogActions"><button type="button" onClick={dismiss} disabled={busy}>Cancel</button>
        <button type="submit" className="primaryButton" disabled={busy || wrongSpace || writing && !owned || (!action && !files.length) || action?.kind === "open-files" && !files.length || !!template && !templatesReady}>
          {busy ? "Saving…" : retained ? "Retry saving" : files.length ? "Import" : action?.kind === "capture" ? "Save to Inbox" : "Continue"}
        </button>
      </div>
    </form>
  </WorkspaceDialog>;
}
