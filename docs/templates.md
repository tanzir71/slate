# Templates (unreleased v0.5 work)

The F-40 core format and renderer are implemented. The gallery, file-creation UI, notebook defaults, daily-note carry-over and starter kits are still being connected.

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
