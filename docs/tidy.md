# Tidy core (unreleased)

The development engine is available through `@slate/core/tidy`. The public app remains v0.2.1. The worker, review panel, settings-file adapter, on-save integration and batch review are still being implemented.

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

Individual boolean rule overrides take precedence. With `keepHardBreaks: true`, a genuine Markdown hard break keeps two trailing spaces. Setting it to false replaces those spaces with the equivalent backslash marker; the line break itself is preserved by the content guarantee. On-save defaults to off and has no runtime integration yet.

Parser selection uses CommonMark only when no GFM construct can occur; candidate syntax, escapes and entities retain the full GFM parser. Exact tree/position equivalence is checked against the full parser. Apply-all can combine disjoint repairs and subsumed tab/blank/pipe repairs into one proof; per-rule/per-issue checks handle overlaps and rejected proposals.

Large-document acceptance is still open. Latest local CPU diagnostics for 50,000 body words measure approximately 50 ms for flat lint, 114 ms for dirty-flat fix, and 78 ms for paragraph lint. A 5,000-item list still takes about 906 ms, above the 150 ms target. These are engine diagnostics, not a passing browser-worker gate. Prior measurements are retained in `artifacts/f61-*`; no release limit has been relaxed.
