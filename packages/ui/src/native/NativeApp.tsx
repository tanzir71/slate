import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { AppearanceControl, useAppearance } from "../appearance";
import { BrandMark } from "../BrandMark";
import { shortcutOS } from "../commands";
import { takeShortcutMigrationNotice } from "../shortcutMigrationNotice";
import { WorkspaceDialog } from "../browser/WorkspaceDialog";
import { createNativeWorkspace, nativeLifecycle } from "./nativeWorkspace";
import { createTauriWorkspaceFiles } from "@slate/storage/tauri-files";
import { createNativeSpaceCatalog, type NativeSpace, type NativeSpaceCatalog } from "./nativeSpaces";
import { NativeSpacesDialog } from "./NativeSpacesDialog";
import { useNativeWindowChrome } from "./useNativeWindowChrome";
import { WindowDragRegion, WindowTitleBar } from "../browser/WindowTitleBar";
import { nativeStartupSpace, observeNativeFileStartup } from "./nativeStartupSpace";
import "./nativeSpaces.css";
import "../browser/browser.css";
import "./nativeWindow.css";

const loadWorkspace = () => import("../browser/BrowserWorkspace");
const Workspace = lazy(loadWorkspace);
type Session = ReturnType<typeof createNativeWorkspace>;
async function protectAndRemember(session: Session, catalog: NativeSpaceCatalog) {
  const stop = await session.protectClose();
  try { await catalog.remember(session.space.id); return stop; }
  catch (cause) { stop(); throw cause; }
}
interface NativeAppProps { createSession?: (space?: NativeSpace) => Promise<Session>; catalog?: NativeSpaceCatalog }
const catalog = createNativeSpaceCatalog();
const createSession = async (space?: NativeSpace) => {
  const target = space ?? await nativeStartupSpace();
  return createNativeWorkspace(await nativeLifecycle(target.id), createTauriWorkspaceFiles({ spaceId: target.id }), undefined, target);
};

