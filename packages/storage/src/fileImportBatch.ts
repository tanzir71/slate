import { portableImportName } from "@slate/core";
import { encodeText, safeWorkspacePath, type WorkspaceFiles } from "./fileIO";

type Create = (path: string, bytes: Uint8Array) => Promise<boolean>;
type Serialize = <T>(work: () => Promise<T>) => Promise<T>;
const same = (left: Uint8Array | undefined, right: Uint8Array) => left?.length === right.length && left.every((byte, index) => byte === right[index]);
const folded = (path: string) => path.normalize("NFC").toLowerCase();
const marker = ".slate-import.json";

/** Fixed relative paths keep rewritten links valid; every actual file creation remains conditional. */
export function createFileImportBatch(files: WorkspaceFiles, create: Create, serialize: Serialize, label: string, entries: Readonly<Record<string, Uint8Array>>, id = crypto.randomUUID()) {
  if (!label || label.includes("/") || label.includes("\\") || portableImportName(label) !== label) throw Error("Choose a portable import notebook name.");
  const paths = Object.keys(entries), names = new Set<string>();
  for (const path of paths) {
    if (safeWorkspacePath(path) !== path || path.split("/").some(part => portableImportName(part) !== part) || folded(path) === marker || folded(path).startsWith(marker + "/")) throw Error("An import contains an invalid destination path.");
    const key = folded(path); if (names.has(key)) throw Error("An import contains colliding destination paths."); names.add(key);
  }
  for (const path of names) {
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index++) if (names.has(parts.slice(0, index).join("/"))) throw Error("An import file collides with a destination folder.");
  }
  const proposed = paths.map(path => [path, entries[path]!.slice()] as const);
  let root: string | undefined, attempted: string | undefined;
  const manifest = (folder: string) => encodeText(JSON.stringify({ version: 1, id, root: folder, label, files: paths.length }));
  async function reserve(): Promise<string> {
    if (root) return root;
    if (attempted && same(await files.read(attempted + "/" + marker), manifest(attempted))) { root = attempted; return root; }
    const existing = (await files.list(true)).map(folded);
    for (let count = 1; ; count++) {
      const candidate = count === 1 ? label : `${label} (${count})`, key = folded(candidate);
      if (existing.some(path => path === key || path.startsWith(key + "/"))) continue;
      attempted = candidate;
      const bytes = manifest(candidate);
      if (await create(candidate + "/" + marker, bytes) || same(await files.read(candidate + "/" + marker), bytes)) { root = candidate; return root; }
    }
  }
  return {
    get root() { return root ?? attempted; },
    run() {
      return serialize(async () => {
        try {
          const folder = await reserve(), saved: string[] = [];
          for (const [path, bytes] of proposed) {
            const target = folder + "/" + path;
            if (!await create(target, bytes) && !same(await files.read(target), bytes)) throw Error(`A file changed or already exists: ${target}. Existing and imported files were kept.`);
            saved.push(target);
          }
          return saved;
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "The import could not be completed.";
          throw Error(`${message}${root ?? attempted ? ` Files saved so far remain in ${root ?? attempted}. Retry to continue without replacing them.` : " Your existing notes were kept."}`);
        }
      });
    },
  };
}
