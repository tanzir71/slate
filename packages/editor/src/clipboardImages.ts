import { readClipboardFragment } from "./clipboardFragment.js";
export interface ClipboardImageReference {
  readonly path: string;
  readonly alt?: string;
}
export type SaveClipboardImage = (
  file: File,
) => Promise<ClipboardImageReference>;
export interface PreparedClipboardImages {
  readonly html: string;
  readonly embedded: readonly ClipboardImageReference[];
  readonly extra: readonly ClipboardImageReference[];
}
function decodedBytes(payload: string): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(payload.length * 3);
  const encoder = new TextEncoder();
  let position = 0,
    written = 0;
  while (position < payload.length) {
    if (
      payload[position] === "%" &&
      /^[\da-f]{2}$/i.test(payload.slice(position + 1, position + 3))
    ) {
      output[written++] = Number.parseInt(
        payload.slice(position + 1, position + 3),
        16,
      );
      position += 3;
    } else {
      const next = payload.indexOf("%", position + 1);
      const end = next < 0 ? payload.length : next;
      const bytes = encoder.encode(payload.slice(position, end));
      output.set(bytes, written);
      written += bytes.length;
      position = end;
    }
  }
  return output.slice(0, written);
}
function embeddedFile(src: string, name: string): File | undefined {
  const source = src.split("#", 1)[0]!;
  const data = /^data:(image\/[a-z\d.+-]+)((?:;[^,]*)?),([\s\S]*)$/i.exec(
    source,
  );
  if (!data) return;
  const type = data[1]!.toLowerCase(),
    payload = data[3]!;
  let bytes: Uint8Array<ArrayBuffer>;
  if (/;base64(?:;|$)/i.test(data[2]!)) {
    const encoded = payload.includes("%")
      ? new TextDecoder().decode(decodedBytes(payload))
      : payload;
    const binary = atob(encoded);
    bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++)
      bytes[index] = binary.charCodeAt(index);
  } else bytes = decodedBytes(payload);
  const extension =
    type === "image/svg+xml"
      ? "svg"
      : type === "image/jpeg"
        ? "jpg"
        : type.slice(6).replace(/[^a-z\d]/g, "");
  return new File([bytes], name + "." + extension, { type });
}
function sourceFilename(src: string): string | undefined {
  if (/^(?:data|blob):/i.test(src)) return;
  try {
    return decodeURIComponent(
      new URL(src, "https://clipboard.invalid/").pathname.split("/").at(-1) ??
        "",
    );
  } catch {
    return;
  }
}
/** Associate only unambiguous file representations of a copied image. */
function attachedImages(
  sources: ReadonlySet<string>,
  files: readonly File[],
): Map<string, File> {
  if (files.length === 1 && sources.size === 1)
    return new Map([[Array.from(sources)[0]!, files[0]!]]);
  const byName = new Map<string, File | undefined>();
  for (const file of files)
    byName.set(file.name, byName.has(file.name) ? undefined : file);
  const names = new Map<string, string>(),
    counts = new Map<string, number>();
  for (const src of sources) {
    const name = sourceFilename(src);
    if (!name) continue;
    names.set(src, name);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const matched = new Map<string, File>();
  for (const [src, name] of names) {
    const file = byName.get(name);
    if (file && counts.get(name) === 1) matched.set(src, file);
  }
  return matched;
}
function cachedImage(
  src: string,
  file: File,
  save: SaveClipboardImage,
  cache: Map<string, Promise<ClipboardImageReference>>,
): Promise<ClipboardImageReference> {
  const previous = cache.get(src);
  if (previous) return previous;
  const pending = Promise.resolve().then(() => save(file));
  cache.set(src, pending);
  void pending.catch(() => cache.delete(src));
  return pending;
}
function imageAlt(file: File): string {
  return file.name.replace(/\.[^.]*$/, "") || "Image";
}
export async function prepareClipboardImages(
  html: string,
  files: readonly File[],
  save: SaveClipboardImage,
  cache = new Map<string, Promise<ClipboardImageReference>>(),
): Promise<PreparedClipboardImages> {
  const root = readClipboardFragment(html);
  const images = Array.from(root.querySelectorAll("img"));
  const sources = new Set(
    images.map((image) => image.getAttribute("src") ?? ""),
  );
  const associations = attachedImages(sources, files),
    used = new Set<File>();
  const embedded: ClipboardImageReference[] = [],
    extra: ClipboardImageReference[] = [];
  for (const image of images) {
    const src = image.getAttribute("src") ?? "";
    const attached = associations.get(src);
    const file =
      attached ?? embeddedFile(src, image.getAttribute("alt") || "image");
    if (!file) continue;
    if (attached) used.add(attached);
    const saved = await cachedImage(src, file, save, cache);
    const alt = image.getAttribute("alt") ?? saved.alt ?? imageAlt(file);
    image.setAttribute("src", saved.path);
    image.setAttribute("alt", alt);
    embedded.push({ path: saved.path, alt });
  }
  for (const file of files)
    if (!used.has(file)) {
      const saved = await save(file);
      extra.push({ path: saved.path, alt: saved.alt ?? imageAlt(file) });
    }
  const holder = document.createElement("template");
  holder.content.appendChild(root);
  return { html: holder.innerHTML, embedded, extra };
}
