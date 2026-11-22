import { useEffect, useRef, useState } from "react";
import type { NativeSpace } from "./nativeSpaces";

export function NativeNewSpaceForm({ busy, created, onCreate, onBack }: {
  busy: boolean;
  created: NativeSpace | undefined;
  onCreate(name: string): void;
  onBack(): void;
}) {
  const [name, setName] = useState("Personal");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  return <form className="nativeNewSpaceForm" onSubmit={event => { event.preventDefault(); onCreate(name); }}>
    <p>Create a folder in Documents/Slate with a short welcome note. Your notes stay on this device.</p>
    <label>Space name<input ref={input} name="spaceName" required maxLength={80} disabled={busy || !!created} value={name} onChange={event => setName(event.target.value)} autoComplete="off" /></label>
    {created && <p>Created at <span className="nativeSpacePath">{created.path}</span>. Open your Space to begin writing.</p>}
    <div className="dialogActions">
      <button type="button" disabled={busy} onClick={onBack}>Back to Spaces</button>
      <button type="submit" className="primaryButton" disabled={busy || !name.trim()}>{created ? "Open Space" : "Create Space"}</button>
    </div>
  </form>;
}
