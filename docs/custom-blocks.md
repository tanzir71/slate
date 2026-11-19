# Custom blocks (unreleased v0.5 work)

The browser implementation is under verification on the development branch. The public app remains v0.2.1. Native custom-block management is pending.

Choose **Sheet actions → Manage custom blocks**, **Manage custom blocks** in Editor settings, or **Edit blocks in Settings → Blocks** in the slash preview. Add a name and ordinary Markdown, then save. Files live in `.slate/blocks/` in the selected folder or browser library. Existing Markdown files and nested folders are discovered there too. The filename supplies the result name; its relative path distinguishes duplicate names. New names use portable filenames and numbered copies when a file already exists.

Type `/` followed by a name to find a block. Arrow keys select, Tab switches to the preview, Enter inserts, and Escape keeps your writing. Search matches names and relative paths, including fuzzy matches; the slash query itself excludes an internal slash, so `/TeamReview` can match `Team/Review.md`. The gutter's block menu accepts a normal search string. Custom fragments share the Blocks group and ranking with built-ins.

Fragments insert literally. YAML, `{{title}}`, `${1:Field}` and `$0` remain ordinary source; use [templates](templates.md) or [snippets](snippets.md) for variables and fields. Insertion removes the fragment file's leading BOM, uses the note's line-ending convention, and adds missing blank separation. It preserves indentation and trailing breaks and forms one undo step. Its source file is unchanged. Each fragment may contain up to 1 MiB of UTF-8.

Definitions refresh on startup, focus, saves and visible file polling, with advisory updates between tabs. Choosing a result re-reads its file. If its source changed, review the refreshed preview and choose again. If the sheet or selection changed during that read, your newer writing is retained.

Settings edits save against the original file bytes. External changes keep the primary file and save your proposal in a separate conflict copy. **Review current file** reloads the primary for another edit; both versions remain on disk. Unsupported encodings stay read-only and offer **Download original file**. A read-only tab can prepare a draft and choose **Use here** to regain write ownership before saving. Offline use follows the same file and conflict rules.
