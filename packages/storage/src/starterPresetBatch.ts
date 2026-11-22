import { onboardingPresetFiles } from "@slate/core";
import { encodeText, type WorkspaceFileReader } from "./fileIO";

type Create = (path: string, bytes: Uint8Array) => Promise<boolean>;
type Serialize = <T>(work: () => Promise<T>) => Promise<T>;
/** Create-only libraries share the Space mutation queue, including Close/flush protection. */
export function createStarterPresetBatch(files: WorkspaceFileReader, create: Create, serialize: Serialize, id: string) {
  const entries = Object.entries(onboardingPresetFiles(id)).map(([path, source]) => [path, encodeText(source)] as const);
  const added = new Set<string>(), kept = new Set<string>();
  return {
    run() {
      return serialize(async () => {
        try {
          for (const [path, bytes] of entries) {
            if (added.has(path) || kept.has(path)) continue;
            if (await create(path, bytes)) added.add(path);
            else {
              const existing = await files.read(path);
              if (existing === undefined) throw Error("A starter library file changed while it was being added. Retry to finish.");
              kept.add(path);
            }
          }
          return { added: [...added], kept: [...kept] };
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "The starter kit could not be added.";
          throw Error(message + " Existing files and additions saved so far were kept. Retry to finish.");
        }
      });
    },
  };
}
