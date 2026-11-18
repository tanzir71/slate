# Slate Decisions

## 2026-11-18 - Pair Selected Text at the Editor Input Boundary

Plan selection wrappers from immutable editor state, inserting delimiters around the original ranges rather than replacing selected words. Preserve reversed and multiple selections; choose longer backtick fences when content already contains code delimiters. Only typed delimiters with a nonempty selection enter this rule. Paste, composition, readonly states and an empty caret retain normal handling. A tilde or equals inserts its complete double marker; consume its second physical character before the browser changes the DOM, preserving a single undo step. Keep that pending character through unrelated configuration updates and clear it when the document or selection changes.

For a non-cancellable mobile input, reconcile the DOM to identical source in a transaction excluded from history; this follows CodeMirror's approach to skipping a previously inserted closing bracket. A regression verifies both selected words and single-step undo through that fallback.

Expose one independently disabled preference using the existing versioned schema and live CodeMirror compartment. Older preference records default the new field without affecting saved notes. Ordinary non-delimiter typing returns before document inspection. A large-selection regression rejects spreading every code span into a function call; scan the maximum delimiter width instead. Wiki/tag completion and the date picker remain later F-21 work.

## 2026-11-18 - Keep Smart Lists Structural and Undoable

Use CodeMirror's existing Markdown continuation/deletion commands with explicit isolated history. Disable the language extension's automatic keymap so disabled rules cannot run through a second handler. Resolve list ancestry through the Markdown syntax tree; indentation and movement operate on whole sibling items and their descendant blocks. Renumber direct ordered siblings while preserving the original first counter. When a counter crosses a digit boundary, adjust child-line indentation in the same transaction, including counters changed by the upstream Enter command. Do not intercept Tab at the first sibling or Shift-Tab at a root list, preserving keyboard focus escape.

Versioned editor preferences live in optional local storage, shared across Spaces on the current app origin; the pure core validates their schema. Unsupported or unavailable preferences fall back to enabled list rules and never block a document. An Editor settings command and dialog expose only the three implemented groups. A CodeMirror compartment applies changes without recreating a document or its undo history. Cross-tab storage events refresh the preferences; preference writes remain outside React state updaters. Full Settings/automation configuration remains the later F-94 scope.

## 2026-11-18 - Bridge the Slash Menu Without Delaying Ordinary Input

Keep query detection and editor transactions in CodeMirror; React owns the nonmodal list, safe GFM preview and resource dialogs. Only an eligible slash opens the menu. Capture its anchor before the native slash changes the DOM and publish after that transaction; use CodeMirror's normal measurement phase to reconcile wrapping/scrolling. Commit an open menu during the callback's frame with flushSync so React does not add another scheduled frame. Ordinary characters never read anchor geometry or publish menu state. Cancelled requests preserve the literal query; async insertions require the same source and an editable, connected editor. Optional local usage history is validated and affects ranking only. The exact `ta` alias keeps four-keystroke Table insertion stable under that history. Image bytes use the existing serialized, conflict-preserving import adapter; raw HTML and all preview links remain inert, including heading links that would otherwise change the app route.

Menu timing gets its own Playwright process and report directory under the existing Linux reference policy, retaining all four profiles, the strict <50 ms assertion and diagnostic results on other hosts. Its fixture starts with a real empty saved sheet and measures the actual slash input through the first visible frame, then verifies saved bytes. Template/Snippet groups, the gutter/grip, broader smart input and automatic TOC refresh remain later work; this menu does not advertise future libraries.

## 2026-11-18 - Plan Block Transactions in the Pure Core

Context: v0.4's slash menu, gutter insertion and later CLI/automation consumers need the same Markdown outputs. Resource picking and platform IO cannot enter packages/core.

Decision: Keep the built-in catalog and insertion planner pure. Return original-document TextChange coordinates plus a final UTF-16 selection, or a typed resource request before any edit. Footnote references/definitions share one planned transaction; front-matter is guarded at the document start; dates/times are explicit inputs. The editor adapter will commit a plan as one undo step after resolving any resource request.

Consequence: Golden fixtures cover all 28 entries, including five callout variants and the A2 Tag item. The plan's 3×3 table is interpreted as three columns and three rows including the header (two body rows). Existing source text and newline bytes stay outside the replaced query; inserted line endings follow the document. Menu UI, resource adapters and automatic TOC refresh remain separate v0.4 work, so this foundation does not advertise those features as shipped.

## 2026-11-18 - Bound Derived Summary Refreshes

Context: The full-document summary worker remains active on every edit even with one in-flight job. A two-CPU WebKit diagnostic sent 226 jobs during 225 inputs and recorded 1,567 ms of aggregate worker round-trip time. Summaries feed the list, statistics, tags and inspector; they are rebuildable projections of the immutable source buffers.

