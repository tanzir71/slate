import { templateOutputPath } from "./templatePath.js";

interface LaunchScope { readonly space?: string }
export type LaunchAction = LaunchScope & (
  | { readonly kind: "new"; readonly notebook: string; readonly title: string; readonly text: string; readonly template?: string }
  | { readonly kind: "open"; readonly path: string }
  | { readonly kind: "open-files" }
  | { readonly kind: "append"; readonly path: string; readonly text: string }
  | { readonly kind: "search"; readonly query: string }
  | { readonly kind: "today" }
  | { readonly kind: "capture"; readonly text: string }
);

const parameters: readonly string[] = ["action", "space", "notebook", "title", "text", "template", "path", "query", "q", "url"];
const fields: Readonly<Record<string, readonly string[]>> = {
  new: ["notebook", "title", "text", "template"], open: ["path"], append: ["path", "text"],
  search: ["query", "q"], today: [], capture: ["title", "text", "url"],
};
function assertOrdinaryPath(path: string) {
  if (path.split("/").some(part => /^(?:\.slate|\.git)$/i.test(part)))
    throw new Error("Choose an ordinary Markdown sheet inside this Space.");
}
function destination(value: string): string {
  const path = templateOutputPath(value, "Untitled");
  assertOrdinaryPath(path);
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}
function notePath(value: string): string {
  const path = value.replaceAll("\\", "/"), slash = path.lastIndexOf("/");
  if (path.startsWith("/") || path.includes("//")) throw new Error("Use a relative path inside this Space.");
  if (!/\.md$/i.test(path)) throw new Error("Choose a Markdown sheet ending in .md.");
  const result = templateOutputPath(slash < 0 ? "" : path.slice(0, slash), path.slice(slash + 1));
  assertOrdinaryPath(result);
  return result;
}

/** Transport-neutral decoded parameters; adapters own URL parsing, consent and IO. */
export function parseLaunchActionParameters(entries: Iterable<readonly [string, string]>): LaunchAction | undefined {
  const values = new Map<string, string[]>();
  for (const [key, value] of entries) {
    if (!parameters.includes(key)) continue;
    const previous = values.get(key);
    if (previous) previous.push(value); else values.set(key, [value]);
  }
  if (!values.has("action")) return undefined;
  for (const [key, entries] of values) if (entries.length !== 1) throw new Error("Supply only one " + key + " value.");
  const get = (key: string) => values.get(key)?.[0];
  const action = get("action");
  if (!action) return undefined;
  if (!Object.hasOwn(fields, action)) throw new Error("This Slate action is unavailable.");
  for (const key of values.keys()) if (key !== "action" && key !== "space" && !fields[action]!.includes(key))
    throw new Error("This action does not accept " + key + ".");
  const space = get("space"), scope: LaunchScope = space ? { space } : {};
  switch (action) {
    case "new": {
      const notebook = destination(get("notebook") ?? "Inbox"), title = get("title") || "Untitled";
      const template = get("template");
      if (!template) templateOutputPath(notebook, title);
      return { kind: "new", notebook, title, text: get("text") ?? "", ...(template ? { template } : {}), ...scope };
    }
    case "open": return get("path") ? { kind: "open", path: notePath(get("path")!), ...scope } : { kind: "open-files", ...scope };
    case "append": {
      const path = get("path"), text = get("text");
      if (!path || !text) throw new Error("Appending needs a Markdown path and text.");
      return { kind: "append", path: notePath(path), text, ...scope };
    }
    case "search": {
      if (values.has("query") && values.has("q")) throw new Error("Supply one search query.");
      return { kind: "search", query: get("query") ?? get("q") ?? "", ...scope };
    }
    case "today": return { kind: "today", ...scope };
    case "capture": return { kind: "capture", text: [get("title"), get("text"), get("url")].filter(Boolean).join("\n\n"), ...scope };
    default: throw new Error("This Slate action is unavailable.");
  }
}

/** Append a paragraph without rewriting any existing bytes or trailing blank lines. */
export function appendLaunchText(before: string, text: string): string {
  if (!text) return before;
  const eol = /\r\n|\r|\n/.exec(before)?.[0] ?? "\n";
  let end = before.length, breaks = 0;
  while (end > 0 && breaks < 2) {
    const last = before.charCodeAt(end - 1);
    if (last === 10) { end--; if (end > 0 && before.charCodeAt(end - 1) === 13) end--; }
    else if (last === 13) end--;
    else break;
    breaks++;
  }
  const separator = before && before !== "\uFEFF" ? eol.repeat(2 - breaks) : "";
  return before + separator + text.replace(/\r\n|\r|\n/g, eol);
}
