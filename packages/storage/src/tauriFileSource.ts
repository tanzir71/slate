import type { RuntimeMarkdownFileSource } from "./runtimeSqliteAdapter";
import { nativeFileError } from "./tauriFiles";

export type TauriInvoke = <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;

export interface TauriMarkdownFileSourceOptions {
  invoke?: TauriInvoke;
  listCommand?: string;
  readCommand?: string;
}

export function createTauriMarkdownFileSource({
  invoke = invokeTauriCommand,
  listCommand = "list_markdown_files",
  readCommand = "read_markdown_file"
}: TauriMarkdownFileSourceOptions = {}): RuntimeMarkdownFileSource {
  return {
    listMarkdownFiles() {
      return invoke<string[]>(listCommand).catch((cause: unknown) => { throw nativeFileError(cause); });
    },

    readMarkdownFile(path) {
      return invoke<string>(readCommand, { path }).catch((cause: unknown) => { throw nativeFileError(cause); });
    }
  };
}

async function invokeTauriCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}
