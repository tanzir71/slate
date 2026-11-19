# Tidy core (unreleased)

The development engine is available through `@slate/core/tidy`. The public app remains v0.2.1. The unreleased browser workspace connects a real Web Worker, review panel, settings-file adapter and optional on-save formatting. Batch review and native review/on-save controls remain required work.

In the development browser app, choose `Tidy · N` in the status bar or press `Alt Shift F`. The panel temporarily shows Source mode with line numbers and issue tints. Review a proposed diff without writing, apply one fix or all safe fixes, or persist an ignored rule. Every application is one undo step; closing the panel restores the previous pane layout. Structural warnings require a manual edit. Reports and fixes run in a worker, with bounded latest-only queuing and fresh source/path/configuration/ownership checks before applying. A worker failure stays visible and leaves the note intact.

The settings dialog retains its opening file snapshot. An external JSON edit wins the canonical path; saving a stale proposal preserves a conflict copy and keeps the draft visible. Unknown JSON text and numeric spelling are retained. Unsupported bytes are read-only, while malformed JSON in readable UTF-8 text can be explicitly repaired. Markdown BOM/CRLF survive Tidy and Undo through disk storage. Source review is temporary; persistent Live/Source/Read controls belong to F-11.

`lint(source, configuration)` returns source-bound issues with original UTF-16 edit spans. `fix(source, configuration, issueIds?)` returns proposed output, a minimal original-source change, applied/rejected issues and remaining diagnostics. Passing selected issue IDs applies only those requests; an empty selection changes nothing. Neither function writes files.

```ts
import { lint, fix, readTidyConfiguration } from "@slate/core/tidy";

const configuration = readTidyConfiguration();
const report = lint(source, configuration);
const selected = report.issues.map((issue) => issue.id);
const result = fix(report.source, configuration, selected);
```

The caller must keep the original editor/file snapshot and current write ownership when applying output. Every accepted atomic repair is checked against the original normalized content projection. Independent repairs remain available when another proposal is rejected. Apply the resulting change as one undoable transaction.

The projection retains Markdown structure, list starts, task states, links, table alignment, literal code/HTML, YAML values/comments, numeric spellings, BOM and exact wiki links/aliases. Invalid, unknown-tagged, alias-bearing or non-string-keyed YAML stays literal. Whitespace collapses only in ordinary text; positions, presentation-only list spread and table padding do not affect the comparison.

Some diagnostics require a manual edit. Heading-level jumps, missing fence languages and mismatched table columns are warnings. Turning literal `#Heading` or `* word *` into different Markdown structure also requires a manual edit. A rejected fix keeps the original source; there is no force option.

The configuration format intended for `.slate/tidy.json` is versioned:

```json
{
  "version": 1,
  "preset": "slate",
  "rules": { "bare-urls": false },
  "keepHardBreaks": true,
  "onSave": false
}
```

Missing fields use defaults. Invalid JSON, unsupported versions, explicit null fields and invalid known rule values are rejected. Unknown fields and future rule metadata are retained by the configuration model.

| Preset | Behavior |
| --- | --- |
| `slate` | Appendix-D conventions, including table alignment and YAML style; bare URLs stay opt-in. |
| `github` | Common markdownlint conventions; Slate-specific table alignment and YAML style stay off. |
| `minimal` | Whitespace cleanup plus heading-level, fence-language and table-column warnings. |

Individual boolean rule overrides take precedence. With `keepHardBreaks: true`, a genuine Markdown hard break keeps two trailing spaces. Setting it to false replaces those spaces with the equivalent backslash marker; the line break itself is preserved by the content guarantee.

On-save defaults to off. Enable **Tidy on save** in the browser review panel to format after a successful input save or explicit Save. Enabling the switch and opening/importing a note do not format it. Recovery saves preserve the recovered source without triggering Tidy. Explicit Save also handles an unchanged open note. Invalid, unsupported or unavailable settings disable automatic changes.

The original input is saved first. A matching worker report supplies one isolated Tidy transaction; normal autosave persists its output. One Undo restores the original source and stays restored through background saving. Redo and Tidy's own save cannot start a formatting loop. Another real edit or explicit Save can format again. New typing, another path, changed rules or lost ownership invalidate stale proposals. Worker errors keep the original saved input and appear in the review panel.

Parser selection uses CommonMark only when no GFM construct can occur; candidate syntax, escapes and entities retain the full GFM parser. Exact tree/position equivalence is checked against the full parser. Apply-all can combine disjoint repairs and subsumed tab/blank/pipe repairs into one proof; per-rule/per-issue checks handle overlaps and rejected proposals.

Large-document acceptance is still open. Latest local CPU diagnostics for 50,000 body words measure approximately 50 ms for flat lint, 114 ms for dirty-flat fix, and 78 ms for paragraph lint. A 5,000-item list still takes about 906 ms, above the 150 ms target. These are engine diagnostics, not a passing browser-worker gate. Prior measurements are retained in `artifacts/f61-*`; no release limit has been relaxed.

The first real-worker benchmark on the F-62 review runtime also fails the unchanged 150 ms limit. All 16 source-binding/output checks and the untouched-sheet assertions pass before timing assertions. Request-to-reply times below are local pinned-Linux diagnostics with Node 26.13.1 and Playwright 1.65.1; GitHub Actions Linux with Node 24 remains the release reference. The first request includes worker construction/startup. Separate internal CPU measurements, raw results, traces and screenshots remain in `artifacts/f62-tidy-first*`; no case was retried.

| 50,000 body words | Chromium | Firefox | WebKit | Mobile |
| --- | ---: | ---: | ---: | ---: |
| Flat lint, including startup | 117.6 ms | 119 ms | 81 ms | 165 ms |
| Dirty-flat fix | 141.1 ms | 170 ms | 114 ms | 169.7 ms |
| 500-paragraph lint | 75.2 ms | 120 ms | 114 ms | 97.4 ms |
| 5,000-item-list fix | 656 ms | 2,413 ms | 1,380 ms | 788.1 ms |

The subsequent scoped parser 2.1.0 checkpoint removes the known per-item event-array movement and retains strict compatibility with the test-only 2.0.3 parser. Its first new-runtime measurements below still fail the 150 ms requirement. All source-binding, exact-output and untouched-sheet checks pass; no run is retried or substituted. Raw results and CPU profiles remain in `artifacts/parser-210-*` and `artifacts/f62-dense-*`.

| 50,000 body words, parser 2.1.0 | Chromium | Firefox | WebKit | Mobile |
| --- | ---: | ---: | ---: | ---: |
| Flat lint, including startup | 58.1 ms | 111 ms | 74 ms | 67.1 ms |
| Dirty-flat fix | 71.2 ms | 182 ms | 93 ms | 77 ms |
| 500-paragraph lint | 46.5 ms | 124 ms | 99 ms | 58.9 ms |
| 5,000-item-list fix | 503.8 ms | 1,286 ms | 749 ms | 435.3 ms |

`createTidyFileStore(space)` reads `.slate/tidy.json` without creating it. Missing settings use caller-selected defaults; malformed text stays available for explicit repair. Unsupported bytes and read failures remain visible and cannot be saved over through those snapshots. Saves validate known fields and retain the exact entered JSON, including UTF-8 BOM, whitespace and unknown numeric spelling. The Space serializes writes, checks original bytes and returns a separate conflict copy if an external edit won. UI callers must show conflicts and keep on-save disabled when configuration cannot be read.