Decision: Coalesce pending snapshots into refresh windows at least 100 ms apart, then post after a frame. The first snapshot has no throttle delay. Continuous editing still publishes intermediate summaries; this is a bounded refresh cadence rather than a wait for typing to stop. Keep one pending latest snapshot and cancel all timers/frames before closing the worker client.

Consequence: Derived metadata can trail input by roughly 100 ms plus frame/worker time. List actions require the summary path set to match current source file identities; while paths differ, rows, selection and dragging are disabled and the list reports busy. Content-only edits do not block list actions. Editor transactions, live preview, synchronous recovery and file saves retain their existing paths. Unit clocks cover coalescing, continuous updates, final text and cancellation; browser checks cover real worker requests, a held-worker bulk move and exact saved words. The <16 ms typing gate and its workload remain unchanged.

## 2026-07-09 - Initialize In Place

Context: The handoff expected a repository, but the workspace contained only `SLATE_CODEX_HANDOFF.md` and no `.git` directory.

Decision: Initialize Git in the current workspace and continue in place. Worktree isolation is deferred until a normal branch exists.

Consequence: The first commit can happen after Phase 0 scaffolding. No user changes existed to isolate from.

## 2026-07-09 - Keep `packages/core` Platform-Free

Context: Most of the spec's risk is in domain correctness: tags, links, filters, goals, round-trips, storage reconciliation, and sync safety.

Decision: Put all domain parsing and query behavior in `packages/core` with no DOM, Tauri, Node, or Rust dependency.

Consequence: The highest-value logic can be tested quickly in Vitest and reused by web, desktop, mobile, storage, and sync layers.

## 2026-07-09 - Use a JSON Rebuild Cache During Scaffold

Context: The storage phase requires SQLite/FTS as a rebuildable cache, but bringing in a native SQLite dependency during the first scaffold would add platform build risk before the adapter contract existed.

Decision: Implement the storage adapter against files on disk and write a deterministic JSON cache to `.slate/index.sqlite` as a temporary stand-in.

Consequence: The no-data-loss and rebuild semantics were tested early. This decision was superseded on 2026-07-10 by the Node SQLite FTS adapter below.

## 2026-07-10 - Use Node SQLite for the Local Adapter

Context: Node 24 in this workspace exposes `node:sqlite` with FTS5 support, allowing a real SQLite index without adding a native npm dependency or build scripts.

Decision: Replace the JSON stand-in with a SQLite database at `.slate/index.sqlite`, backed by a `sheets` metadata table and `sheets_fts` FTS5 table.

Consequence: Local storage now proves the core SQLite/FTS semantics: rebuild from Markdown files, search by title/body/tags, corrupted index auto-rebuild, and external-change reconcile. Tauri SQL and web OPFS adapters remain separate runtime wiring work.

## 2026-07-09 - Cargo Revocation Workaround

Context: Cargo failed to fetch crates on this Windows host because Schannel could not complete certificate revocation checks.

Decision: Add `.cargo/config.toml` with `check-revoke = false`.

Consequence: Local verification can fetch and build dependencies. TLS remains enabled, but Windows revocation checking is disabled for this repository's Cargo operations.

## 2026-07-09 - Static E2E Server

Context: Vite preview stayed alive but did not satisfy Playwright's readiness check in this shell.

Decision: Add `scripts/serve-static.mjs` and use it as Playwright's web server against `apps/web/dist`.

Consequence: Production Vite build remains verified separately, and e2e runs against the exact built assets.

## 2026-07-10 - Inject Autosave Writer Into UI

Context: The handoff requires autosave to persist editor changes, but importing the Node/Tauri storage adapter directly into the shared React app would break the web bundle.

Decision: Add a debounced `createAutosaveController` in `packages/ui` that accepts a `SheetAutosaveWriter` interface. `SlateApp` uses a browser draft writer by default and can receive a real storage-backed writer from native shells.

Consequence: The UI now schedules and flushes autosaves without coupling React to Node-only storage. Native desktop/mobile still need runtime wiring to pass the real adapter.

## 2026-07-10 - Use a Tauri Command for Desktop Autosave

Context: The shared UI autosave controller needed a real native writer, but the full Tauri SQL index adapter is still separate runtime work.

Decision: Add a desktop-only `write_sheet` Tauri command that writes Markdown under the app-data default Space through a tested Rust helper in `slate-core`. The helper performs root-safe path validation and conflict-copy preservation.

Consequence: Desktop autosave now writes conflict-safe `.md` files without pulling native APIs into the web/mobile bundles. The SQLite index adapter still needs native Tauri SQL wiring.

## 2026-07-10 - Bootstrap Native SQLite Through Tauri SQL

Context: The handoff calls for native SQLite via `tauri-plugin-sql`, while the existing Node adapter already owns the canonical index schema and FTS layout.

Decision: Install and initialize the official Tauri SQL plugin with SQLite enabled, grant `sql:default` to the main window, and add an `@slate/storage/tauri-sql` helper that opens `sqlite:slate-index.sqlite` and applies the shared schema.

