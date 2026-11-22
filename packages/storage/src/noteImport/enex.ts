import { importResourceHash, portableImportName } from "@slate/core";
import { decodeText } from "../fileIO";
import { escapeImportText, parseImportXml, prepareImportMarkup } from "./markup";
import type { NoteImportDraft } from "./types";

export function decodeImportBase64(source: string): Uint8Array {
  const value = source.replace(/\s/g, "");
  const padding = value.indexOf("=");
  if (value.length > 140 * 1024 * 1024 || value.length % 4 !== 0 || /[^A-Za-z\d+/=]/.test(value) || padding >= 0 && (value.length - padding > 2 || /[^=]/.test(value.slice(padding)))) throw Error("An attachment contains invalid or oversized base64 data.");
  const binary = atob(value);
  if (binary.length > 100 * 1024 * 1024) throw Error("An imported attachment exceeds 100 MB.");
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
export function importMimeExtension(mime: string): string {
  return ({ "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg", "image/avif": "avif", "application/pdf": "pdf", "text/plain": "txt", "audio/mpeg": "mp3", "audio/mp4": "m4a", "video/mp4": "mp4" } as Record<string, string>)[mime.toLowerCase()] ?? "bin";
}
const value = (element: Element, name: string) => Array.from(element.children).find(child => child.localName === name)?.textContent ?? "";
function timestamp(source: string): string {
  const match = /^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/.exec(source);
  return match ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z` : source;
}
export function planEnexDrafts(path: string, bytes: Uint8Array, virtual: string): NoteImportDraft[] {
  const root = parseImportXml(decodeText(bytes), "en-export"), drafts: NoteImportDraft[] = [];
  const base = path.replace(/\.enex$/i, ""), parents = base.split("/"), targetRoot = parents.join("/"), sourceRoot = [virtual, ...parents.slice(1)].join("/");
  const notes = Array.from(root.children).filter(note => note.localName === "note");
  if (!notes.length) throw Error("The ENEX export does not contain any notes.");
  notes.forEach((note, index) => {
    const title = value(note, "title").trim() || "Untitled", media = new Map<string, string>(), resourceBytes = new Map<string, Uint8Array>();
    const resources = Array.from(note.children).filter(child => child.localName === "resource");
    resources.forEach((resource, resourceIndex) => {
      const data = Array.from(resource.children).find(child => child.localName === "data");
      if (!data || data.getAttribute("encoding") !== "base64") throw Error("An ENEX attachment does not contain base64 data.");
      const bytes = decodeImportBase64(data.textContent ?? ""), hash = importResourceHash(bytes), previous = resourceBytes.get(hash);
      if (previous && (previous.length !== bytes.length || previous.some((byte, position) => byte !== bytes[position]))) throw Error("Two different ENEX resources share an identifier. The original export was kept.");
      resourceBytes.set(hash, bytes);
      const attributes = Array.from(resource.children).find(child => child.localName === "resource-attributes");
      const filename = portableImportName(attributes ? value(attributes, "file-name") : "") || `attachment.${importMimeExtension(value(resource, "mime"))}`;
      const named = filename === "Untitled" ? `attachment-${resourceIndex + 1}.${importMimeExtension(value(resource, "mime"))}` : filename;
      const source = `${sourceRoot}/resources/note-${index + 1}/resource-${resourceIndex + 1}.${importMimeExtension(value(resource, "mime"))}`;
      drafts.push({ kind: "raw", source, target: `${targetRoot}/resources/note-${index + 1}/${named}`, bytes });
      if (!media.has(hash)) media.set(hash, source);
    });
    const metadata: [string, string | string[]][] = [["title", title], ["imported_from", "Evernote"]];
    for (const key of ["created", "updated"]) { const raw = value(note, key); if (raw) metadata.push([key, timestamp(raw)]); }
    const tags = Array.from(note.children).filter(child => child.localName === "tag").map(tag => tag.textContent ?? "");
    if (tags.length) metadata.push(["tags", tags]);
    const content = value(note, "content"); if (!content.trim()) throw Error(`The ENEX note “${title}” has no content.`);
    const markup = prepareImportMarkup(content, true);
    const prefix = "---\n" + metadata.map(([key, item]) => `${key}: ${JSON.stringify(item)}`).join("\n") + "\n---\n\n" + (markup.root.querySelector("h1") ? "" : "# " + escapeImportText(title) + "\n\n");
    drafts.push({ kind: "markup", source: `${sourceRoot}/note-${index + 1}.md`, target: `${targetRoot}/${portableImportName(title)}.md`, markup, media, prefix });
  });
  return drafts;
}
