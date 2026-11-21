import { useCallback, useEffect, useRef, useState } from "react";
import { useAppearance } from "../appearance";
import { WindowDragRegion, WindowTitleBar } from "../browser/WindowTitleBar";
import { createCaptureRecovery } from "./captureRecovery";
import { createCaptureSession, type CaptureSession, type CaptureState } from "./captureSession";
import { nativeCaptureAPI } from "./nativeCapture";
import { useNativeWindowChrome } from "./useNativeWindowChrome";
import "../browser/browser.css";
import "./nativeWindow.css";
import "./capture.css";

const initial: CaptureState = { ready: false, draft: undefined, completed: undefined, saving: false, closing: false, recoveryFailed: false, error: "" };

export function CaptureApp() {
  useAppearance();
  const [state, setState] = useState(initial);
  const session = useRef<CaptureSession | undefined>(undefined);
  const input = useRef<HTMLTextAreaElement>(null);
  const failed = useCallback((error: unknown) => {
    if (session.current) session.current.failed(error);
    else setState(previous => ({ ...previous, error: error instanceof Error ? error.message : "Quick Capture could not open. Your draft was kept." }));
  }, []);
  const chrome = useNativeWindowChrome(failed);
  useEffect(() => {
    let active = true, current: CaptureSession | undefined, unsubscribe: (() => void) | undefined;
    void nativeCaptureAPI().then(api => {
      if (!active) return;
      current = createCaptureSession(api, createCaptureRecovery(localStorage));
      session.current = current;
      unsubscribe = current.subscribe(() => setState(current!.getSnapshot()));
      return current.start();
    }).catch(error => { if (active) failed(error); });
    return () => { active = false; unsubscribe?.(); current?.dispose(); if (session.current === current) session.current = undefined; };
  }, [failed]);
  useEffect(() => { if (state.ready) input.current?.focus(); }, [state.ready]);
  function save() {
    const current = session.current;
    void current?.save().then(saved => { if (saved && !current.getSnapshot().completed?.conflict) void current.requestClose(); });
  }
  const readOnly = !state.ready || state.saving || state.closing || state.recoveryFailed || !!state.draft?.pending || !!state.completed;
  return <div className="browserSlate captureWindow" onKeyDown={event => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") { event.preventDefault(); void session.current?.requestClose(); }
    else if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) { event.preventDefault(); save(); }
  }}>
    <WindowTitleBar windowControls={chrome}><h1 className="nativeStartupTitle">Quick Capture</h1><WindowDragRegion windowControls={chrome} /></WindowTitleBar>
    <main className="captureMain">
      <form onSubmit={event => { event.preventDefault(); save(); }}>
        <label htmlFor="captureText">{state.draft ? `${state.draft.spaceName} / Inbox` : "Your next thought"}</label>
        <textarea id="captureText" ref={input} value={state.draft?.text ?? ""} readOnly={readOnly} spellCheck
          placeholder={state.ready ? "What’s on your mind?" : "Opening your capture…"} aria-describedby="captureHint"
          onChange={event => session.current?.change(event.target.value)} />
        <p id="captureHint">{state.completed ? `Saved to ${state.completed.path}.` : state.draft?.pending ? "Retry keeps the same text and original Space." : "Appends to Inbox/Capture.md. Esc keeps your draft."}</p>
        {state.error && <p className="captureError" role="alert">{state.error}</p>}
        <footer>
          <button type="button" onClick={() => { void session.current?.showMain(); }}>Open Slate</button>
          <span className="captureShortcut" aria-hidden="true">{navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}+Enter</span>
          <button type="submit" className="primaryButton" disabled={!state.ready || !state.draft?.text.trim() || state.saving || state.closing || !!state.completed}>
            {state.saving ? "Saving…" : state.draft?.pending ? "Retry saving" : "Save to Inbox"}
          </button>
        </footer>
      </form>
    </main>
  </div>;
}
