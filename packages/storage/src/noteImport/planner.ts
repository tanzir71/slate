import { allocateImportPaths, createImportLinkResolver, importResourceHash, parseImportCsv, portableImportName, relativeImportLink, resolveImportSourcePath, rewriteImportMarkdown, validateImportSourcePath } from "@slate/core";
import { decodeText, encodeText } from "../fileIO";
import { decodeImportBase64, importMimeExtension, planEnexDrafts } from "./enex";
import { convertImportMarkup, escapeImportText, prepareImportMarkup } from "./markup";
import { noteImportSources, type NoteImportDraft, type NoteImportPlan, type NoteImportSource } from "./types";

const raster = /\.(?:png|jpe?g|gif|webp|avif)$/i;
const stem = (path: string) => path.replace(/\.[^/.]+$/, "");
function markdownUrl(value: string) {
  return value.replace(/&/g, "&amp;").replace(/[\s<>()[\]"'\\]/g, char => {
    const encoded = encodeURIComponent(char); return encoded === char ? "%" + char.charCodeAt(0).toString(16).toUpperCase() : encoded;
  });
}
function text(bytes: Uint8Array, path: string): string {
  try { return decodeText(bytes, true); } catch { throw Error(`The export file is not valid UTF-8: ${path}`); }
}
function csvMarkdown(source: string) {
  const rows = parseImportCsv(source); if (!rows.length) return "";
  const width = Math.max(...rows.map(row => row.length));
  if (rows.length * width > 250000) throw Error("An imported table has too many cells.");
  const escaped = (value: string) => escapeImportText(value).replace(/\r\n|\r|\n/g, "<br>");
  return [rows[0]!, Array.from({ length: width }, () => "---"), ...rows.slice(1)].map((row, position) => "| " + Array.from({ length: width }, (_, index) => position === 1 ? "---" : escaped(row[index] ?? "")).join(" | ") + " |").join("\n") + "\n";
}

