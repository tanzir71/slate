import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { FolderOpen, HardDrive, Sparkles, Check, Info, Download } from "lucide-react";
import { createDirectoryFiles, createMemoryFiles, type BrowserDirectoryHandle } from "@slate/storage/browser-files";
import { listBrowserSpaces, openBrowserLibrary, rememberBrowserSpace, type BrowserSpaceRecord } from "@slate/storage/browser-catalog";
import { createBrowserOwnership, type BrowserOwnership } from "@slate/storage/browser-ownership";
import { createWorkspaceStore, type WorkspaceStore } from "./workspaceStore";
import { AppearanceControl, useAppearance } from "../appearance";
import { BrandMark } from "../BrandMark";
import "./browser.css";

const loadWorkspace = () => import("./BrowserWorkspace");
const Workspace = lazy(loadWorkspace);
const InfoDialog = lazy(() => import("./BrowserInfoDialog"));
type StorageTier = "folder" | "library" | "sample";
interface InstallPrompt extends Event { prompt(): Promise<void> }
interface FolderPickerWindow extends Window {
  showDirectoryPicker?: (options: { mode: "readwrite" }) => Promise<BrowserDirectoryHandle>;
}
export interface BrowserIndex {
  rebuild(sheets: { path: string; content: string }[]): Promise<void>;
  search(query: string): Promise<string[]>;
  close(): void;
}
export interface BrowserAppProps {
  version?: string;
  createIndex?: (spaceId: string) => BrowserIndex;
  updateReady?: boolean;
  updateVersion?: string | undefined;
  onReload?: () => Promise<void>;
}