Consequence: Native shells now have a verified SQLite entrypoint that matches the Node schema. Rebuild/search operations still need to be routed through this helper in a later slice.

## 2026-07-10 - Bootstrap Web SQLite Through wa-sqlite OPFS

Context: The handoff calls for a web runtime adapter using OPFS and wa-sqlite, but OPFS VFS access is worker-oriented and should not leak into UI components.

Decision: Add `@slate/storage/web-opfs` as a browser-only helper that loads the async wa-sqlite build, registers `OriginPrivateFileSystemVFS`, opens `slate/index.sqlite`, and applies the shared index schema. The helper is injectable for tests and has a close lifecycle.

Consequence: The web runtime now has a verified OPFS SQLite bootstrap path without importing Node storage code. Browser rebuild/search operations still need to consume this helper in a later slice.

## 2026-07-10 - Share Async SQLite Index Operations

Context: Native Tauri SQL and web wa-sqlite expose different JavaScript database APIs, but both need the same Slate index semantics.

Decision: Add a small generic async SQL executor contract and shared index operations for reading entries, FTS search, and transactional replace-all writes. The Tauri and web helpers adapt their native APIs to that contract.

Consequence: Native/web index behavior now shares one tested query layer. Runtime file scanning and Markdown parsing still need adapter-specific wiring before they reach full rebuild-from-disk parity.

## 2026-07-10 - Bridge Runtime File Sources to SQLite Indexes

Context: Native and web runtimes will discover Markdown files through different APIs, but parsing files into Slate index rows should remain identical.

Decision: Add `@slate/storage/runtime`, which accepts an abstract Markdown file source and a runtime SQLite index, parses Markdown through `@slate/core`, and rebuilds the SQL index with deterministic ordering.

Consequence: Concrete Tauri/web file source adapters can now plug into one shared rebuild path. The remaining work is implementing those file-source adapters against real native/web filesystem APIs.

## 2026-07-10 - Use Directory Handles for Web File Sources

Context: The web runtime needs a concrete way to feed user-selected Markdown folders into the shared SQLite rebuild path without Node or Tauri APIs.

Decision: Add `@slate/storage/web-file-source`, a small adapter over browser directory/file handles that recursively lists `.md` files, ignores `.slate`, and normalizes workspace-relative reads.

Consequence: The web path can now rebuild from a selected directory handle through the shared runtime adapter. Browser permission prompts and handle persistence remain app-integration work.

## 2026-07-10 - Use Tauri Commands for Native File Sources

Context: Native rebuilds need a concrete Markdown file scanner, but shared storage code should not import Tauri APIs directly unless the native shell opts in.

Decision: Add root-safe Rust helpers for listing and reading Markdown files under the default Space, expose them as `list_markdown_files` and `read_markdown_file` Tauri commands, and publish an injectable `@slate/storage/tauri-file-source` wrapper over `invoke`.

Consequence: Desktop rebuilds can now use the same `RuntimeMarkdownFileSource` contract as web directory handles. The app still needs a UI integration point to trigger full native rebuilds from this source.

## 2026-07-10 - Enforce Core Coverage in the Unit Gate

Context: The handoff requires `packages/core` at or above 90% line coverage, but the existing verify gate ran Vitest without coverage thresholds.

Decision: Run Vitest with V8 coverage in `pnpm test`, scope the enforced include set to `packages/core/src/**/*.ts`, and set global thresholds at 90% lines/statements/functions with a 75% branch floor.

Consequence: The Phase 1 core quality bar is now machine-enforced without forcing the scaffolded UI/storage packages to meet the final overall 75% threshold before their remaining behavior lands.

## 2026-07-10 - Inject Sheet Moves Behind a UI Adapter

Context: The three-pane UI needed drag/drop sheet moves, but the shared React package still runs in web, desktop, and mobile shells with different filesystem capabilities.

Decision: Add a `SheetMoveWriter` prop to `SlateApp`, have notebook drop targets call it with source/destination Markdown paths, and update the visible sheet notebook only after the move writer succeeds. The Node local storage adapter now rebuilds SQLite after `moveSheet` and refuses to overwrite an existing destination.

Consequence: The UI can prove the drag/drop workflow without importing Node or Tauri storage code, while disk-backed adapters preserve index freshness and avoid move-time data loss. Native/web shells still need to inject their concrete move writers.

## 2026-07-10 - Navigate Wiki Links From CodeMirror Clicks

Context: Wiki-link navigation needs to work inside the plain Markdown editor without converting the document into a block or rich-text model.

Decision: Add an editor hit-test helper for `[[target|display]]` ranges and handle Ctrl/Cmd-clicks through a CodeMirror DOM event extension. `SlateApp` resolves links by stable id first and by normalized title second, then selects the matching sheet.

Consequence: Wiki links are navigable while the Markdown source stays untouched. The first implementation is click-based; autocomplete and unresolved-link creation remain later Phase 5 polish.

## 2026-07-10 - Keep Editor Modes as Local UI State

