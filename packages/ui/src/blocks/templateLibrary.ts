import { decodeText } from "@slate/storage/browser-files";
import {
  readSpaceTemplates,
  type BrowserSpace,
  type SpaceTemplateRecord,
} from "@slate/storage/browser-space";
import {
  builtinTemplates,
  type TemplateCatalogItem,
} from "../templates/builtinTemplates";
import { templateMenuEntry, type TemplateMenuEntry } from "./menuCatalog";

export interface TemplateLibrarySnapshot {
  readonly loading: boolean;
  readonly records: readonly SpaceTemplateRecord[];
  readonly items: readonly TemplateMenuEntry[];
  readonly error: string;
}
const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);
const same = (a: SpaceTemplateRecord, b: SpaceTemplateRecord) =>
  a.path === b.path && a.source === b.source && a.error === b.error;

/** Cache menu metadata outside typing; re-read only the explicitly selected Space template. */
export function createTemplateLibrary(
  space: BrowserSpace,
  canInsert: () => boolean,
  builtins: readonly TemplateCatalogItem[] = builtinTemplates,
) {
  const listeners = new Set<() => void>(),
    bundled = builtins.map(templateMenuEntry);
  let disposed = false,
    generation = 0;
  let snapshot: TemplateLibrarySnapshot = {
    loading: true,
    records: [],
    items: bundled,
    error: "",
  };
  function publish(next: TemplateLibrarySnapshot) {
    snapshot = next;
    for (const listener of listeners) listener();
  }
  function assertCurrent() {
    if (disposed)
      throw new Error("This Space is closed. Choose the template again.");
    if (!canInsert())
      throw new Error("This Space is read-only. Choose Use here to edit.");
  }
  async function refresh() {
    if (disposed) return;
    const current = ++generation;
    let records: SpaceTemplateRecord[];
    try {
      records = await readSpaceTemplates(space);
    } catch (cause) {
      if (!disposed && current === generation)
        publish({
          loading: false,
          records: [],
          items: bundled,
          error: message(cause),
        });
      return;
    }
    if (disposed || current !== generation) return;
    if (
      !snapshot.loading &&
      !snapshot.error &&
      records.length === snapshot.records.length &&
      records.every((record, index) => same(snapshot.records[index]!, record))
    )
      return;
    const previous = new Map(snapshot.items.map((item) => [item.id, item]));
    const items = records.flatMap((record): TemplateMenuEntry[] => {
      if (!record.template) return [];
      const entry = templateMenuEntry({
        id: record.path,
        path: record.path,
        origin: "space",
        template: record.template,
      });
      const old = previous.get(entry.id);
      return [
        old && old.item.template.source === record.template.source
          ? old
          : entry,
      ];
    });
    publish({
      loading: false,
      records,
      items: [...bundled, ...items],
      error: "",
    });
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    async resolve(
      id: string,
      previewSource: string,
    ): Promise<TemplateMenuEntry> {
      assertCurrent();
      const chosen = snapshot.items.find((item) => item.id === id);
      if (!chosen)
        throw new Error(
          "This template is unavailable. Choose another template.",
        );
      const changed = () =>
        new Error(
          "This template changed. Review its preview and choose it again.",
        );
      if (chosen.item.template.source !== previewSource) throw changed();
      if (chosen.item.origin === "built-in") return chosen;
      if (!chosen.item.path)
        throw new Error("This template file is unavailable.");
      let bytes: Uint8Array | undefined;
      try {
        bytes = await space.files.read(chosen.item.path);
      } catch (cause) {
        await refresh();
        throw new Error(message(cause));
      }
      assertCurrent();
      if (bytes === undefined) {
        await refresh();
        throw new Error("This template was removed. Choose another template.");
      }
      let source: string;
      try {
        source = decodeText(bytes);
      } catch (cause) {
        await refresh();
        throw new Error(message(cause));
      }
      if (
        source !== previewSource ||
        snapshot.items.find((entry) => entry.id === id)?.item.template
          .source !== previewSource
      ) {
        await refresh();
        throw changed();
      }
      return chosen;
    },
    dispose() {
      disposed = true;
      generation++;
      listeners.clear();
    },
  };
}
export type TemplateLibrary = ReturnType<typeof createTemplateLibrary>;
