export interface KeymapConfiguration extends Record<string, unknown> {
  version: 1;
  bindings: Record<string, string | null>;
}

/** Editing preserves extension fields and leaves malformed source untouched. */
export function readKeymapSource(
  source: string | undefined,
): KeymapConfiguration {
  if (source === undefined) return { version: 1, bindings: {} };
  const value: unknown = JSON.parse(source.replace(/^\uFEFF/, ""));
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("version" in value) ||
    value.version !== 1 ||
    !("bindings" in value) ||
    typeof value.bindings !== "object" ||
    value.bindings === null ||
    Array.isArray(value.bindings) ||
    Object.values(value.bindings).some(
      (binding) => binding !== null && typeof binding !== "string",
    )
  ) {
    throw new Error(
      "Use keymap version 1 with a bindings object containing shortcuts or null.",
    );
  }
  return value as KeymapConfiguration;
}

export function editKeymapSource(
  source: string | undefined,
  commandId: string,
  shortcut: string | null | undefined,
): string {
  const configuration = readKeymapSource(source);
  const bindings = { ...configuration.bindings };
  if (shortcut === undefined) delete bindings[commandId];
  else
    Object.defineProperty(bindings, commandId, {
      value: shortcut,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  return serializeKeymap(source, { ...configuration, bindings });
}

export function resetKeymapSource(source: string | undefined): string {
  return serializeKeymap(source, { ...readKeymapSource(source), bindings: {} });
}

function serializeKeymap(
  previous: string | undefined,
  value: KeymapConfiguration,
): string {
  const newline = previous?.includes("\r\n") ? "\r\n" : "\n";
  return (
    (previous?.startsWith("\uFEFF") ? "\uFEFF" : "") +
    (JSON.stringify(value, null, 2) + "\n").replaceAll("\n", newline)
  );
}
