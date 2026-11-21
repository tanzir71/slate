import type { createSnippetLibrary } from "../snippets/snippetLibrary";
import type { NativeLaunchSource } from "../native/nativeLaunchSource";

export interface WorkspaceFileInfo {
  readonly absolutePath: string;
  readonly bytes: number;
  readonly modifiedAt: number | null;
  readonly revealLabel: "Show in Explorer" | "Show in Finder" | "Show in file manager";
}
export interface WorkspaceFileActions {
  info(path: string): Promise<WorkspaceFileInfo>;
  reveal(path: string): Promise<void>;
}

/** Platform capabilities for the shared disk-backed workspace. */
export interface WorkspaceRuntime {
  surface: "desktop";
  fileActions?: WorkspaceFileActions;
  launches?: NativeLaunchSource;
  quickCapture?: { open(): Promise<void> };
  openGlobalSnippets: Parameters<typeof createSnippetLibrary>[1];
  observe(refresh: () => void, failed: (error: unknown) => void): Promise<() => void>;
}
