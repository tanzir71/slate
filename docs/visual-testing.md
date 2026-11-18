# Visual regression

After `pnpm build:site`, run `pnpm visual`. Docker must be running. The command uses the same Linux x64 Chromium reference on Windows, macOS and Linux; host `node_modules` is not mounted into Linux. CI requires this gate on its Linux runner, and Pages requires it before publishing.

The reference is Playwright 1.65.1 Noble, pinned by digest in `scripts/visual-test.mjs`. Tests use bundled fonts, a 1440 × 900 viewport at 1×, en-US/UTC, fixed time, reduced motion and a fixed storage-usage readout. A1/A2/A5 retain the real seven-sheet Sample Space into an OPFS browser library, pin Launch Plan and select its notebook. Service workers are blocked in these visual contexts; offline, updates, installability and each browser engine remain covered by the functional suite.

The ten committed PNGs in `e2e/visual/__screenshots__/` cover:

| View | Light and Dark coverage |
|---|---|
| A1 | Workspace, notebook selection, saved pin, live Markdown and status bar |
| A1 selection | Floating formatting toolbar and selected text |
| A2 | Actual slash query, built-in results, source preview and rendered 3×3 table |
| A5 | Read-only shortcut sheet, header search, current browser profile and command labels |
| A11 | Browser first-run cards, branding, theme and footer |

The maximum changed-pixel ratio is **0.002 (0.2%)**. Expected/actual/diff images and traces appear in `test-results/visual/`; the HTML report is `playwright-report/visual/index.html`. A failed comparison must be reviewed before changing a baseline. Fix accidental layout drift in code.

For an intentional design change, build the app, run `pnpm visual --update-snapshots` (optionally `--grep A5`), inspect every changed PNG, then run `pnpm visual` without update flags. Commit the UI change and reviewed baselines together. CI rejects snapshot-update flags. Upgrading Playwright requires updating the image/digest and reviewing the resulting images.

These are regression baselines for the implemented release scope, reviewed against the handover's dated A1/A2/A5/A11 snapshots. Passing them does not establish pixel identity with Figma. The Figma frames also show later-release features: A1's properties/table/callout widgets and Source/Read modes (v0.8), A11's starter kits (v0.5), and A5's rebinding UI (v1.0). The real app shows its implemented commands and actual file counts. Browser/OS chrome is outside the app capture. Extend the baselines as those features ship; retain Figma as the visual reference.

A2 uses the live built-in catalog; future Templates/Snippets groups and the gutter are outside this initial menu baseline. Results scroll above a separate footer. Keyboard traversal, viewport bounds and accessibility are verified independently of the pixel tolerance. For a reviewed refresh within that tolerance, use `pnpm visual --grep A2 --update-snapshots=all`, then compare without update flags.
