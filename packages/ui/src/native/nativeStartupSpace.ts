import type { TauriInvoke } from "../tauriAutosave";
import { createNativeLaunchSource, type NativeLaunchSnapshot, type NativeLaunchSource } from "./nativeLaunchSource";
import { createNativeSpaceCatalog, defaultNativeSpace } from "./nativeSpaces";

async function nativeInvoke<Result>(command: string, args?: Record<string, unknown>): Promise<Result> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<Result>(command, args);
}
/** Prefer a queued OS file, otherwise reopen the host's last selected Space. */
export async function nativeStartupSpace(invoke: TauriInvoke = nativeInvoke) {
  try {
    const source = createNativeLaunchSource(invoke, async () => () => {});
    const { current } = await source.pending();
    if (current?.fileName) return (await source.resolveFile(current.id)).space;
  } catch { /* The normal request UI retains the host ticket and exposes its recoverable error. */ }
  // Failure to reopen a chosen folder is recoverable; never silently substitute another Space.
  return await createNativeSpaceCatalog(invoke).startup() ?? defaultNativeSpace;
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