Context: Focus, typewriter, and full-screen modes are writing-surface preferences, but the scaffold does not yet have persisted per-space settings.

Decision: Implement the modes as local `SlateApp` state toggled from icon toolbar buttons. CSS classes control the layout: focus mode hides navigation and dims inactive editor lines, typewriter mode changes editor vertical rhythm, and full-screen mode hides top chrome.

Consequence: The writing modes are usable and testable without inventing a settings store prematurely. Persisting these preferences can be layered onto per-space settings later.

## 2026-07-10 - Keep BYO-Folder Reconcile Decisions Pure

Context: BYO-folder sync must work across desktop, web directory handles, and mobile/native filesystem adapters without clobbering Dropbox/iCloud/Git edits.

Decision: Add `reconcileByoFolderFile` in `packages/sync` as a pure decision model over base, local, and external file contents. Runtime adapters can map its actions to disk writes, deletes, clean merged writes, or conflict-copy writes.

Consequence: The no-data-loss policy is testable without filesystem coupling, and platform adapters can share identical conflict semantics while still owning their IO details.

## 2026-07-10 - Put Export Behind Format Adapters

Context: PDF, DOCX, HTML, and ePub export will need different rendering libraries and platform packaging behavior, but the UI should call one stable export surface.

Decision: Add `@slate/export` with an `ExportAdapter` contract and registry. The first concrete adapter renders sanitized, themeable HTML; PDF/DOCX/ePub can attach to the same registry later.

Consequence: Export behavior is testable before heavier renderer dependencies arrive, and unsupported formats fail clearly instead of pretending to be implemented.

## 2026-07-10 - Put Publish Behind Provider Adapters

Context: WordPress, Ghost, static-site, and future publish targets need different credentials and HTTP APIs, but Slate should expose one publish action.

Decision: Add `@slate/publish` with a `PublishAdapter` contract and registry. The first concrete adapter is a deterministic static target that proves the contract without external network calls.

Consequence: Provider-specific integrations can be added behind a stable interface, and unsupported providers fail explicitly until real adapters are wired.

## 2026-07-10 - Keep Perf Budgets Deterministic in Verify

Context: The handoff requires cold/open/search/typing performance gates, but device-level cold start and full UI latency are noisy in a local agent loop.

Decision: Add `pnpm perf` as a deterministic Node script after the build step. It measures pure large-sheet parsing, typing HUD stat calculation, and SQLite FTS search over 10k synthetic rows.

Consequence: The verify gate now has a real performance tripwire without adding flaky browser timing assertions. Deeper device/browser telemetry can layer on top later.

## 2026-11-17 - Browser Spaces are files, with recoverable writes

Context: The redesign handover starts with a useful static web app. The baseline web shell edited only seeded data and could not reopen it.

Decision: Use a Zustand workspace store fed by shared `BrowserFiles` and `BrowserSpace` adapters. Folder Spaces use a selected directory handle retained in IndexedDB; library Spaces use `/spaces/<id>/` in OPFS. Sample sheets stay in memory until Keep. Serialize mutations, compare the last disk content before saves, create conflict copies on divergent edits, refuse move overwrites, and copy deletions to `.slate/trash/` before removing their source. A synchronous localStorage recovery journal holds only pending edits; successful writes clear it, and recovered divergent edits also become conflict copies. Web Locks and BroadcastChannel provide one write owner and a flush-before-takeover flow.

Consequence: Markdown files remain authoritative; a journal recovers interrupted writes without becoming the normal database. Archives include configuration, trash and binary assets byte-for-byte. Storage permission/quota failures keep drafts and surface a retry action.

## 2026-11-17 - FTS-enabled SQLite in a cooperative OPFS worker

Context: GitHub Pages cannot provide COOP/COEP headers. Real browser testing found that the baseline `wa-sqlite@1.0.0` WASM lacks FTS5 (`no such module: fts5`), which the shared schema requires.

