# Visual regression

After `pnpm build:site`, run `pnpm visual`. Docker must be running. The command uses the same Linux x64 Chromium reference on Windows, macOS and Linux; host `node_modules` is not mounted into Linux. CI requires this gate on its Linux runner, and Pages requires it before publishing.

The reference is Playwright 1.65.1 Noble, pinned by digest in `scripts/visual-test.mjs`. Tests use bundled fonts, a 1440 × 900 viewport at 1×, en-US/UTC, fixed time, reduced motion and a fixed storage-usage readout. A1/A2/A3/A5 retain the real seven-sheet Sample Space into an OPFS browser library, pin Launch Plan and select its notebook. Service workers are blocked in these visual contexts; offline, updates, installability and each browser engine remain covered by the functional suite.

The twenty-four committed PNGs in `e2e/visual/__screenshots__/` cover:

| View | Light and Dark coverage |
|---|---|
| A1 | Workspace, notebook selection, saved pin, live Markdown and status bar |
| A1 selection | Floating formatting toolbar and selected text |
| A2 | Actual slash query, built-in results, source preview and rendered 3×3 table |
| A2 groups | Space template and snippet results with original family icons and source/rendered previews |
| A3 | Browser template gallery, actual 12-item library counts, source preview and fill-in fields |
| A4 | Dedicated snippet search, real global defaults and original icons |
| A7 | File-backed snippet and custom-block settings, actual definitions and scopes |
| A5 | Read-only shortcut sheet, header search, current browser profile and command labels |
| A6 | Real-worker Tidy review, exact Source text, line numbers/tints, rule cards, controls and settings entry |
| A11 | Browser first-run cards, branding, theme and footer |

The maximum changed-pixel ratio is **0.002 (0.2%)**. Expected/actual/diff images and traces appear in `test-results/visual/`; the HTML report is `playwright-report/visual/index.html`. A failed comparison must be reviewed before changing a baseline. Fix accidental layout drift in code.

For an intentional design change, build the app, run `pnpm visual --update-snapshots` (optionally `--grep A5`), inspect every changed PNG, then run `pnpm visual` without update flags. Commit the UI change and reviewed baselines together. CI rejects snapshot-update flags. Upgrading Playwright requires updating the image/digest and reviewing the resulting images.

These are regression baselines for the implemented release scope, reviewed against the handover's dated A1/A2/A3/A5/A11 snapshots. Passing them does not establish pixel identity with Figma. The Figma frames also show later-release features: A1's properties/table/callout widgets and Source/Read modes (v0.8), A11's starter kits (v0.5), and A5's rebinding UI (v1.0). The real app shows its implemented commands and actual file counts. Browser/OS chrome is outside the app capture. Extend the baselines as those features ship; retain Figma as the visual reference.

The original A2 baseline uses the live built-in catalog. Separate grouped-result references cover the implemented Templates/Snippets groups; gutter interactions have independent functional coverage. Results scroll above a separate footer. Keyboard traversal, viewport bounds and accessibility are verified independently of the pixel tolerance. For a reviewed refresh within that tolerance, use `pnpm visual --grep A2 --update-snapshots=all`, then compare without update flags.


The unreleased F-22 candidate adds eight manual table actions to the shared registry. Its reviewed A5 Light/Dark refresh shows 46 web commands and the extra entries in the existing scrolling Blocks & view column. A1/A2/A11 baselines are unchanged. All ten comparisons pass after the scoped local refresh; no tolerance or CI-update policy changed.


The unreleased F-41 gallery adds A3 Light/Dark baselines and one implemented web command to A5. Review and refresh only A3/A5 after the first comparison; preserve A1/A2/A11 references. A3 uses the real five Work templates in the initial twelve-item library, quoted YAML variables, a real date input and relative notebook paths. It does not add prototype-only templates or fabricated file counts.

Final local F-41 comparison passes all twelve scenes after reviewing A3/A5 Light/Dark. The first comparison passed all ten existing references, including the small A5 change within the existing pixel tolerance; A5 was explicitly refreshed for its new 47-command count and visible New from template row. The threshold and eight other references are unchanged.


The unreleased F-50 integration adds A4 snippet picker and A7 snippet settings Light/Dark baselines, plus two actual web commands in A5. The picker adapts the original A4 modal shell for its dedicated Mod-semicolon entry point; it does not claim the later unified palette. A7 shows the real built-in definitions and scopes. Review new A4/A7 images and refresh only the intentionally changed A5 command references; keep A1/A2/A3/A11 images intact. Native snippet integration remains pending.

The unreleased F-30 integration adds four A2 grouped-result references, Light and Dark for both Space templates and snippets. The fixture writes real private-library files and searches their shared name. The chosen result shows the original 16px family asset, source and rendered defaults; trigger text remains visible for snippets. Review all four new images before comparing the complete 20-story, 22-image set. Existing references and the 0.002 tolerance stay unchanged.

The unreleased F-62 integration adds A6 Light/Dark references. Its fixture writes the original dirty Markdown to the actual Space file, refreshes it and verifies both disk and Source editor text before capture. Opening review must not trigger table-input formatting. Source uses 14px Geist Mono with 26px lines with neutral syntax colors. The original wand/check/eye/close/chevron assets retain 16px slots; switches render their original 28×17px assets inside larger touch targets. Separate functional checks cover geometry, both switch variants, hover styles and panel/Diff accessibility in all four profiles. Cards/counts reflect real reports, including disabled manual structural warnings. The 20 existing stories and 22 reference images remain unchanged; A6 extends the suite to 22 stories and 24 images. Wait for the real Tidy count before captures, and copy the library-file fixture helper into the pinned visual runtime.

The F-62 shortcut-sheet repair refreshes only A5 Light/Dark. The Edit group now appears in the existing Blocks & view column, including the real Tidy document / Alt Shift F row. The registry already advertised 51 web commands; all 51 now render and remain searchable. Keep the registry-count assertion, command palette/focus/Undo/accessibility checks and the other 22 references unchanged.
