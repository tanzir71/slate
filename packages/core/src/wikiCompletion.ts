export interface WikiCompletionTarget {
  readonly id: string;
  readonly path: string;
  readonly title: string;
}

function normalizedPath(value: string): string | undefined {
  const path = value.replaceAll("\\", "/").replace(/^(?:\.\/)+/, "");
  if (
    !path ||
    /[\r\n\0]/.test(path) ||
    path.startsWith("/") ||
    path.split("/").some((part) => !part || part === "..")
  )
    return;
  return path;
}

export interface WikiPathIndex<T extends { readonly path: string }> {
  readonly exact: ReadonlyMap<string, T | undefined>;
  readonly aliases: ReadonlyMap<string, T | undefined>;
  readonly folded: ReadonlyMap<string, T | undefined>;
}

/** Build once when file identities change; ambiguous aliases remain unresolved. */
export function createWikiPathIndex<T extends { readonly path: string }>(
  sheets: readonly T[],
): WikiPathIndex<T> {
  const exact = new Map<string, T | undefined>();
  const aliases = new Map<string, T | undefined>();
  const folded = new Map<string, T | undefined>();
  const unique = (map: Map<string, T | undefined>, key: string, sheet: T) =>
    map.set(key, map.has(key) ? undefined : sheet);
  for (const sheet of sheets) {
    const path = normalizedPath(sheet.path);
    if (!path) continue;
    const alias = path.replace(/\.md$/i, "");
    unique(exact, path, sheet);
    unique(aliases, alias, sheet);
    unique(folded, alias.toLowerCase(), sheet);
  }
  return { exact, aliases, folded };
}

export function resolveWikiPath<T extends { readonly path: string }>(
  index: WikiPathIndex<T>,
  target: string,
): T | undefined {
  if (!/[/\\]/.test(target) && !/\.md$/i.test(target)) return;
  const path = normalizedPath(target);
  if (!path) return;
  if (index.exact.has(path)) return index.exact.get(path);
  const alias = path.replace(/\.md$/i, "");
  if (index.aliases.has(alias)) return index.aliases.get(alias);
  return index.folded.get(alias.toLowerCase());
}

/** Resolve explicit wiki paths before a title lookup; exact case wins. */
export function findWikiPath<T extends { readonly path: string }>(
  sheets: readonly T[],
  target: string,
): T | undefined {
  return resolveWikiPath(createWikiPathIndex(sheets), target);
}

/** Canonical paths disambiguate equal titles without changing either file. */
export function wikiCompletionText(
  target: WikiCompletionTarget,
): string | undefined {
  const safe = (text: string) =>
    !!text && text === text.trim() && !/[\r\n\0|\]]/.test(text);
  const reference =
    safe(target.path) && normalizedPath(target.path) !== undefined
      ? target.path
      : /^01[0-9A-HJKMNP-TV-Z]{24}$/i.test(target.id)
        ? `id:${target.id.toUpperCase()}`
        : undefined;
  if (!reference) return;
  const label =
    target.title &&
    !/[\r\n\0\]]/.test(target.title) &&
    target.title !== reference
      ? `|${target.title}`
      : "";
  return `[[${reference}${label}]]`;
}
