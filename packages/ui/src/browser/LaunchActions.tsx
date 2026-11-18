import { useEffect, useState } from "react";
import { addBrowserImportEntry } from "@slate/storage/browser-import";
import type { WorkspaceStore } from "./workspaceStore";

interface LaunchQueueWindow extends Window {
  launchQueue?: { setConsumer(consumer: (launch: { files: { getFile(): Promise<File> }[] }) => void): void };
}

/** Browser/PWA entry points always require an explicit action before writing. */
export function LaunchActions({ store }: { store: WorkspaceStore }) {
  const [action, setAction] = useState(() => {
    const value = new URLSearchParams(location.search).get("action");
    return value && ["new", "today", "capture"].includes(value) ? value : "";
  });
  const [text, setText] = useState(() => {
    const params = new URLSearchParams(location.search);
    return [params.get("title"), params.get("text"), params.get("url")].filter(Boolean).join("\n\n");
  });
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (window as LaunchQueueWindow).launchQueue?.setConsumer((launch) => {
      void Promise.all(launch.files.map((handle) => handle.getFile())).then((opened) => {
        if (active) setFiles(opened);
      }).catch(() => { if (active) setError("The opened file could not be read."); });
    });
    return () => { active = false; };
  }, []);

  function dismiss() {
    setAction("");
    setFiles([]);
    const url = new URL(location.href);
    for (const key of ["action", "title", "text", "url"]) url.searchParams.delete(key);
    history.replaceState(null, "", url);
  }

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      if (files.length) {
        const entries: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>;
        for (const file of files) addBrowserImportEntry(entries, file.name, new Uint8Array(await file.arrayBuffer()));
        await store.importFiles(entries);
      } else if (action === "new") await store.create();
      else if (action === "today") await store.openToday();
      else {
        await store.flush();
        const path = "Inbox/Capture.md";
        const previous = await store.space.read(path);
        const saved = await store.space.save(path, `${previous ?? ""}${previous ? "\n\n" : ""}${text}\n`, previous);
        await store.refresh();
        await store.select(saved.path);
      }
      if (action !== "today") store.notifySaved();
      dismiss();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The action failed. Your files were kept."); }
    finally { setBusy(false); }
  }

  if (!action && !files.length && !error) return null;
  return <div className="modalBackdrop"><form className="browserDialog" role="dialog" aria-modal="true" aria-label="Open in Slate" onSubmit={(event) => { event.preventDefault(); void confirm(); }}>
    <h2>{files.length ? "Import opened Markdown files?" : action === "capture" ? "Capture a thought" : action === "today" ? "Open today’s note?" : "Create a new sheet?"}</h2>
    {files.length > 0 && <p>{files.map((file) => file.name).join(", ")}. Existing files will be kept.</p>}
    {action === "capture" && <label>Save to Inbox<textarea autoFocus aria-label="Capture text" rows={6} value={text} onChange={(event) => setText(event.target.value)} required /></label>}
    {error && <p role="alert">{error}</p>}
    <div className="dialogActions"><button type="button" onClick={dismiss} disabled={busy}>Cancel</button><button type="submit" className="primaryButton" disabled={busy}>{busy ? "Saving…" : files.length ? "Import" : action === "capture" ? "Save to Inbox" : "Continue"}</button></div>
  </form></div>;
}
