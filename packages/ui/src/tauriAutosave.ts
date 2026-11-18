import type { AutosaveWriteResult, SheetAutosaveWriter } from "./autosave";

export type TauriInvoke = <Result>(
  command: string,
  args?: Record<string, unknown>
) => Promise<Result>;

export interface TauriAutosaveWriterOptions {
  invoke?: TauriInvoke;
  command?: string;
}

export function createTauriAutosaveWriter({
  invoke = invokeTauri,
  command = "write_sheet"
}: TauriAutosaveWriterOptions = {}): SheetAutosaveWriter {
  return {
    async writeSheet(path, content, options) {
      const args: Record<string, unknown> = { path, content };
      if (options.baseContent !== undefined) {
        args.baseContent = options.baseContent;
      }

      const result = await invoke<AutosaveWriteResult>(command, args);
      if (!isAutosaveWriteResult(result)) {
        throw new Error(`Invalid Tauri autosave response for ${path}`);
      }
      return result;
    }
  };
}

export async function invokeTauri<Result>(
  command: string,
  args?: Record<string, unknown>
): Promise<Result> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<Result>(command, args);
}

function isAutosaveWriteResult(value: unknown): value is AutosaveWriteResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const result = value as Partial<AutosaveWriteResult>;
  return (
    (result.status === "written" || result.status === "conflict-copy") &&
    typeof result.path === "string" &&
    (result.savedContent === undefined || typeof result.savedContent === "string")
  );
}
