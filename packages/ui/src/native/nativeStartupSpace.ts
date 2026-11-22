import type { TauriInvoke } from "../tauriAutosave";
import { createNativeLaunchSource, type NativeLaunchSnapshot, type NativeLaunchSource } from "./nativeLaunchSource";
import { createNativeSpaceCatalog, defaultNativeSpace } from "./nativeSpaces";
import { createTauriWorkspaceFiles } from "@slate/storage/tauri-files";

async function nativeInvoke<Result>(command: string, args?: Record<string, unknown>): Promise<Result> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<Result>(command, args);
}
/** A null target is a genuinely empty first run; no session or default selection is created yet. */
export async function nativeStartupSpace(invoke: TauriInvoke = nativeInvoke) {
  let incoming = false;
  try {
    const source = createNativeLaunchSource(invoke, async () => () => {});
    const { current } = await source.pending();
    incoming = !!current;
    if (current?.fileName) return (await source.resolveFile(current.id)).space;
  } catch { incoming = true; /* Keep the existing request recovery UI available. */ }
  // Failure to reopen a chosen folder is recoverable; never silently substitute another Space.
  const catalog = createNativeSpaceCatalog(invoke), selected = await catalog.startup();
  if (selected) return selected;
  if (incoming) return defaultNativeSpace;
  // This read includes user templates/configuration and does not create a note or cache.
  if ((await createTauriWorkspaceFiles({ spaceId: defaultNativeSpace.id, invoke }).list(true)).length) return defaultNativeSpace;
  const known = (await catalog.list())[1];
  return known ?? null;
}

/** Keep OS-open delivery available even while the default startup is loading or has failed. */
export async function observeNativeFileStartup(receive: (id: string) => void, source?: Pick<NativeLaunchSource, "listen" | "pending">) {
  if (!source) {
    const [{ invoke, isTauri }, { listen }] = await Promise.all([import("@tauri-apps/api/core"), import("@tauri-apps/api/event")]);
    if (!isTauri()) return () => {};
    source = createNativeLaunchSource(invoke, callback => listen<unknown>("slate://launch-changed", event => callback(event.payload)));
  }
  let active = true, revision = -1;
  const deliver = (snapshot: NativeLaunchSnapshot) => {
    if (!active || snapshot.revision < revision) return;
    revision = snapshot.revision;
    if (snapshot.current?.fileName) receive(snapshot.current.id);
  };
  const stop = await source.listen(deliver, () => {});
  try { deliver(await source.pending()); } catch { /* The request UI exposes queue errors once a Space is open. */ }
  return () => { active = false; stop(); };
}
