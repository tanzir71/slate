import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { prepareReplaceBatch, type ReplaceBatchRow, type ReplaceBatchSession } from "@slate/storage/replace-batch";
import type { WorkspaceStore } from "../browser/workspaceStore";
import { WorkspaceDialog } from "../browser/WorkspaceDialog";
import { ReplacementPreview, replacementSelectable } from "./ReplacementPreview";
import { useWorkspaceSearch } from "./useWorkspaceSearch";
import "./search.css";

export default function WorkspaceSearchDialog({ store, returnFocus, onChoose, onClose }: {
  store: WorkspaceStore; returnFocus?: HTMLElement | undefined;
  onChoose(path: string, target?: { source: string; position: number }): Promise<void>; onClose(): void;
}) {
  const sheets = useStore(store.api, (state) => state.sheets), owned = useStore(store.api, (state) => state.owned);
  const canUndo = useStore(store.api, (state) => state.hasReplaceBatchUndo);
  const [query, setQuery] = useState(""), [replacement, setReplacement] = useState(""), [matchCase, setMatchCase] = useState(false);
  const [retry, setRetry] = useState(0), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false), [progress, setProgress] = useState(0);
  const [batch, setBatch] = useState<ReplaceBatchSession>(), [rows, setRows] = useState<readonly ReplaceBatchRow[]>([]);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const input = useRef<HTMLInputElement>(null), alive = useRef(false), working = useRef(false), reviewing = useRef(false), generation = useRef(0);
  const search = useWorkspaceSearch(sheets, query, matchCase, retry);
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  function invalidatePreview() {
    generation.current++; reviewing.current = false; setChecking(false); setBatch(undefined); setRows([]); setChosen(new Set()); setError("");
  }
  async function choose(path: string, position?: number) {
    if (working.current) return;
    working.current = true; setBusy(true); setError("");
    try {
      const source = search.sources?.get(path);
      if (position !== undefined && source === undefined) throw new Error("This result changed. Search again.");
      await onChoose(path, position === undefined ? undefined : { source: source!, position });
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "This sheet could not be opened."); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  }
  async function review() {
    if (!query || reviewing.current || working.current) return;
    invalidatePreview(); const current = ++generation.current; reviewing.current = true; setChecking(true); setProgress(0);
    try {
      await store.flush();
      if (!alive.current || current !== generation.current) return;
      const paths = (await store.space.files.list()).filter((path) => /\.md$/i.test(path) && !path.split(/[\\/]/).some((part) => /^(?:\.slate|\.git)$/i.test(part)));
      if (!alive.current || current !== generation.current) return;
      const next = await prepareReplaceBatch({ space: store.space, paths, query, replacement, options: { matchCase }, group: `${Date.now()}-${crypto.randomUUID()}`,
        canWrite: () => store.api.getState().owned,
        onProgress(done) { if (!alive.current || current !== generation.current) throw new DOMException("Preview cancelled", "AbortError"); setProgress(done); },
      });
      if (alive.current && current === generation.current) { setBatch(next); setRows(next.rows()); setChosen(new Set(next.rows().filter(replacementSelectable).map((row) => row.path))); }
    } catch (cause) { if (alive.current && current === generation.current) setError(cause instanceof Error ? cause.message : "The preview could not be prepared."); }
    finally { if (alive.current && current === generation.current) { reviewing.current = false; setChecking(false); } }
  }
  async function change(undo: boolean) {
    if (working.current || (!undo && !batch)) return;
    working.current = true; setBusy(true); setError("");
    try { if (undo) await store.undoReplaceBatch(); else await store.applyReplaceBatch(batch!, [...chosen]); }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "Your files were kept. Try again."); }
    finally {
      working.current = false;
      if (alive.current) { if (batch) { const current = batch.rows(); setRows(current); setChosen((previous) => new Set(current.filter((row) => replacementSelectable(row) && previous.has(row.path)).map((row) => row.path))); } setBusy(false); }
    }
  }
  const replacements = rows.filter((row) => chosen.has(row.path)).reduce((sum, row) => sum + row.replacements, 0);
  return <WorkspaceDialog title="Search everywhere" returnFocus={returnFocus} initialFocus={input} busy={busy} className="workspaceSearchDialog" onClose={onClose}>
    <form className="workspaceSearchFields" onSubmit={(event) => { event.preventDefault(); setRetry((value) => value + 1); }}>
      <fieldset disabled={busy}><label>Search in {store.api.getState().record.name}<input ref={input} aria-label={`Search in ${store.api.getState().record.name}`} value={query} onChange={(event) => { invalidatePreview(); setQuery(event.target.value); }} /></label>
        <button type="submit" disabled={!query}>Search</button><label className="searchCase"><input type="checkbox" checked={matchCase} onChange={(event) => { invalidatePreview(); setMatchCase(event.target.checked); }} />Match case</label>
        <label>Replace with<input aria-label="Replace with" placeholder="Leave empty to delete matches" value={replacement} onChange={(event) => { invalidatePreview(); setReplacement(event.target.value); }} /></label>
        <button type="button" disabled={!query || checking} onClick={() => void review()}>Preview replacements</button>
      </fieldset>
    </form>
    {(error || search.error) && <div className="searchError" role="alert">{error || search.error}{search.error && <button type="button" onClick={() => setRetry((value) => value + 1)}>Retry search</button>}</div>}
    {!owned && <p className="searchNotice">This Space is read-only. Search and preview are available.</p>}
    <div className="workspaceSearchBody">
      {checking ? <p role="status">Preparing preview… {progress} {progress === 1 ? "sheet" : "sheets"} checked</p> : batch ? <ReplacementPreview rows={rows} chosen={chosen} disabled={busy || !owned} onToggle={(path) => setChosen((previous) => { const next = new Set(previous); if (next.has(path)) next.delete(path); else next.add(path); return next; })} onAll={(checked) => setChosen(new Set(checked ? rows.filter(replacementSelectable).map((row) => row.path) : []))} /> : <section aria-label="Search results">
        {!query ? <p>Find words or filenames across this Space.</p> : search.pending ? <p role="status">Searching…</p> : search.result && <>
          <p role="status">{search.result.totalMatches} text {search.result.totalMatches === 1 ? "match" : "matches"} · {search.result.totalFiles} matching {search.result.totalFiles === 1 ? "sheet" : "sheets"}{search.result.totalFiles > search.result.files.length ? ` · Showing the first ${search.result.files.length}; narrow your search to see more.` : ""}</p>
          {!!search.result.unsupportedFiles && <p>{search.result.unsupportedFiles} {search.result.unsupportedFiles === 1 ? "sheet uses" : "sheets use"} an unsupported text encoding. Original files are kept.</p>}
          {!search.result.totalFiles && <p>No sheets match. Try another search.</p>}
          <ul className="workspaceSearchResults">{search.result.files.map((file) => <li key={file.path}><button type="button" className="searchFile" disabled={busy} aria-label={`Open ${file.path}`} onClick={() => void choose(file.path)}>{file.path}<small>{file.unsupported ? "Open original file" : `${file.matches} text ${file.matches === 1 ? "match" : "matches"}`}</small></button>
            {file.excerpts.map((match) => <button type="button" className="searchExcerpt" key={match.from} disabled={busy} aria-label={`Go to ${file.path}, line ${match.line}, column ${match.column}`} onClick={() => void choose(file.path, match.from)}><small>Ln {match.line}, Col {match.column}</small><span>{match.clippedBefore ? "…" : ""}{match.before}<mark>{match.text}</mark>{match.after}{match.clippedAfter ? "…" : ""}</span></button>)}
            {file.matches > file.excerpts.length && <small>{file.matches - file.excerpts.length} more matches in this sheet</small>}</li>)}</ul>
        </>}
      </section>}
    </div>
    <footer className="workspaceSearchActions"><button type="button" disabled={busy || !owned || !canUndo} onClick={() => void change(true)}>Undo last replacements</button>
      {batch && <button type="button" className="primaryButton" disabled={busy || !owned || !replacements} onClick={() => void change(false)}>{busy ? "Saving…" : `Apply ${replacements} ${replacements === 1 ? "replacement" : "replacements"}`}</button>}
    </footer>
  </WorkspaceDialog>;
}
