# Slate Decisions

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