/** Production startup opens a host-admitted Space; samples are never a disk fallback. */
export function NativeApp({ createSession: openSession = createSession, catalog: spaceCatalog = catalog }: NativeAppProps) {
  const appearance = useAppearance();
  const [session, setSession] = useState<Session>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [startupSpace, setStartupSpace] = useState<NativeSpace>();
  const [about, setAbout] = useState(false);
  const [spaces, setSpaces] = useState(false);
  const opening = useRef<{ attempt: number; factory: typeof openSession; space: NativeSpace | undefined; promise: Promise<Session> } | undefined>(undefined);
  const closeProtection = useRef<(() => void) | undefined>(undefined);
  const liveSession = useRef<Session | undefined>(undefined);
  const switching = useRef(false);
  const generation = useRef(0);
  const startupFiles = useRef(new Set<string>());
  const windowFailure = useCallback((failure: unknown) => {
    const message = failure instanceof Error ? failure.message : "The window action could not be completed.";
    if (liveSession.current) liveSession.current.store.api.setState({ error: message });
    else setError(message);
  }, []);
  const windowChrome = useNativeWindowChrome(windowFailure);
  useEffect(() => {
    let active = true, stop: (() => void) | undefined;
    void observeNativeFileStartup(id => {
      if (!active || liveSession.current || startupFiles.current.has(id)) return;
      startupFiles.current.add(id); setStartupSpace(undefined); setAttempt(value => value + 1);
    }).then(unlisten => { if (active) stop = unlisten; else unlisten(); }).catch(() => undefined);
    return () => { active = false; stop?.(); };
  }, []);
  useEffect(() => {
    let active = true;
    let current: Session | undefined;
    setError("");
    void loadWorkspace().catch(() => undefined);
    if (opening.current?.attempt !== attempt || opening.current.factory !== openSession || opening.current.space?.id !== startupSpace?.id) {
      opening.current = { attempt, factory: openSession, space: startupSpace, promise: openSession(startupSpace).then(async (next) => { await next.open(); return next; }) };
    }
    void opening.current.promise.then(async (next) => {
      current = next;
      if (!active) return;
      const stop = await protectAndRemember(next, spaceCatalog);
      if (!active) { stop(); return; }
      closeProtection.current = stop;
      liveSession.current = next;
      void next.activate();
      const notice = takeShortcutMigrationNotice(shortcutOS(), "desktop");
      if (notice && !next.store.api.getState().notice) next.store.api.setState({ notice });
      setSession(next);
    }).catch((failure: unknown) => {
      if (active) setError(failure instanceof Error ? failure.message : "Your Space could not be opened. Your files were kept.");
    });
    return () => {
      active = false; generation.current += 1; closeProtection.current?.(); closeProtection.current = undefined;
      const last = liveSession.current ?? current;
      liveSession.current = undefined;
      void last?.store.flush().catch(() => undefined);
    };
  }, [openSession, attempt, startupSpace, spaceCatalog]);

  if (!session) return <div className="browserSlate"><WindowTitleBar windowControls={windowChrome}><span className="nativeStartupTitle">Welcome to Slate</span><WindowDragRegion windowControls={windowChrome} /></WindowTitleBar><main className="onboarding"><div className="welcomeBrand"><BrandMark size={36} /><span>Slate</span></div><h1>Your words, on this device.</h1>
    {error ? <><p role="alert">{error}</p><div className="dialogActions"><button onClick={() => setSpaces(true)}>Choose a Space</button><button className="primaryButton" onClick={() => setAttempt((value) => value + 1)}>Try again</button></div></> : <p role="status">Opening your Space…</p>}
  </main>{spaces && <NativeSpacesDialog catalog={spaceCatalog} onOpen={async space => { setStartupSpace(space); setAttempt(value => value + 1); }} onClose={() => setSpaces(false)} />}</div>;
  const reopen = async () => { await session.store.flush(); await session.store.refresh(); };
  const switchSpace = async (space: NativeSpace) => {
    if (space.id === session.space.id) return;
    if (switching.current) throw Error("A Space is already opening. Your current words were kept.");
    switching.current = true;
    const started = generation.current;
    try {
      await session.store.flush();
      if (generation.current !== started) throw Error("The current window changed. Open this Space again.");
      const next = await openSession(space);
      await next.open();
      if (generation.current !== started) throw Error("The current window changed. Open this Space again.");
      const stop = await protectAndRemember(next, spaceCatalog);
      if (generation.current !== started) { stop(); return; }
      // Install the new close guard only after its folder has loaded successfully.
      closeProtection.current?.(); closeProtection.current = stop;
      liveSession.current = next; setSession(next); void next.activate();
    } finally { switching.current = false; }
  };
  return <div className="browserSlate">
    <Suspense fallback={<WindowTitleBar windowControls={windowChrome}><span className="nativeStartupTitle">Opening workspace…</span><WindowDragRegion windowControls={windowChrome} /></WindowTitleBar>}><Workspace key={session.space.id} store={session.store} runtime={session.runtime} appearance={appearance} createIndex={session.createIndex} windowChrome={windowChrome}
      onKeepSample={reopen} onTakeover={reopen} onSwitchSpace={async () => { await session.store.flush(); setSpaces(true); }} onOpenNativeSpace={switchSpace} onAbout={() => setAbout(true)} onInstall={undefined} /></Suspense>
    {spaces && <NativeSpacesDialog current={session.space} catalog={spaceCatalog} onOpen={switchSpace} onClose={() => setSpaces(false)} />}
    {about && <WorkspaceDialog title="About Slate" onClose={() => setAbout(false)}><p>A calm Markdown workspace. Your words stay in ordinary files, on your device.</p><AppearanceControl preference={appearance.preference} onChange={appearance.change} /></WorkspaceDialog>}
  </div>;
}
