import type { createSnippetLibrary } from "../snippets/snippetLibrary";

/** Platform capabilities for the shared disk-backed workspace. */
export interface WorkspaceRuntime {
  surface: "desktop";
  openGlobalSnippets: Parameters<typeof createSnippetLibrary>[1];
  observe(refresh: () => void, failed: (error: unknown) => void): Promise<() => void>;
}