Decision: Pin the PowerSync-maintained `@journeyapps/wa-sqlite@2.0.10` build, which includes FTS5, and use its `OPFSCoopSyncVFS` in a dedicated worker. Bundle the WASM URL locally, keep `/indexes/<space-id>.sqlite` separate from user files, and rebuild from Markdown. Adapt bound queries using prepared statements. The VFS uses access handles and Web Locks without SharedArrayBuffer. Source: [wa-sqlite VFS documentation](https://github.com/powersync-ja/wa-sqlite/blob/master/src/examples/README.md); upstream [FTS build discussion](https://github.com/rhashimoto/wa-sqlite/discussions/79).

Consequence: Chromium, Firefox and Linux WebKit tests exercise a real FTS index without cross-origin isolation. A cache failure leaves files editable and allows direct file search. Playwright 1.65.1 and isolated persistent WebKit profiles fix the old runtime's missing Storage API; Windows WebKit still has transient OPFS/cache errors. The complete WebKit storage gate passes on Linux and runs on Linux/macOS, with a documented Windows workaround in `PROGRESS.md`.

## 2026-11-17 - Relative app assets, hash routes and prompt updates

Decision: Assemble the static site at `/app/`, keep `/demo/` as a redirect to `../app/?sample=1`, and keep sheet deep links in the hash. Bundle the provided logo/icon assets, precache the shell/editor/WASM using Workbox, and activate updates only after an explicit Reload action flushes pending writes. CSP is a meta policy with same-origin connections only. Tag-triggered Pages builds run browser gates before deployment and a save/reopen smoke check afterward.

Visual reference: The live Figma tool returned `Unknown tool` in this session. The dated handover snapshots are the available implementation reference; live-Figma parity remains unverified. No handover plan was changed to match implementation.

## 2026-11-17 - Prioritize the landing page and GitHub publication

The user explicitly requested that the landing page become first priority and be pushed to GitHub ready for every release. This overrides the plan's original v0.6 timing for F-120. Implement L1/L2's paper/graphite layout and bundled typography now, retain the rule that marketing only shows implemented capabilities, and publish the landing and app in the same GitHub Pages artifact on each release. The rest of the handover remains active and keeps its dependency order.

## 2026-11-17 - Keep marketing assets small without remote dependencies

The production site inlines minified landing CSS, critical font bytes, shared SVG icons and the header lockup, and serves a responsive AVIF crop of the real app on mobile. Inlining removes connection overhead under the default mobile network simulation; redundant production font preloads are removed. The footer lockup loads lazily. The committed marketing fonts retain only Latin/punctuation and the weights used by the design; `scripts/subset-landing-fonts.py` reproduces them from the full editor fonts, which remain unchanged for user documents. Original SVGs and font files/licenses remain bundled. Every site build regenerates screenshots and checks both marketing and app budgets. Lighthouse audits the production artifact with default mobile throttling before publication; the 1.5-second budget remains unchanged.

## 2026-11-17 - Read current and waiting release notes separately

Current release notes use the precached `whats-new.json` with normal fetch cache mode so they remain available offline, including in Firefox (a reproduced `no-store` request fails offline there). A waiting update uses a query and `no-store` to read the incoming version without being served the active worker's older JSON. Opening notes is read-only; Reload remains an explicit action after the workspace flush. The About surface uses a native dialog for focus containment and restores focus to its invoker when closed.

The header/palette About action always reviews the running release. Only the waiting-update toast's What's new action reviews the incoming release. A Windows Firefox trace exposed the incorrect coupling: a waiting update switched ordinary About to a `no-store` request and broke it offline. The two dialog modes now remain independent; no additional cache mechanism is needed.

## 2026-11-17 - Preserve unsupported Markdown encodings

Browser Markdown editing accepts UTF-8. Replacement decoding could silently change legacy file bytes on save, so decoding is strict. Unsupported files stay visible but read-only; raw downloads and zip exports preserve them. A recovered pending draft is written into a separate UTF-8 conflict copy, preserving both the original bytes and the user's words.

## 2026-11-17 - Refresh recovery at write ownership, before enabling input

A read-only tab's recovery snapshot can become stale while another tab writes. Reproduced a lost-draft case after the writer disappears: the reader's old snapshot replaced the newer journal entry. On ownership gain, read the current journal synchronously, replace the stale snapshot and overlay the editor buffer before changing editability. An empty journal discards stale reader drafts after the previous writer saved. No journal or Markdown format changes are needed. Unit cases cover both paths; a browser fault-injection test revokes writes in the first tab, closes it and verifies the second tab persists the latest draft.

Read-only flush requests leave the writer's journal and files untouched. This also allows a read-only tab to switch Spaces or reload an update without attempting to save another tab's recovery snapshot.

## 2026-11-17 - Prioritize the editor and isolate CI browser cases

Start the rebuildable SQLite cache after the editor's first frame, rather than opening/writing an empty index during first-run file operations. Files and recovery writes keep priority; the worker still builds a real OPFS FTS cache and receives subsequent saved changes. An empty Space does not need a worker.

Once a user opens a Space, begin loading the workspace and editor modules alongside file/catalog reads. These remain lazy at initial onboarding, but returning writers no longer wait for three sequential module/file phases. First-create test helpers allow 15 seconds for cold storage setup; a separate <60-second first-saved-writing assertion and the unchanged <1-second offline paint budget measure the product requirements directly.

The browser gate uses one Playwright worker, following [Playwright's CI recommendation](https://playwright.dev/docs/ci#workers), after Windows traces showed cold profiles stalling while three unrelated contexts initialized storage/cache concurrently. Its <1 s offline paint budget is measured with dedicated browser resources; `--workers=3` remains available for parallel stress checks. All browser projects, assertions, budgets and the concurrent two-tab ownership test remain enabled. Lighthouse uses software headless rendering with the same default mobile simulation and retains raw traces.

## 2026-11-17 - Use a consistent Linux landing performance reference

CI run 44104295348 reproduces macOS-specific native parser/layout costs: 124.7 ms in one layout of 216 objects and 67.1 ms consuming the document response. Its observed LCP is 426 ms, but the host-relative mobile simulation reports 1549 ms and 539 ms blocking time, despite approximately 400 bytes of landing JavaScript. Software rendering improves the prior macOS result without making this shared runner a stable performance reference. This is a host limitation, not evidence of equivalent Safari timing.

Enforce the unchanged Lighthouse thresholds on the Linux CI reference and Linux Pages publication, following [Lighthouse's consistent-environment guidance](https://github.com/GoogleChrome/lighthouse/blob/main/docs/variability.md). Keep macOS Lighthouse as an explicit diagnostic and upload its failed report/trace. All native builds, unit checks, core budgets and browser engines still gate their respective platforms. The root `pnpm verify` remains unchanged; the documented macOS CI workaround separates the platform checks from the canonical landing performance measurement.

## 2026-11-17 - Share appearance tokens across browser and desktop

`@slate/tokens` exports the handover's named Light/Dark colors and theme resolution without DOM dependencies. The UI applies these variables before React paints, remembers Light/Dark/System as an optional local preference and follows system changes only in System mode. Appearance changes never write Markdown. A contrast check covers the text/surface pairs from §6.3; selected-row metadata uses the secondary text token because tertiary text on the accent-soft background fails AA.

Both shells bundle Geist, Geist Mono and Newsreader from the existing workspace font dependencies. Newsreader's true italic face is available for a user's own Markdown emphasis; UI typography stays upright. Removed duplicated normal fonts from the web public directory and made the marketing subset script read those same canonical dependency files. The supplied brand silhouette is reused as a currentColor React component so it remains legible in both themes. Live Figma access is still unavailable; the dated foundations/A1/A9/A11 snapshots remain the visual reference.

## 2026-11-17 - Resolve commands once for keyboard, palette and help

The browser regression reproduced CodeMirror's Android Enter deferral dropping modifiers before custom handlers, turning Mod Enter into a newline. A capture listener handles only registered, modified Enter formatting commands on Android; composing input, AltGr and plain Enter stay with CodeMirror. Real mobile Chromium and a focused adapter test cover this path.

The pure core registry declares implemented commands, contexts and OS/browser defaults. The editor handles formatting before workspace shortcuts; Mod K inserts a link only with an editor selection and otherwise opens the palette. Exact modifiers, physical key codes, composition checks and AltGr protection keep command handling separate from text input. Browser New sheet uses Alt N, preserving the browser's reserved Mod N.

Each Space may supply `.slate/keymap.json` with `{ "version": 1, "bindings": { "format.bold": "Mod+Shift+b", "sheet.new": null } }`. Null unbinds a command. A custom map is validated as a whole, allowing swaps; invalid JSON, unknown commands, conflicts or Ctrl+Alt+letter on Windows/Linux retain all defaults and surface the reason. The map loads on Space open and window focus. Palette, shortcut sheet, editor and tooltips use the resolved map, and reconfiguration preserves the document and undo history. The read-only shortcut sheet uses a native dialog for focus containment and restores the invoker on close. Formatting operations are isolated transactions so each action has one undo step.

## 2026-11-17 - Measure the selection toolbar without touching the document

The selection observer reads visible CodeMirror coordinates in its measurement phase and emits only changed geometry. Empty or read-only selections perform no layout reads. The toolbar uses the registered formatting actions and resolved shortcut labels, preserves editor selection on pointer activation, supports keyboard focus/arrow navigation and returns focus to the editor after applying an action. Placement clamps to the visual viewport, prefers above the selected lines, falls below when needed and hides if neither side fits. Resize/scroll measurements keep it clear of the selection on mobile as well. Escape dismisses it without altering words; formatting remains one isolated undo transaction.

## 2026-11-17 - Render Markdown from the editor's incremental syntax tree

F-10a uses Lezer's Markdown/GFM tree plus small highlight/wiki/tag extensions. Only visible ranges receive decorations; code, escaped syntax, images and frontmatter stay source text. Caret/selected lines reveal their source markers. Rendering and settings changes never dispatch document edits; task widgets dispatch one checked-state character as an isolated undo action. Reference URLs and wiki aliases retain their source targets. External links open only on a modified primary click and only for HTTP(S)/mailto; document HTML is never interpreted.

Missing wiki targets are created through the existing serialized, conflict-safe file adapter. Link navigation/creation is serialized too, preserving source bytes, resolving existing titles or stable IDs first and using portable filenames. A lazily loaded helper imports only the needed parser export, keeping the initial shell small. Rich widgets and view-mode UI remain in their planned later milestone.

macOS CI's shortcut labels use the same Option glyph as the running app. Safari's toolbar traversal test uses Option-Tab with the default macOS navigation setting, following [Apple's keyboard reference](https://support.apple.com/guide/safari/keyboard-shortcuts-and-gestures-cpsh003/mac); no keyboard checks are skipped. The shortcuts invoker receives explicit focus before its dialog opens so Safari restores focus consistently too.


## 2026-11-18 - File-backed workspace preferences and bounded sheet rendering (F-90–93)

Context: The redesigned sidebar and list need pinned files, collapsed notebooks and density settings that travel with a Space. Large lists must keep keyboard navigation usable without mounting every row.

Decision: Store versioned preferences in `.slate/view.json`, preserve unknown fields, serialize updates and use the same optimistic conflict-copy save path as notes. Invalid configuration leaves notes available and the original configuration untouched. Move operations update pinned paths after the file has moved safely. Render fixed-height rows with viewport overscan above 80 entries; Arrow Up/Down, Home and End reach unmounted rows. Bulk move/trash runs through existing safe file operations sequentially and retains unfinished selections after a failure.

Consequence: SQLite remains a rebuildable cache. Preference files are included in exports, and a damaged preference file cannot overwrite notes. Cursor positions use a separate external store so caret movement only updates the status bar. The shared titlebar explicitly disables native window controls in the browser. Future view modes, history and Tidy controls arrive with their working features in later milestones.


## 2026-11-18 - Keep large-document typing independent of summaries and recovery snapshot size

Context: Valid 50k-word typing missed the 16 ms p95 gate. Profiling identified whole-document statistics, preview scans, controlled-value echoes and repeated recovery serialization on the input thread.

Decision: Compute immutable sheet summaries and row previews in a worker. Transfer metadata and body offsets, retain source strings on the main thread, ignore stale generations and reuse unchanged summaries. Fall back to scheduled local computation if worker startup fails. Pass CodeMirror transaction changes to browser recovery: write an immutable base snapshot before an atomic journal entry containing small change batches. Compact after 128 batches, retain legacy full-snapshot reading/writing, and use a full snapshot if an incremental base cannot be allocated. Keep the new versioned journal in `slate.recovery-v2.*` so older open apps cannot clear it. Migrate the old key only after committing the new journal; preserve divergent older-app drafts as separate recovered files. Retry reads if a writer compacts between reading a journal and its base, and refuse unsupported formats without clearing them. Delete old bases only after committing the replacement journal. Source-file writes, conflict detection and synchronous per-edit recovery remain in place.

Consequence: A failed journal commit leaves the previous committed draft recoverable; a crash between a base write and journal commit can leave an unreferenced private snapshot, which is safer than removing referenced recovery data. Exact source preservation, old journals, CRLF input, concurrent changes, quota fallback, compaction failure and worker failure/stale replies have regression coverage. The typing gate uses at least 225 real inputs and verifies the actual saved file, with the original <16 ms limit unchanged.

Typing checks run in a separate Playwright process and report folder; CI and Pages publication still enforce the same <16 ms limit for their supported engines. Diagnostic timing data includes clock granularity, frame timestamps, visibility/focus and handler durations. The budget remains unresolved when a run reports exactly 16 ms or more; passing functional checks is not evidence that this timing requirement has passed.

## 2026-11-18 - Share command definitions with the desktop preview

The native preview now uses the same registry, OS-aware key matcher, formatting adapter and modal shortcut/palette component as the browser. A surface constraint keeps existing native focus/typewriter/full-screen and Space-switch commands out of the browser until their browser features ship. The preview exposes only commands it implements; the former no-op export/menu entries are removed. Native window chrome remains provided by the OS until the v0.9 desktop titlebar work.

The desktop palette and inspector start closed. Inspector uses Mod+Shift+I, leaving Mod+I for Italic, and becomes an overlay when the window is too narrow for four columns. A sheet's editor instance and undo history are keyed to that sheet. Desktop frontend E2E uses the actual compiled app with an explicit IPC fixture; it validates frontend dispatch and save arguments, while Rust tests cover conflict-safe disk writes. OS package validation and native folder/watch/move/trash wiring remain separate work.

## 2026-11-18 - Keep the shortcut migration notice optional and consistent

Retain the existing `slate.shortcuts.v2` seen marker rather than showing another browser migration message. Build default-shortcut labels from the shared registry and OS profile, including Command/Shift on macOS. The native preview uses the same notice once per origin, with a keyboard-accessible dismiss button. Failed preference reads or writes skip this optional notice; they cannot fail a workspace open or change file recovery. The wording explicitly describes defaults because a Space can customize its bindings.

## 2026-11-18 - Keep pixel comparisons on one reproducible browser reference

Visual regression uses a Linux x64 Playwright 1.65.1 Noble image pinned by digest, including when invoked from Windows. An ephemeral Linux project installs the exact test runner, reads the real built site and mounts only expected PNGs and test reports writable. Host dependencies are not reused across operating systems. Time, locale, fonts, storage estimate and fixtures are controlled; file persistence and app rendering remain real. CI and Pages compare eight Light/Dark snapshots at the original 0.2% limit, and CI cannot update expected images.

The baseline review compares the implemented A1/A5/A11 structure to the supplied Figma snapshots; it does not claim raster equality with future-feature mockups. The shortcut sheet now places search in its header and uses A5's 720 px desktop frame, with a stacked header and scrollable body on small screens. Properties/rich widgets, starter kits and rebinding retain their planned later releases. Pixel regression is separate from the engine-wide functional, accessibility and typing gates.

Live Figma access was restored on 18 November. High-fidelity A1/A5/A11 contexts confirm the main layout metrics. The A5 modal (13:1882) now uses its exact heading/keycap sizes, 40 px column gap, spacing and token surfaces; icons reuse the plan's mapped 16 px/1.75 Lucide library. An explicit coarse-pointer header selector fixes the desktop selector overriding 44 px modal close targets. Both mobile close buttons have browser geometry assertions; the two intentional A5 baseline changes were reviewed and the full eight-image comparison passes.

## 2026-11-18 - Attach explicitly unsigned desktop previews from v0.3

Build a separate Tauri preview flavor with identifier `com.slate.workspace.preview`, per-user Windows installation, no updater artifacts and signing disabled. Keep ordinary verification builds unpackaged. Release packages are NSIS x64, AppImage x64 built on Ubuntu 22.04 (the glibc compatibility floor), and a permissions-preserving macOS ZIP whose binary must contain both Intel and Apple Silicon architectures. Each asset carries an exact version, source commit, byte count and SHA-256. A reusable workflow builds all three from one resolved commit; Pages waits for them from v0.3, and publication verifies every asset before uploading to a draft release and making it public.

The landing replaces its secondary source link with an explicitly labelled Desktop preview link to that exact release from v0.3. The browser remains primary. Preview documentation states the current seeded native shell/reopen limits; native file-workspace completion and signed distribution retain the v0.9 milestone. A separate application identifier keeps preview app data apart from stable installations. Failed packaging or checksum validation cannot silently publish a partial desktop release.

## 2026-11-18 - Declare the Linux runner as the typing-performance reference

The handover requires p95 < 16 ms on 50k words using Playwright and marks, but does not specify benchmark hardware. Use the Linux CI runner as the declared reference for all four browser profiles, with the same strict threshold, real input, byte checks and recovery enabled. Pages continues its strict Linux publication check. This is a fixed platform choice, not conditional exclusion based on a run's results. Windows/macOS retain required native builds and all supported functional checks, run the same timing assertions as diagnostics, and upload failed timing evidence. Root `pnpm verify` remains strict.

Evidence: Linux CI 44178565874 and 44190380062 passed every typing profile. In 44181834323 macOS Chromium's 50k p95 was 88.5 ms against 110.1 ms for a short note, WebKit 40/47 ms and mobile 100.4/112.7 ms. This demonstrates host-dependent latency even in the control; it does not identify its exact cause or establish macOS budget compliance. No engine or input workload is removed from the required Linux measurement, and the reference still fails at 16 ms. Reports retain non-reference failures for investigation rather than claiming the app is equally fast on every host.

## 2026-11-18 - Keep optional view persistence from forcing layout during input

Persist the caret immediately with the last observed scroll offset when CodeMirror reports a document or selection change. Reading `scrollDOM.scrollTop` after its DOM update can force synchronous layout inside input handling. Refresh the offset on scroll, and read the actual value on pagehide/teardown so a pending scroll event cannot lose the latest position. Source-file autosave and synchronous per-edit recovery are unchanged. A regression proves no scroll-layout read occurs between the edit callback and optional preference write, while checking changed scroll offsets and the saved caret; the existing pagehide regression checks a scroll whose event has not fired yet.

## 2026-11-18 - Reuse Rust dependencies and supersede old branch verification

Cache third-party Cargo dependencies for both standalone workspaces after selecting the Rust toolchain. Keep the action's default exclusion of workspace crates so Slate source and embedded frontend assets rebuild; every test/build/gate command still runs. Save dependency caches even when a later JavaScript or timing check fails, rather than recompiling unchanged dependencies on every attempt. Keys retain the Rust host/toolchain, environment and manifest/lockfile inputs.

Group CI by workflow and Git ref, allowing a newer branch/PR run to cancel its superseded run. Tag verification does not cancel an existing run. Release publication keeps its own required checks and is unaffected by these caches or branch concurrency.

## 2026-11-18 - Bound derived-summary worker requests to current work

Allow one in-flight summary request and keep only the latest pending immutable snapshot. When a reply arrives, publish it only if it matches the latest requested generation; otherwise send the latest snapshot and skip intermediate work. Ignore duplicate replies, preserve cached-document reuse, and fall back to the newest source if the worker errors or posting fails. Closing cancels pending work and late publication. This removes a worker backlog and unnecessary full-document transfers; it does not defer source-file saves or synchronous recovery, and does not change the typing gate or claim a measured latency improvement before verification.