export function BrowserApp({ version, createIndex, updateReady, updateVersion, onReload }: BrowserAppProps) {
  const appearance = useAppearance();
  const folderAvailable = typeof (window as FolderPickerWindow).showDirectoryPicker === "function";
  const [tier, setTier] = useState<StorageTier>(folderAvailable ? "folder" : "library");
  const [records, setRecords] = useState<BrowserSpaceRecord[]>([]);
  const [workspace, setWorkspace] = useState<WorkspaceStore>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [install, setInstall] = useState<InstallPrompt>();
  const [aboutOpen, setAboutOpen] = useState<"current" | "update">();
  const ownership = useRef<BrowserOwnership | undefined>(undefined);
  const workspaceRef = useRef<WorkspaceStore | undefined>(undefined);
  const generation = useRef(0);

  async function open(record: BrowserSpaceRecord) {
    const currentGeneration = ++generation.current;
    setBusy(true);
    setError("");
    // Load the writing UI alongside disk/catalog reads, rather than after them.
    void loadWorkspace().catch(() => undefined);
    void import("../MarkdownEditor").catch(() => undefined);
    try {
      await workspaceRef.current?.flush();
      await ownership.current?.close();
      ownership.current = undefined;
      const files = record.id === "sample" ? await sampleFiles() : record.tier === "folder" && record.handle ? createDirectoryFiles(record.handle) : await openBrowserLibrary(record.id);
      const store = createWorkspaceStore(record, files);
      await store.load();
      if (currentGeneration !== generation.current) return;
      if (record.id !== "sample") {
        const owner = createBrowserOwnership(record.id, store.setOwned, store.flush, () => {
          void store.refresh().catch((failure: unknown) => store.api.setState({ error: errorMessage(failure) }));
        });
        ownership.current = owner;
        let persistenceRequested = false;
        store.setOnSaved(() => {
          owner.notify();
          if (!persistenceRequested) { persistenceRequested = true; void navigator.storage.persist?.().catch(() => undefined); }
        });
        await owner.acquire();
        await rememberBrowserSpace(record);
        localStorage.setItem("slate.last-space", record.id);
      }
      workspaceRef.current = store;
      setWorkspace(store);
      if (store.api.getState().owned) await store.flush();
      if (!localStorage.getItem("slate.shortcuts.v2") && !store.api.getState().notice) {
        store.api.setState({ notice: "Italic is now Ctrl I. Open the inspector with Ctrl Shift I." });
        localStorage.setItem("slate.shortcuts.v2", "seen");
      }
    } catch (failure) { setError(errorMessage(failure)); }
    finally { if (currentGeneration === generation.current) setBusy(false); }
  }

  useEffect(() => {
    let active = true;
    const prompt = (event: Event) => { event.preventDefault(); setInstall(event as InstallPrompt); };
    const installed = () => setInstall(undefined);
    window.addEventListener("beforeinstallprompt", prompt);
    window.addEventListener("appinstalled", installed);
    void (async () => {
      const saved = await listBrowserSpaces();
      if (!active) return;
      setRecords(saved);
      if (new URLSearchParams(location.search).get("sample") === "1") {
        await open({ id: "sample", name: "Sample", tier: "library" });
      } else {
        const last = saved.find((record) => record.id === localStorage.getItem("slate.last-space"));
        if (last?.tier === "library") await open(last);
        else setBusy(false);
      }
    })().catch((failure: unknown) => { if (active) { setError(errorMessage(failure)); setBusy(false); } });
    return () => { active = false; window.removeEventListener("beforeinstallprompt", prompt); window.removeEventListener("appinstalled", installed); };
  }, []);

  async function continueOnboarding() {
    try {
      if (tier === "sample") return await open({ id: "sample", name: "Sample", tier: "library" });
      if (tier === "folder") {
        const handle = await (window as FolderPickerWindow).showDirectoryPicker!({ mode: "readwrite" });
        await open({ id: crypto.randomUUID(), name: handle.name, tier, handle });
      } else {
        await open({ id: crypto.randomUUID(), name: "My writing", tier });
      }
    } catch (failure) { if (!(failure instanceof DOMException && failure.name === "AbortError")) setError(errorMessage(failure)); }
  }

  async function reconnect(record: BrowserSpaceRecord) {
    try {
      if (record.handle?.requestPermission && await record.handle.requestPermission({ mode: "readwrite" }) !== "granted") {
        throw new Error("Folder permission was not granted. Reconnect to keep writing.");
      }
      await open(record);
    } catch (failure) { setError(errorMessage(failure)); }
  }

  async function keepSample() {
    const sample = workspaceRef.current;
    if (!sample) return;
    await sample.flush();
    const record: BrowserSpaceRecord = { id: crypto.randomUUID(), name: "My writing", tier: "library" };
    const files = await openBrowserLibrary(record.id);
    for (const path of await sample.space.files.list(true)) {
      const bytes = await sample.space.files.read(path);
      if (bytes) await files.write(path, bytes);
    }
    await open(record);
  }

  async function installSlate() {
    const offered = install;
    if (!offered) return;
    setInstall(undefined);
    try { await offered.prompt(); } catch (failure) { setError(errorMessage(failure)); }
  }

  return <div className="browserSlate">
    {updateReady && <div className="notice" role="status">{updateVersion ? `Slate ${updateVersion} is ready` : "A Slate update is ready"} <button onClick={(event) => { event.currentTarget.focus(); setAboutOpen("update"); }}>What’s new</button><button onClick={() => {
      void (async () => { await workspaceRef.current?.flush(); await onReload?.(); })().catch((failure: unknown) => setError(errorMessage(failure)));
    }}>Reload</button></div>}
    {error && <div className="errorNotice" role="alert">{error}</div>}
    {workspace ? <Suspense fallback={<p role="status">Opening your writing…</p>}>
      <Workspace key={workspace.api.getState().record.id} store={workspace} createIndex={createIndex} onKeepSample={keepSample} onAbout={() => setAboutOpen("current")}
        appearance={appearance}
        onInstall={install ? () => { void installSlate(); } : undefined}
        onTakeover={async () => { await ownership.current?.acquire(true); await workspace.refresh(); await workspace.flush(); }}
        onSwitchSpace={async () => {
          await workspace.flush(); await ownership.current?.close(); workspaceRef.current = undefined; setWorkspace(undefined); setRecords(await listBrowserSpaces());
        }} />
    </Suspense> : <>
      <header className="welcomeHeader"><span>Welcome to Slate</span><div className="welcomeHeaderActions"><AppearanceControl preference={appearance.preference} onChange={appearance.change} /><button onClick={(event) => { event.currentTarget.focus(); setAboutOpen("current"); }}><Info size={15} />About Slate</button>{install && <button onClick={() => { void installSlate(); }}><Download size={15} /> Install Slate</button>}</div></header>
      <main className="onboarding">
        <div className="welcomeBrand"><BrandMark size={30} /><span>Slate</span><small>Web{version ? ` · v${version}` : ""}</small></div>
        <h1>Where should your writing live?</h1>
        <p className="welcomeDescription">Slate runs entirely in your browser from GitHub Pages — there is no server and no account. Your files never leave this device.</p>
        {records.length > 0 && <div className="reconnectList">{records.map((record) => <button key={record.id} onClick={() => { void reconnect(record); }} disabled={busy}>
          {record.tier === "folder" ? "Reconnect" : "Open"} {record.name}
        </button>)}</div>}
        <fieldset className="storageCards" disabled={busy}>
          <legend className="visuallyHidden">Choose where to save your writing</legend>
          <StorageCard value="folder" selected={tier} onSelect={setTier} disabled={!folderAvailable} icon={<FolderOpen size={19} />} badge="Recommended" title="Open a folder"
            description="Edit the .md files in a folder on this computer, in place. Slate asks once; reconnect in one click next visit." detail={folderAvailable ? "Chrome · Edge · Brave · Opera" : "Use Chrome or Edge to edit a folder directly"} />
          <StorageCard value="library" selected={tier} onSelect={setTier} icon={<HardDrive size={19} />} badge="Any browser" title="Keep notes in this browser"
            description="Private storage inside this browser. Works everywhere, including Firefox and Safari. Export as .zip any time." detail="All modern browsers" />
          <StorageCard value="sample" selected={tier} onSelect={setTier} icon={<Sparkles size={19} />} title="Try a sample Space"
            description="Explore with example sheets. Keep them in the browser library when you like it." detail="Nothing is saved yet" />
        </fieldset>
        <div className="browserNote"><Info size={17} /><div><strong>Using Firefox or Safari?</strong><p>They can’t open folders directly yet. Keep notes in the browser, import a folder or files, and use Export → .zip to get files back out.</p></div></div>
        {busy && <p role="status">Opening your writing…</p>}
      </main>
      <footer className="welcomeFooter"><div><span><Check size={16} />No account</span><span><Check size={16} />Works offline after first visit</span><span><Check size={16} />Nothing is uploaded</span><span><Check size={16} />Export everything as .zip</span></div>
        <button className="primaryButton" disabled={busy} onClick={() => { void continueOnboarding(); }}>Continue</button></footer>
    </>}
    {aboutOpen && <Suspense fallback={<p role="status">Opening About Slate…</p>}><InfoDialog pendingUpdate={aboutOpen === "update"} onClose={() => setAboutOpen(undefined)} /></Suspense>}
  </div>;
}

function StorageCard({ value, selected, onSelect, title, description, detail, badge, icon, disabled = false }: {
  value: StorageTier; selected: StorageTier; onSelect: (tier: StorageTier) => void; title: string; description: string; detail: string;
  badge?: string; icon: React.ReactNode; disabled?: boolean;
}) {
  return <label className={`storageCard ${selected === value ? "chosen" : ""} ${disabled ? "unavailable" : ""}`}>
    <input type="radio" name="storage" value={value} checked={selected === value} onChange={() => onSelect(value)} disabled={disabled} />
    <span className="cardTop"><span className="cardIcon">{icon}</span>{badge && <small>{badge}</small>}</span>
    <strong>{title}</strong><span>{description}</span><small className="cardDetail">{detail}</small>
  </label>;
}

async function sampleFiles() {
  const { sheets } = await import("../sampleData");
  return createMemoryFiles(Object.fromEntries(sheets.map((sheet) => [`${sheet.notebook}/${sheet.title}.md`, sheet.markdown])));
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : "Could not open this Space."; }
