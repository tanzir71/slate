import { Facet, Prec, type Extension } from "@codemirror/state";
import { ViewPlugin, type EditorView } from "@codemirror/view";
import { clipboardTable } from "@slate/core";
import { convertClipboardHtml } from "./clipboardHtml.js";
import {
  clipboardUrl,
  isBlockPaste,
  linkedSelection,
  imagePasteMarkdown,
  pasteInputAllowed,
} from "./pasteMarkdown.js";
import { currentPaste, insertPaste, requestPaste } from "./pasteTransaction.js";
import type {
  ClipboardImageReference,
  SaveClipboardImage,
} from "./clipboardImages.js";
export interface PasteNotice {
  readonly message: string;
  readonly retry?: () => boolean;
}
export interface SmartPasteOptions {
  readonly richText?: boolean;
  readonly links?: boolean;
  readonly tables?: boolean;
  readonly images?: boolean;
  readonly convertHtml?: (html: string) => Promise<string>;
  readonly importImage?: SaveClipboardImage;
  readonly onNotice?: (notice: PasteNotice) => void;
}
export interface ClipboardSnapshot {
  readonly plain: string;
  readonly html: string;
  readonly csv: string;
  readonly tsv: string;
  readonly images: readonly File[];
}
export function snapshotClipboard(data: DataTransfer): ClipboardSnapshot {
  const files = Array.from(data.files);
  const images = (
    files.length
      ? files
      : Array.from(data.items ?? [])
          .map((item) => item.getAsFile())
          .filter((file): file is File => file !== null)
  ).filter((file) => file.type.startsWith("image/"));
  return {
    plain: data.getData("text/plain"),
    html: data.getData("text/html"),
    csv: data.getData("text/csv"),
    tsv: data.getData("text/tab-separated-values"),
    images,
  };
}
const settings = Facet.define<SmartPasteOptions, SmartPasteOptions>({
  combine: (values) => values.at(-1) ?? {},
});
const plugin = ViewPlugin.fromClass(
  class {
    alive = true;
    plain = false;
    imported = new WeakMap<
      SaveClipboardImage,
      WeakMap<File, Promise<ClipboardImageReference>>
    >();
    resources = new WeakMap<
      SaveClipboardImage,
      WeakMap<ClipboardSnapshot, Map<string, Promise<ClipboardImageReference>>>
    >();
    constructor(readonly view: EditorView) {}
    destroy() {
      this.alive = false;
    }
    notice(value: PasteNotice) {
      if (this.alive && this.view.dom.isConnected)
        this.view.state.facet(settings).onNotice?.(value);
    }
    retry(snapshot: ClipboardSnapshot) {
      if (!this.alive || !this.view.dom.isConnected) return false;
      this.view.focus();
      if (this.paste(snapshot)) return true;
      return snapshot.plain
        ? insertPaste(this.view, requestPaste(this.view.state), snapshot.plain)
        : false;
    }
    saveImage(
      file: File,
      importer: NonNullable<SmartPasteOptions["importImage"]>,
    ) {
      let files = this.imported.get(importer);
      if (!files) {
        files = new WeakMap();
        this.imported.set(importer, files);
      }
      const previous = files.get(file);
      if (previous) return previous;
      const saved = Promise.resolve().then(() => importer(file));
      files.set(file, saved);
      void saved.catch(() => files.delete(file));
      return saved;
    }
    resourceCache(snapshot: ClipboardSnapshot, importer: SaveClipboardImage) {
      let snapshots = this.resources.get(importer);
      if (!snapshots) {
        snapshots = new WeakMap();
        this.resources.set(importer, snapshots);
      }
      let cache = snapshots.get(snapshot);
      if (!cache) {
        cache = new Map();
        snapshots.set(snapshot, cache);
      }
      return cache;
    }
    paste(snapshot: ClipboardSnapshot, plain = false): boolean {
      const view = this.view,
        options = view.state.facet(settings);
      if (!this.alive || view.state.readOnly || view.compositionStarted)
        return false;
      const request = requestPaste(view.state);
      if (plain)
        return snapshot.plain
          ? insertPaste(view, request, snapshot.plain)
          : false;
      if (
        !view.state.selection.ranges.every((range) =>
          pasteInputAllowed(view.state, range),
        )
      )
        return false;
      const url =
        options.links !== false ? clipboardUrl(snapshot.plain) : undefined;
      const links =
        url &&
        view.state.selection.ranges.map((range) =>
          linkedSelection(view.state, range, url),
        );
      if (links && links.every((link) => link !== undefined)) {
        let index = 0;
        return insertPaste(view, request, () => links[index++]!);
      }
      const declared =
        options.tables !== false && (snapshot.tsv || snapshot.csv);
      const table = declared
        ? clipboardTable(declared, snapshot.tsv ? "\t" : ",")
        : undefined;
      if (table) return insertPaste(view, request, table, true);
      const rich =
        options.richText !== false &&
        snapshot.html &&
        !snapshot.html.includes("\u0000");
      const images =
        options.images !== false &&
        options.importImage &&
        (snapshot.images.length || /<img\b/i.test(snapshot.html));
      if (rich || images) {
        void this.convert(snapshot, options, Boolean(rich), Boolean(images))
          .then((markdown) => {
            if (!this.alive) return;
            if (
              !currentPaste(view, request) ||
              (images &&
                view.state.facet(settings).importImage !== options.importImage)
            ) {
              this.notice({
                message: "The sheet changed before the paste finished.",
                retry: () => this.retry(snapshot),
              });
              return;
            }
            if (markdown || snapshot.plain)
              insertPaste(
                view,
                request,
                markdown || snapshot.plain,
                Boolean(markdown) && isBlockPaste(markdown),
              );
          })
          .catch(() => {
            if (!this.alive) return;
            if (snapshot.plain && !images && currentPaste(view, request)) {
              insertPaste(view, request, snapshot.plain);
              this.notice({
                message:
                  "Pasted as plain text because formatting could not be kept.",
              });
            } else
              this.notice({
                message: "The paste could not finish. Your sheet was kept.",
                retry: () => this.retry(snapshot),
              });
          });
        return true;
      }
      const inferred =
        options.tables !== false ? clipboardTable(snapshot.plain) : undefined;
      return inferred ? insertPaste(view, request, inferred, true) : false;
    }
    async convert(
      snapshot: ClipboardSnapshot,
      options: SmartPasteOptions,
      rich: boolean,
      images: boolean,
    ): Promise<string> {
      const importer = images ? options.importImage : undefined;
      if (importer && /<img\b/i.test(snapshot.html)) {
        const { prepareClipboardImages } = await import("./clipboardImages.js");
        const prepared = await prepareClipboardImages(
          snapshot.html,
          snapshot.images,
          (file) => this.saveImage(file, importer),
          this.resourceCache(snapshot, importer),
        );
        const text = rich
          ? await (options.convertHtml ?? convertClipboardHtml)(prepared.html)
          : snapshot.plain;
        const references = rich
          ? prepared.extra
          : [...prepared.embedded, ...prepared.extra];
        return [text, ...references.map((image) => imagePasteMarkdown(image))]
          .filter(Boolean)
          .join("\n\n");
      }
      const parts = [
        rich
          ? await (options.convertHtml ?? convertClipboardHtml)(snapshot.html)
          : snapshot.plain,
      ];
      if (importer)
        for (const file of snapshot.images) {
          const saved = await this.saveImage(file, importer);
          parts.push(
            imagePasteMarkdown(saved, file.name.replace(/\.[^.]*$/, "")),
          );
        }
      return parts.filter(Boolean).join("\n\n");
    }
  },
  {
    eventHandlers: {
      keydown(event) {
        if (event.isComposing) return false;
        if (
          event.key.toLowerCase() === "v" &&
          (event.metaKey || event.ctrlKey) &&
          event.shiftKey &&
          !event.altKey
        )
          this.plain = true;
        else if (!/^(Control|Meta|Shift)$/.test(event.key)) this.plain = false;
        return false;
      },
      paste(event) {
        const plain = this.plain;
        this.plain = false;
        return event.clipboardData
          ? this.paste(snapshotClipboard(event.clipboardData), plain)
          : false;
      },
      blur() {
        this.plain = false;
      },
    },
  },
);
export function createSmartPaste(options: SmartPasteOptions = {}): Extension {
  return [Prec.highest(plugin), settings.of(options)];
}
