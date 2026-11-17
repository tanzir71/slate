import { useEffect, useRef, useState } from "react";
import { parseReleaseNotes, type ReleaseNotes } from "./releaseNotes";

export default function BrowserInfoDialog({ onClose, pendingUpdate = false }: { onClose: () => void; pendingUpdate?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [notes, setNotes] = useState<ReleaseNotes>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const modal = dialog.current;
    modal?.showModal();
    const controller = new AbortController();
    const url = new URL("./whats-new.json", location.href);
    // A query bypasses the running worker's old precache when reviewing a waiting update.
    if (pendingUpdate) url.searchParams.set("update", "ready");
    void fetch(url, { signal: controller.signal, cache: pendingUpdate ? "no-store" : "default" }).then(async (response) => {
      if (!response.ok) throw new Error("Release notes unavailable");
      const value: unknown = await response.json();
      setNotes(parseReleaseNotes(value));
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => { controller.abort(); modal?.close(); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, [pendingUpdate]);

  return <dialog ref={dialog} className="browserInfoDialog" aria-labelledby="about-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header><h1 id="about-title">About Slate</h1><button autoFocus onClick={onClose}>Close</button></header>
    <p>A calm Markdown workspace. Your words stay in ordinary files, on your device.</p>
    <p>Designed &amp; built by <a href="https://tanziro.com" target="_blank" rel="noreferrer">tanziro.com</a>.</p>
    <section aria-labelledby="release-title"><h2 id="release-title">What’s new{notes ? ` in Slate ${notes.version}` : ""}</h2>
      {notes ? <><h3>{notes.title}</h3><ul>{notes.changes.map((change, index) => <li key={index}>{change}</li>)}</ul></> : <p role="status">{failed ? "Release notes could not be loaded. Close this dialog and try again." : "Loading release notes…"}</p>}
    </section>
    <section aria-labelledby="capabilities-title"><h2 id="capabilities-title">Browser capabilities</h2>
      <div className="capabilityTable" tabIndex={0} role="region" aria-labelledby="capabilities-title"><table><caption className="visuallyHidden">Slate browser capability matrix</caption><thead><tr><th scope="col">Capability</th><th scope="col">Chrome / Edge</th><th scope="col">Firefox / Safari</th></tr></thead><tbody>
        <tr><th scope="row">Edit a selected folder</th><td>Yes, with permission</td><td>Import / export</td></tr>
        <tr><th scope="row">Private browser library</th><td>Yes</td><td>Yes</td></tr>
        <tr><th scope="row">Offline writing</th><td>After first visit</td><td>After first visit</td></tr>
        <tr><th scope="row">Install as an app</th><td>Where offered</td><td>Browser-dependent</td></tr>
        <tr><th scope="row">Open Markdown from the OS</th><td>Installed app handler</td><td>Import files</td></tr>
        <tr><th scope="row">Import / export a Space as .zip</th><td>Yes</td><td>Yes</td></tr>
      </tbody></table></div>
      <p>Export your browser library regularly. Removing site data removes private browser files; selected-folder files stay on disk.</p>
    </section>
  </dialog>;
}
