# Templates (unreleased v0.5 work)

The core format, browser gallery, safe file creation, notebook defaults and 12 built-ins are implemented on the unreleased development branch. Native gallery/default integration, daily-note carry-over and starter kits are still being connected.

Templates are Markdown files in a Space's `.slate/templates/` directory or the app's global library. Optional top-level `template:` properties describe the template:

```yaml
---
template:
  name: Meeting notes
  description: Agenda, decisions and actions
  category: Work
  destination: "product/meetings"
  filename: "{{date:YYYY-MM-DD}}-{{title|slug}}"
title: "{{title}}"
date: "{{date}}"
tags: [meeting]
---
## Agenda
- {{cursor}}
## Notes
{{prompt:Owner|Sam}}
## Decisions
## Action items
- [ ]
```

Creation removes the top-level `template:` key. Sheet properties, nested properties named `template`, comments and body text remain. Quote variables in YAML string properties. The renderer escapes substituted values through YAML, so a title containing quotes or newlines stays one property. YAML property formatting can change; scalar types, comments, BOM, line endings and body bytes are preserved. Invalid YAML and duplicate property keys are reported before file creation.

| Variable | Value |
| --- | --- |
| `{{title}}` | The new sheet's title |
| `{{date}}` / `{{date:FORMAT}}` | Date, default `YYYY-MM-DD` |
| `{{time}}` / `{{time:FORMAT}}` | Time, default `HH:mm` |
| `{{cursor}}` | First caret position; all cursor markers are removed |
| `{{selection}}` | Selected source, or empty text |
| `{{clipboard}}` | Explicitly supplied clipboard text |
| `{{prompt:Label}}` | A named answer |
| `{{prompt:Label|default}}` | A named answer with a default; an empty default is allowed |
| `{{space}}` / `{{notebook}}` | Space name / notebook path |
| `{{id}}` | The caller's new sheet ID |

Filters follow a value: `{{title|slug}}`, `{{title|upper}}`, `{{title|lower}}`. Filters can be chained. Slugs remove punctuation and path separators, fold Latin accents and keep non-Latin letters and marks. A prompt's first pipe introduces its default; later pipes apply filters. Use `\|` for a literal pipe in a prompt label or default. Repeated labels share one answer across properties, comments, body and routing fields; use consistent defaults for repeated labels.

Values are literal and expansion happens once. Unknown variables, unsupported filters, missing values and malformed expressions stay verbatim and are reported with their field and source range. Unresolved filename/destination variables require a value or an explicit routing override. Unknown body variables stay available for review.

Dates and times use one supplied wall-clock date, time and UTC offset. The pure renderer does not read the system clock or locale. Month/day names are English. Supported format tokens include:

| Area | Tokens |
| --- | --- |
| Year/month | `YYYY`, `YY`, `M`, `MM`, `MMM`, `MMMM` |
| Day | `D`, `DD`, `Do`, `DDD`, `DDDD`, `d`, `dd`, `ddd`, `dddd`, `E` |
| Quarter / ISO week | `Q`, `Qo`, `W`, `WW`, `Wo`, `GGGG`, `GG` |
| Hour/minute/second | `H`, `HH`, `h`, `hh`, `m`, `mm`, `s`, `ss` |
| Milliseconds / meridiem | `S`, `SS`, `SSS`, `A`, `a` |
| Offset / Unix timestamp | `Z`, `ZZ`, `X`, `x` |

Bracketed text is literal: `{{date:GGGG-[W]WW}}` produces an ISO week filename component; `{{time:HHmm}}` produces a time component without a colon.

Destinations are relative to the current Space. Filename patterns produce one filename, with `.md` added when needed. Unicode names retain their spelling. Routing rejects traversal, absolute paths, `.slate` configuration directories, reserved device names, invalid characters and components that exceed portable filename limits. Names follow the relevant [Windows naming rules](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file). The plan proposes a path; the storage adapter must choose a free name and preserve existing files.


## Browser gallery

Choose **New from template** in the sheet actions menu or command palette, or press **Alt Shift N** in the web profile. Search the bundled library and your Space templates, choose a starting point, fill in its title, date and named prompts, and choose a notebook path relative to the Space. The preview shows the sheet Markdown with variable expressions; creation resolves them and opens the saved note at its first cursor marker. Clipboard content is supplied manually or read only after clicking **Read clipboard**. If access is unavailable, the manual field remains available. Unknown body variables remain literal and are reported.

The bundled v0.5 library contains Meeting notes, 1:1, Status update, PRD, Decision record, Blog post, Newsletter issue, README, Bug report, Daily note, Weekly review and Reading notes. Category counts reflect the available files. Recent choices are optional local view preferences; templates remain ordinary Markdown.

**Edit template** saves a Space copy of a built-in. The plus beside **My templates** creates a new template. Existing Space templates are edited against their original source: if another application changes that file, Slate keeps it and saves your edit as a conflict copy. Malformed YAML stays visible for repair; unsupported encodings are reported without changing their bytes. Templates are read from `.slate/templates/`, including nested `.md` files, and stay out of the normal note list.

Creation saves the current draft first. Existing destination files, including empty files, are preserved using numbered names. A failed write keeps the form available. Once the new file is committed, a later refresh or notification failure keeps its actual path and saved content available instead of inviting another creation. The gallery works with both browser libraries and selected Folder Spaces; it does not require a server.


## Notebook defaults (unreleased browser work)

Select a notebook, then choose **Notebook default template** in the sheet actions menu. You can also right-click its notebook row or press **Shift F10** while that row has focus. Choose a built-in or a valid Space template and save. Choose **Blank sheet** to clear that notebook's default. Cancelling keeps the current configuration.

Defaults apply to the exact notebook path; child notebooks keep their own choices. **New Sheet** and its web shortcut **Alt N** open the configured template with that notebook as the initial destination, so you can fill in the title and prompts. You may change the destination before creation. The separate **New from template** action continues to browse the library and use the template's configured route. Notebooks without a default continue to create blank sheets.

References live in the optional `notebookTemplates` map in `.slate/view.json`, alongside existing workspace preferences. Built-ins use IDs such as `builtin:meeting-notes`; Space templates use paths such as `.slate/templates/client.md`. Slate reads the latest preferences on each New Sheet action. Missing or malformed templates stay visible for correction, and Slate does not silently create a blank note instead. Invalid preference JSON is reported without replacing that file; the manual gallery remains available. Existing preference edits retain external changes as conflict copies.
