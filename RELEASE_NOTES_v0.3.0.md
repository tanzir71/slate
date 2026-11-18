# Slate v0.3.0 — New look, faster formatting

[Open Slate in your browser](https://tanzir71.github.io/slate/app/) · [Website](https://tanzir71.github.io/slate/)

Slate now has Light, Dark and System appearance, locally bundled Geist and Newsreader fonts, and a redesigned workspace that adapts to smaller screens.

- Browse notebooks, pin sheets, switch list density and keep your navigation preferences with the Space.
- Format with the shared command palette, searchable keyboard shortcut sheet and floating selection toolbar. Each formatting action undoes in one step.
- See headings, emphasis, highlights, links, tags and task checkboxes rendered while writing. Your Markdown stays plain text.
- Open writing statistics, reading time and cursor navigation from the status bar.
- Preview the real Light or Dark workspace on the landing page, including the compact layout.

This release also includes the completed browser editing and creation tools built while the strict performance gate was being addressed:

- Insert built-in blocks with `/`, their Markdown previews, and keyboard or block-gutter controls.
- Continue, indent, renumber and move lists; edit tables with Tab and column commands; complete code fences and front matter.
- Paste rich clipboard content as Markdown, import clipboard images beside the note, and use plain paste when needed.
- Create notes from twelve bundled Markdown templates or editable Space templates, with prompts, destinations and per-notebook defaults.
- Open today's daily note and carry unfinished tasks from the latest earlier daily note. Existing files are preserved.

Starter kits, snippets and custom blocks are still in development. Native previews do not yet expose the browser's complete file and template workflows.

`Ctrl/Cmd I` is Italic. Inspector uses `Ctrl/Cmd Shift I`. In a browser, New sheet uses `Alt N` to avoid the browser's reserved New window command. The shortcut sheet shows the bindings for your current OS and app surface.

Existing `.md` files need no conversion. Recovery preserves newer drafts when another tab or an older open version takes over; the search index remains a rebuildable local cache.

## Desktop previews

Windows x64, Linux x64 and universal macOS downloads are **unsigned previews**, with SHA-256 checksums and source-commit manifests. Read the [platform instructions and native limitations](https://github.com/tanzir71/slate/blob/v0.3.0/docs/desktop-preview.md) before using them. The native preview still starts with sample sheets and does not yet reopen saved files through its UI. Use the browser workspace for everyday save/reopen/export.

The browser app remains free, local and account-free. Tidy, broader navigation tools, signed desktop distribution, automation and opt-in Sync follow in later releases.
