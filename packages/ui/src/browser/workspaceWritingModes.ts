import type { WritingFocus } from "@slate/editor";

export interface WorkspaceWritingSnapshot {
  readonly focus: WritingFocus;
  readonly preferredFocus: Exclude<WritingFocus, "none">;
  readonly typewriter: boolean;
  readonly zen: boolean;
  readonly hud: boolean;
}
/** Transient writing controls never own document bytes or the Space's editing lease. */
export function createWorkspaceWritingModes() {
  let snapshot: WorkspaceWritingSnapshot = { focus: "none", preferredFocus: "paragraph", typewriter: false, zen: false, hud: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  function update(change: Partial<WorkspaceWritingSnapshot>) {
    const next = { ...snapshot, ...change };
    if (Object.keys(change).every(key => next[key as keyof WorkspaceWritingSnapshot] === snapshot[key as keyof WorkspaceWritingSnapshot])) return;
    snapshot = next; for (const listener of listeners) listener();
  }
  function clear() { clearTimeout(timer); timer = undefined; }
  function activity() {
    if (!snapshot.zen) return;
    clear(); update({ hud: true }); timer = setTimeout(() => { timer = undefined; if (snapshot.zen) update({ hud: false }); }, 2000);
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    focus(value: WritingFocus) { update({ focus: value, ...(value !== "none" ? { preferredFocus: value } : {}) }); activity(); },
    toggleFocus() { update({ focus: snapshot.focus === "none" ? snapshot.preferredFocus : "none" }); activity(); },
    toggleTypewriter() { update({ typewriter: !snapshot.typewriter }); activity(); },
    zen(value: boolean) { clear(); update({ zen: value, hud: value }); if (value) activity(); },
    activity,
    dispose: clear,
  };
}
