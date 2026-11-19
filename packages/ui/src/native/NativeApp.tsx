import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { AppearanceControl, useAppearance } from "../appearance";
import { BrandMark } from "../BrandMark";
import { shortcutOS } from "../commands";
import { takeShortcutMigrationNotice } from "../shortcutMigrationNotice";
import { WorkspaceDialog } from "../browser/WorkspaceDialog";
import { createNativeWorkspace, nativeLifecycle } from "./nativeWorkspace";
import { createTauriWorkspaceIndex } from "@slate/storage/tauri-workspace-index";
import "../browser/browser.css";

const loadWorkspace = () => import("../browser/BrowserWorkspace");
const Workspace = lazy(loadWorkspace);
type Session = ReturnType<typeof createNativeWorkspace>;
interface NativeAppProps { createSession?: () => Promise<Session> }
const createSession = async () => createNativeWorkspace(await nativeLifecycle());
const createIndex = () => createTauriWorkspaceIndex();

/** Production startup reads the real default Space; samples are never a disk fallback. */
export function NativeApp({ createSession: openSession = createSession }: NativeAppProps) {
  const appearance = useAppearance();
  const [session, setSession] = useState<Session>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [about, setAbout] = useState(false);
  const [spaces, setSpaces] = useState(false);
  const opening = useRef<{ attempt: number; factory: typeof openSession; promise: Promise<Session> } | undefined>(undefined);
  useEffect(() => {
    let active = true;
    let current: Session | undefined;
    let stopClose: (() => void) | undefined;
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
      stopClose = stop;
      const notice = takeShortcutMigrationNotice(shortcutOS(), "desktop");
      if (notice && !next.store.api.getState().notice) next.store.api.setState({ notice });
      setSession(next);
    }).catch((failure: unknown) => {
      if (active) setError(failure instanceof Error ? failure.message : "Your Space could not be opened. Your files were kept.");
    });
    return () => { active = false; stopClose?.(); void current?.store.flush().catch(() => undefined); };
  }, [openSession, attempt]);

  if (!session) return <div className="browserSlate"><main className="onboarding"><div className="welcomeBrand"><BrandMark size={36} /><span>Slate</span></div><h1>Your words, on this device.</h1>
    {error ? <><p role="alert">{error}</p><button className="primaryButton" onClick={() => setAttempt((value) => value + 1)}>Try again</button></> : <p role="status">Opening your Space…</p>}
  </main></div>;
  const reopen = async () => { await session.store.flush(); await session.store.refresh(); };
  return <div className="browserSlate">
    <Suspense fallback={<p role="status">Opening workspace…</p>}><Workspace store={session.store} runtime={session.runtime} appearance={appearance} createIndex={createIndex}
      onKeepSample={reopen} onTakeover={reopen} onSwitchSpace={async () => { await session.store.flush(); setSpaces(true); }} onAbout={() => setAbout(true)} onInstall={undefined} /></Suspense>
    {spaces && <WorkspaceDialog title="Spaces" onClose={() => setSpaces(false)}><button className="primaryButton" onClick={() => setSpaces(false)}>Slate · On this device</button></WorkspaceDialog>}
    {about && <WorkspaceDialog title="About Slate" onClose={() => setAbout(false)}><p>A calm Markdown workspace. Your words stay in ordinary files, on your device.</p><AppearanceControl preference={appearance.preference} onChange={appearance.change} /></WorkspaceDialog>}
  </div>;
}
