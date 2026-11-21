import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { AppearanceControl, useAppearance } from "../appearance";
import { BrandMark } from "../BrandMark";
import { shortcutOS } from "../commands";
import { takeShortcutMigrationNotice } from "../shortcutMigrationNotice";
import { WorkspaceDialog } from "../browser/WorkspaceDialog";
import { createNativeWorkspace, nativeLifecycle } from "./nativeWorkspace";
import { createTauriWorkspaceFiles } from "@slate/storage/tauri-files";
import { createNativeSpaceCatalog, defaultNativeSpace, type NativeSpace, type NativeSpaceCatalog } from "./nativeSpaces";
import { NativeSpacesDialog } from "./NativeSpacesDialog";
import { useNativeWindowChrome } from "./useNativeWindowChrome";
import { WindowDragRegion, WindowTitleBar } from "../browser/WindowTitleBar";
import "./nativeSpaces.css";
import "../browser/browser.css";
import "./nativeWindow.css";

const loadWorkspace = () => import("../browser/BrowserWorkspace");
const Workspace = lazy(loadWorkspace);
type Session = ReturnType<typeof createNativeWorkspace>;
interface NativeAppProps { createSession?: (space?: NativeSpace) => Promise<Session>; catalog?: NativeSpaceCatalog }
const catalog = createNativeSpaceCatalog();
const createSession = async (space = defaultNativeSpace) => createNativeWorkspace(await nativeLifecycle(space.id), createTauriWorkspaceFiles({ spaceId: space.id }), undefined, space);

/** Production startup reads the real default Space; samples are never a disk fallback. */
export function NativeApp({ createSession: openSession = createSession, catalog: spaceCatalog = catalog }: NativeAppProps) {
  const appearance = useAppearance();
  const [session, setSession] = useState<Session>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [about, setAbout] = useState(false);
  const [spaces, setSpaces] = useState(false);
  const opening = useRef<{ attempt: number; factory: typeof openSession; promise: Promise<Session> } | undefined>(undefined);
  const closeProtection = useRef<(() => void) | undefined>(undefined);
  const liveSession = useRef<Session | undefined>(undefined);
  const switching = useRef(false);
  const generation = useRef(0);
  const windowFailure = useCallback((failure: unknown) => {
    const message = failure instanceof Error ? failure.message : "The window action could not be completed.";
    if (liveSession.current) liveSession.current.store.api.setState({ error: message });
    else setError(message);
  }, []);
  const windowChrome = useNativeWindowChrome(windowFailure);
  useEffect(() => {
    let active = true;
    let current: Session | undefined;
    setError("");
    void loadWorkspace().catch(() => undefined);
    if (opening.current?.attempt !== attempt || opening.current.factory !== openSession) {
      opening.current = { attempt, factory: openSession, promise: openSession().then(async (next) => { await next.open(); return next; }) };
    }
    void opening.current.promise.then(async (next) => {
      current = next;
      if (!active) return;
      const stop = await next.protectClose();
      if (!active) { stop(); return; }
      closeProtection.current = stop;
      liveSession.current = next;
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
  }, [openSession, attempt]);

  if (!session) return <div className="browserSlate"><WindowTitleBar windowControls={windowChrome}><span className="nativeStartupTitle">Welcome to Slate</span><WindowDragRegion windowControls={windowChrome} /></WindowTitleBar><main className="onboarding"><div className="welcomeBrand"><BrandMark size={36} /><span>Slate</span></div><h1>Your words, on this device.</h1>
    {error ? <><p role="alert">{error}</p><button className="primaryButton" onClick={() => setAttempt((value) => value + 1)}>Try again</button></> : <p role="status">Opening your Space…</p>}
  </main></div>;
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
      const stop = await next.protectClose();
      if (generation.current !== started) { stop(); return; }
      // Install the new close guard only after its folder has loaded successfully.
      closeProtection.current?.(); closeProtection.current = stop;
      liveSession.current = next; setSession(next);
    } finally { switching.current = false; }
  };
  return <div className="browserSlate">
    <Suspense fallback={<WindowTitleBar windowControls={windowChrome}><span className="nativeStartupTitle">Opening workspace…</span><WindowDragRegion windowControls={windowChrome} /></WindowTitleBar>}><Workspace key={session.space.id} store={session.store} runtime={session.runtime} appearance={appearance} createIndex={session.createIndex} windowChrome={windowChrome}
      onKeepSample={reopen} onTakeover={reopen} onSwitchSpace={async () => { await session.store.flush(); setSpaces(true); }} onAbout={() => setAbout(true)} onInstall={undefined} /></Suspense>
    {spaces && <NativeSpacesDialog current={session.space} catalog={spaceCatalog} onOpen={switchSpace} onClose={() => setSpaces(false)} />}
    {about && <WorkspaceDialog title="About Slate" onClose={() => setAbout(false)}><p>A calm Markdown workspace. Your words stay in ordinary files, on your device.</p><AppearanceControl preference={appearance.preference} onChange={appearance.change} /></WorkspaceDialog>}
  </div>;
}
