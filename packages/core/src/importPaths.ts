import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { markdownBodyFrom } from "./markdownBody.js";
import { applyTextChanges, type TextChange } from "./textChanges.js";

const uuid = "(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})";
const suffixId = new RegExp(`(?:^|[ _-])(${uuid})(?=(?:\\.[^./]*)?$)`, "i");
const control = (char: string) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127;
export function validateImportSourcePath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  if (/^(?:\/|[a-z]:\/)/i.test(normalized) || normalized.split("/").some(part => !part || part === "." || part === ".." || Array.from(part).some(control)))
    throw Error(`An export contains an unsafe path: ${path}`);
  return normalized;
}
function clipUtf8(value: string, limit: number): string {
  let length = 0, clipped = "";
  for (const char of value) {
    const code = char.codePointAt(0)!, size = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    if (length + size > limit) break;
    clipped += char; length += size;
  }
  return clipped;
}
export function portableImportName(name: string): string {
  let safe = Array.from(name.normalize("NFC"), char => {
    const code = char.codePointAt(0)!;
    return control(char) ? "-" : code >= 0xd800 && code <= 0xdfff ? "�" : char;
  }).join("").replace(/[<>:"\\|?*]/g, "-").trim().replace(/[. ]+$/g, "");
  if (!safe || /^\.+$/.test(safe)) safe = "Untitled";
  if (safe.toLowerCase() === ".md") safe = "Untitled.md";
  if (safe.startsWith(".")) safe = "_" + safe;
  if (/^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|(?:COM|LPT)[1-9¹²³])(?:\.|$)/i.test(safe)) safe = "_" + safe;
  const extension = /\.[a-z\d]{1,16}$/i.exec(safe)?.[0] ?? "", stem = safe.slice(0, safe.length - extension.length);
  return clipUtf8(stem, 200 - extension.length) + extension;
}
const fold = (path: string) => path.normalize("NFC").toLowerCase();
function numbered(path: string, number: number): string {
  const slash = path.lastIndexOf("/"), parent = path.slice(0, slash + 1), name = path.slice(slash + 1);
  const extension = /\.[a-z\d]{1,16}$/i.exec(name)?.[0] ?? "", suffix = ` (${number})`;
  return parent + clipUtf8(name.slice(0, name.length - extension.length), 200 - suffix.length - extension.length) + suffix + extension;
}
export interface ImportPathRequest { readonly source: string; readonly target: string }

/** Allocate directories and files together, preserving distinct export folders after UUID removal. */
export function allocateImportPaths(requests: readonly ImportPathRequest[], notion = false): ReadonlyMap<string, string> {
  const keys = new Set<string>(), occupied = new Set([fold(".slate-import.json")]), directories = new Map([["", ""]]), result = new Map<string, string>();
  for (const request of requests) {
    const source = validateImportSourcePath(request.source);
    if (keys.has(source)) throw Error(`Duplicate paths in export: ${source}`);
    keys.add(source);
  }
  for (const source of keys) {
    const parts = source.split("/");
    for (let index = 1; index < parts.length; index++) if (keys.has(parts.slice(0, index).join("/"))) throw Error("An export contains a file and folder with the same path.");
  }
  function allocate(parent: string, name: string) {
    const base = (parent ? parent + "/" : "") + portableImportName(notion ? name.replace(suffixId, "") : name);
    let target = base, count = 2;
    while (occupied.has(fold(target))) target = numbered(base, count++);
    occupied.add(fold(target)); return target;
  }
  for (const request of [...requests].sort((a, b) => a.source < b.source ? -1 : a.source > b.source ? 1 : 0)) {
    const source = validateImportSourcePath(request.source), from = source.split("/"), to = validateImportSourcePath(request.target).split("/");
    if (from.length !== to.length) throw Error("An import path must preserve its folder structure.");
    let parent = "";
    for (let index = 0; index < from.length - 1; index++) {
      const key = from.slice(0, index + 1).join("/");
      if (!directories.has(key)) directories.set(key, allocate(parent, to[index]!));
      parent = directories.get(key)!;
    }
    result.set(source, allocate(parent, to.at(-1)!));
  }
  return result;
}

export function relativeImportLink(from: string, target: string): string {
  const parent = from.split("/").slice(0, -1), parts = target.split("/");
  while (parent.length && parts[0] === parent[0]) { parts.shift(); parent.shift(); }
  return [...parent.map(() => ".."), ...parts].map(part => encodeURIComponent(part).replace(/[!'()*]/g, char => "%" + char.charCodeAt(0).toString(16).toUpperCase())).join("/");
}
export function resolveImportSourcePath(from: string, url: string): string | undefined {
  if (!url || /^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(url)) return;
  const split = url.search(/[?#]/), raw = split < 0 ? url : url.slice(0, split);
  let decoded: string; try { decoded = decodeURIComponent(raw); } catch { return; }
  const parts = from.split("/").slice(0, -1);
  for (const part of decoded.split("/")) {
    if (part === "." || !part) continue;
    if (part === "..") { if (!parts.length) return; parts.pop(); } else parts.push(part);
  }
  return parts.join("/");
}
export function createImportLinkResolver(paths: ReadonlyMap<string, string>, notion = false) {
  const ids = new Map<string, string | null>();
  if (notion) for (const [source, target] of paths) if (/\.md$/i.test(target)) {
    const id = source.split("/").at(-1)!.match(suffixId)?.[1]?.replaceAll("-", "").toLowerCase();
    if (id) ids.set(id, ids.has(id) ? null : target);
  }
  return (from: string, url: string): string => {
    const base = paths.get(from); if (!base || !url || url.startsWith("#")) return url;
    const split = url.search(/[?#]/), raw = split < 0 ? url : url.slice(0, split), tail = split < 0 ? "" : url.slice(split);
    if (/^[a-z][a-z\d+.-]*:/i.test(raw) || raw.startsWith("//")) {
      if (notion && /^https?:\/\/(?:[\w-]+\.)?notion\.(?:so|site)\//i.test(raw)) {
        const id = raw.match(new RegExp(`(${uuid})(?:$|/)`, "i"))?.[1]?.replaceAll("-", "").toLowerCase(), target = id && ids.get(id);
        if (target) return relativeImportLink(base, target) + tail;
      }
      return url;
    }
    const source = resolveImportSourcePath(from, url), target = source && paths.get(source);
    return target ? relativeImportLink(base, target) + tail : url;
  };
}

interface LinkNode { type: string; url?: string; children?: LinkNode[]; position?: { start: { offset?: number }; end: { offset?: number } } }
function destination(raw: string, definition: boolean): { from: number; to: number } | undefined {
  let index = raw.startsWith("![") ? 2 : raw.startsWith("[") ? 1 : -1, depth = 1;
  if (index < 0) return;
  for (; index < raw.length && depth; index++) {
    if (raw[index] === "\\") index++;
    else if (raw[index] === "[") depth++;
    else if (raw[index] === "]") depth--;
  }
  if (depth || raw[index] !== (definition ? ":" : "(")) return;
  index++; while (/\s/.test(raw[index] ?? "") && index < raw.length) index++;
  const angle = raw[index] === "<", from = angle ? ++index : index;
  depth = 0;
  for (; index < raw.length; index++) {
    const char = raw[index];
    if (char === "\\") { index++; continue; }
    if (angle ? char === ">" : (char === ")" && depth === 0) || /\s/.test(char!)) break;
    if (!angle && char === "(") depth++; else if (!angle && char === ")") depth--;
  }
  return { from, to: index };
}
/** Edit only parsed destination spans; literal examples, front matter and all other bytes stay exact. */
export function rewriteImportMarkdown(source: string, resolve: (url: string) => string): string {
  const offset = markdownBodyFrom(source), root = unified().use(remarkParse).use(remarkGfm).parse(source.slice(offset)) as LinkNode, changes: TextChange[] = [];
  function walk(node: LinkNode) {
    const start = node.position?.start.offset, end = node.position?.end.offset;
    if (["link", "image", "definition"].includes(node.type) && node.url !== undefined && start !== undefined && end !== undefined) {
      const raw = source.slice(offset + start, offset + end), replacement = resolve(node.url), span = replacement !== node.url && destination(raw, node.type === "definition");
      if (span) changes.push({ from: offset + start + span.from, to: offset + start + span.to, text: replacement });
      else if (replacement !== node.url && node.type === "link" && /^<?https?:\/\//i.test(raw)) {
        const label = raw.replace(/^<|>$/g, "").replace(/[[\]\\]/g, "\\$&");
        changes.push({ from: offset + start, to: offset + end, text: `[${label}](${replacement})` });
      }
    }
    for (const child of node.children ?? []) walk(child);
  }
  walk(root); return applyTextChanges(source, changes);
}
