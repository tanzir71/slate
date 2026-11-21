import { LanguageDescription, LanguageSupport, StreamLanguage } from "@codemirror/language";

const plainCode = new LanguageSupport(StreamLanguage.define({
  name: "Plain text",
  token(stream) { stream.skipToEnd(); return null; },
}));
const descriptions = new Map<string, LanguageDescription>();

/** Load the catalog and the chosen grammar only after a fenced language is parsed. */
export function lazyCodeLanguage(info: string): LanguageDescription {
  const name = info.toLowerCase();
  let description = descriptions.get(name);
  if (!description) {
    description = LanguageDescription.of({ name, async load() {
      try {
        const { languages } = await import("@codemirror/language-data");
        return await (LanguageDescription.matchLanguageName(languages, name, false)?.load() ?? plainCode);
      } catch { return plainCode; }
    } });
    if (descriptions.size >= 256) descriptions.delete(descriptions.keys().next().value!);
    descriptions.set(name, description);
  }
  return description;
}