/** Convert a complete export in memory before admitting any of its files to a Space. */
export function planNoteImport(source: NoteImportSource, entries: Readonly<Record<string, Uint8Array>>): NoteImportPlan {
  const provider = noteImportSources.find(item => item.id === source); if (!provider) throw Error("Choose a supported application export.");
  const normalized = Object.create(null) as Record<string, Uint8Array>; let inputSize = 0;
  for (const [path, bytes] of Object.entries(entries)) {
    const safe = validateImportSourcePath(path);
    if (Object.hasOwn(normalized, safe)) throw Error(`Duplicate paths in export: ${safe}`);
    if (bytes.length > 100 * 1024 * 1024) throw Error("An imported file exceeds 100 MB.");
    inputSize += bytes.length; if (inputSize > 500 * 1024 * 1024) throw Error("The selected export exceeds 500 MB.");
    normalized[safe] = bytes;
  }
  entries = normalized;
  const drafts: NoteImportDraft[] = [], warnings = new Set<string>(), used = new Set(Object.keys(entries).map(path => path.split("/")[0]!)), counts = new Map<string, number>();
  function virtual(label: string) {
    let count = counts.get(label) ?? 1, candidate = `__slate_${label}__`;
    do { candidate = count === 1 ? `__slate_${label}__` : `__slate_${label}_${count}__`; count++; } while (used.has(candidate));
    counts.set(label, count); used.add(candidate); return candidate;
  }
  const originals = virtual("originals"), inline = virtual("inline"), dataImages = new Map<string, string>();
  const originalsDraft = (path: string, bytes: Uint8Array) => drafts.push({ kind: "raw", source: originals + "/" + path, target: "Sources/" + path, bytes });
  const bundles = new Map<string, { main: string; plain: boolean }>();
  for (const path of Object.keys(entries)) {
    const root = /^(.*\.(?:textbundle|bearnote))\//i.exec(path)?.[1]; if (!root || bundles.has(root)) continue;
    const info = entries[root + "/info.json"]; if (!info) throw Error("Choose the whole TextBundle, including info.json and its assets.");
    let metadata: unknown; try { metadata = JSON.parse(decodeText(info)); } catch { throw Error("A TextBundle contains invalid metadata."); }
    const data = metadata as Record<string, unknown> | null;
    if (!data || typeof data.version !== "number" || ![1, 2].includes(data.version) || data.type !== undefined && (typeof data.type !== "string" || !["net.daringfireball.markdown", "public.plain-text", "public.utf8-plain-text"].includes(data.type))) throw Error("Export this TextBundle as Markdown or plain text.");
    const main = Object.keys(entries).filter(path => path.startsWith(root + "/") && /^(?:text\.(?:md|markdown|txt))$/i.test(path.slice(root.length + 1)));
    if (main.length !== 1) throw Error("A TextBundle must contain one text document. Choose the whole export.");
    bundles.set(root, { main: main[0]!, plain: data.type !== undefined && data.type !== "net.daringfireball.markdown" });
  }
  for (const [raw, bytes] of Object.entries(entries)) {
    const path = validateImportSourcePath(raw), parts = path.split("/");
    let bundleIndex = parts.length - 2;
    while (bundleIndex >= 0 && !/\.(?:textbundle|bearnote)$/i.test(parts[bundleIndex]!)) bundleIndex--;
    const bundle = bundleIndex >= 0, bundleName = bundle ? parts[bundleIndex]!.replace(/\.(?:textbundle|bearnote)$/i, "") : "";
    let target = parts.map(part => part.replace(/\.(?:textbundle|bearnote)$/i, "")).join("/");
    if (/\.enex$/i.test(path)) {
      if (source !== "evernote") throw Error("Choose Evernote to import an ENEX export.");
      drafts.push(...planEnexDrafts(path, bytes, virtual("enex"))); originalsDraft(path, bytes); continue;
    }
    if (/\.(?:md|markdown)$/i.test(path) || bundle && /\/text\.txt$/i.test(path)) {
      const root = /^(.*\.(?:textbundle|bearnote))\//i.exec(path)?.[1], info = root && bundles.get(root);
      if (bundle && /\/text\.(?:md|markdown|txt)$/i.test(path)) target = target.replace(/\/text\.[^/]+$/i, `/${bundleName}.md`);
      else target = target.replace(/\.(?:md|markdown)$/i, ".md");
      drafts.push({ kind: /\.txt$/i.test(path) || info && info.main === path && info.plain ? "text" : "markdown", source: path, target, text: text(bytes, path) }); continue;
    }
    if (/\.html?$/i.test(path)) {
      const markup = prepareImportMarkup(text(bytes, path));
      const title = markup.title || path.split("/").at(-1)!.replace(/\.html?$/i, "");
      drafts.push({ kind: "markup", source: path, target: target.replace(/\.html?$/i, ".md"), markup, prefix: markup.root.querySelector("h1") ? "" : "# " + escapeImportText(title) + "\n\n" });
      originalsDraft(path, bytes); continue;
    }
    if (source === "notion" && /\.csv$/i.test(path)) {
      drafts.push({ kind: "csv", source: path, target: target.replace(/\.csv$/i, ".md"), text: text(bytes, path) }); originalsDraft(path, bytes); continue;
    }
    drafts.push({ kind: "raw", source: path, target, bytes });
  }
  for (const draft of [...drafts]) if (draft.kind === "markup") for (const image of draft.markup.root.querySelectorAll("img[src]")) {
    const url = image.getAttribute("src")!; if (!/^data:/i.test(url) || dataImages.has(url)) continue;
    const match = /^data:([^;,]+);base64,([\s\S]*)$/i.exec(url);
    if (!match) throw Error("An embedded image has an unsupported data encoding. The original export was kept.");
    const bytes = decodeImportBase64(match[2]!), filename = importResourceHash(bytes) + "." + importMimeExtension(match[1]!), path = inline + "/" + filename;
    const existing = drafts.find(item => item.source === path);
    if (existing && (existing.kind !== "raw" || existing.bytes.length !== bytes.length || existing.bytes.some((byte, index) => byte !== bytes[index]))) throw Error("Two imported images share an identifier. The original export was kept.");
    if (!existing) drafts.push({ kind: "raw", source: path, target: "Attachments/" + filename, bytes });
    dataImages.set(url, path);
  }
  const paths = allocateImportPaths(drafts, source === "notion"), resolve = createImportLinkResolver(paths, source === "notion"), output = Object.create(null) as Record<string, Uint8Array>, notes: string[] = [];
  let total = 0;
  for (const draft of drafts) {
    const target = paths.get(draft.source)!;
    let bytes: Uint8Array;
    if (draft.kind === "raw") bytes = draft.bytes;
    else {
      let content: string;
      if (draft.kind === "markup") {
        const local = (url: string) => { const original = resolveImportSourcePath(draft.source, url); return original ? paths.get(original) : undefined; };
        content = draft.prefix + convertImportMarkup(draft.markup, {
          warn: message => warnings.add(message),
          link(url) {
            if (/^(?:https?:|mailto:|#)/i.test(url)) return markdownUrl(resolve(draft.source, url));
            const asset = local(url); if (asset) return relativeImportLink(target, asset);
            warnings.add(`A link could not be resolved from the export: ${url.slice(0, 160)}`); return undefined;
          },
          image(url, alt) {
            const asset = dataImages.has(url) ? paths.get(dataImages.get(url)!) : local(url), label = escapeImportText(alt || "Image");
            if (asset) return `${raster.test(asset) ? "!" : ""}[${label}](${relativeImportLink(target, asset)})`;
            if (/^https?:\/\//i.test(url)) { warnings.add("Remote images were kept as links and were not downloaded."); return `[${label}](${markdownUrl(url)})`; }
            warnings.add(`An image was not included in the export: ${url.slice(0, 160)}`); return `[${label}: attachment unavailable]`;
          },
          media(hash, mime, alt) {
            const original = draft.media?.get(hash.toLowerCase()), asset = original && paths.get(original);
            if (!asset) { warnings.add(`An Evernote attachment was missing: ${hash.slice(0, 64)}`); return `[Attachment unavailable: ${escapeImportText(alt)}]`; }
            return `${/^image\//.test(mime) && raster.test(asset) ? "!" : ""}[${escapeImportText(alt)}](${relativeImportLink(target, asset)})`;
          },
        });
      } else content = draft.kind === "csv" ? "# " + escapeImportText(portableImportName(stem(target.split("/").at(-1)!))) + "\n\n" + csvMarkdown(draft.text) : draft.kind === "text" ? escapeImportText(draft.text) : draft.text;
      bytes = encodeText(draft.kind === "markup" ? content : rewriteImportMarkdown(content, url => resolve(draft.source, url)));
      notes.push(target);
    }
    total += bytes.length; if (total > 500 * 1024 * 1024) throw Error("The converted import exceeds 500 MB.");
    output[target] = bytes;
  }
  if (!notes.length) throw Error(`No supported notes were found in the ${provider.name} export. Choose ${provider.formats}.`);
  return { source, label: `Imported from ${provider.name}`, entries: output, notes, warnings: [...warnings] };
}
