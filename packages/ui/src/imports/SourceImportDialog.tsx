import { useEffect, useRef, useState } from "react";
import { noteImportSources, readNoteImport, type NoteImportPlan, type NoteImportSource } from "@slate/storage/note-import";
import { WorkspaceDialog } from "../browser/WorkspaceDialog";
import "./sourceImport.css";

export interface SourceImportWork { readonly root: string | undefined; run(): Promise<string[]> }
export interface SourceImportResult { readonly root: string; readonly paths: readonly string[]; readonly plan: NoteImportPlan }
export default function SourceImportDialog({ beforeRead, onPrepare, onImported, onClose }: {
  beforeRead?(): Promise<unknown>;
  onPrepare(plan: NoteImportPlan): SourceImportWork;
  onImported(result: SourceImportResult): Promise<void> | void;
  onClose(): void;
}) {
  const [source, setSource] = useState<NoteImportSource>("bear"), [plan, setPlan] = useState<NoteImportPlan>(), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [reading, setReading] = useState(false);
  const [showWarnings, setShowWarnings] = useState(false);
  const input = useRef<HTMLInputElement>(null), folder = useRef<HTMLInputElement>(null), pending = useRef(false), alive = useRef(true), work = useRef<SourceImportWork | undefined>(undefined);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const provider = noteImportSources.find(item => item.id === source)!;
  async function read(files: FileList) {
    if (pending.current) return;
    const selected = Array.from(files, file => ({ path: file.webkitRelativePath || file.name, file }));
    if (!selected.length) return;
    pending.current = true; setBusy(true); setReading(true); setError(""); setPlan(undefined); setShowWarnings(false);
    try {
      await beforeRead?.();
      if (!alive.current) return;
      const next = await readNoteImport(source, selected);
      if (alive.current) { work.current = undefined; setPlan(next); }
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "The export could not be read. Your existing notes were kept."); }
    finally { pending.current = false; if (alive.current) { setBusy(false); setReading(false); } }
  }
  async function commit() {
    if (pending.current || !plan) return;
    pending.current = true; setBusy(true); setError("");
    try {
      work.current ??= onPrepare(plan);
      const paths = await work.current.run(), root = work.current.root;
      if (!root) throw Error("The imported notebook could not be located. Your files were kept.");
      if (!alive.current) return;
      await onImported({ root, paths, plan });
      if (alive.current) onClose();
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "The import could not be completed. Your files were kept."); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  const choose = (files: FileList | null) => { if (files) void read(files); };
  return <WorkspaceDialog title="Import from another app" busy={busy} onClose={onClose} className="sourceImportDialog">
    <div className="sourceImportBody">
    <p>Turn an export into ordinary Markdown files. Everything happens on this device.</p>
    <label>Source application<select value={source} disabled={busy || !!work.current} onChange={event => { setSource(event.target.value as NoteImportSource); setPlan(undefined); setError(""); }}>
      {noteImportSources.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></label>
    <p>{provider.formats}. Use a ZIP/TextPack or choose the whole export folder to include attachments.</p>
    {error && <p role="alert">{error}</p>}
    <div className="sourceImportPickers">
      <button type="button" disabled={busy || !!work.current} onClick={() => input.current?.click()}>Choose export files</button>
      <button type="button" disabled={busy || !!work.current} onClick={() => folder.current?.click()}>Choose export folder</button>
    </div>
    <input ref={input} type="file" multiple accept=".md,.markdown,.zip,.textpack,.html,.htm,.enex,.csv" className="visuallyHidden" aria-label="Choose export files" onChange={event => { choose(event.currentTarget.files); event.currentTarget.value = ""; }} />
    <input ref={node => { folder.current = node; node?.setAttribute("webkitdirectory", ""); }} type="file" multiple className="visuallyHidden" aria-label="Choose export folder" onChange={event => { choose(event.currentTarget.files); event.currentTarget.value = ""; }} />
    {plan && <section aria-label="Import preview" aria-live="polite">
      <h3>{plan.notes.length} {plan.notes.length === 1 ? "note" : "notes"} · {Object.keys(plan.entries).length - plan.notes.length} other files</h3>
      <p>A new notebook named “{plan.label}” will keep these files together. Existing notes will be kept. Original HTML and ENEX exports stay with their converted notes.</p>
      <ul>{plan.notes.slice(0, 8).map(path => <li key={path}>{path}</li>)}</ul>
      {plan.notes.length > 8 && <p>And {plan.notes.length - 8} more notes.</p>}
      {plan.warnings.length > 0 && <details open><summary>{plan.warnings.length} {plan.warnings.length === 1 ? "import note" : "import notes"}</summary><ul>{(showWarnings ? plan.warnings : plan.warnings.slice(0, 20)).map(warning => <li key={warning}>{warning}</li>)}</ul>{!showWarnings && plan.warnings.length > 20 && <button type="button" onClick={() => setShowWarnings(true)}>Show all {plan.warnings.length} import notes</button>}</details>}
    </section>}
    {busy && <p role="status">{reading ? "Reading your export…" : "Importing your notes…"}</p>}
    </div>
    <div className="dialogActions"><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button type="button" className="primaryButton" disabled={busy || !plan} onClick={() => { void commit(); }}>{work.current ? "Retry import" : "Import notes"}</button></div>
  </WorkspaceDialog>;
}
