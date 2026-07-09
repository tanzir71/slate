# Slate Progress

## Current Status
- Current phase: Phase 1+ vertical slice complete
- Current task: Phase 2 native/web index operation integration.
- Gate: `pnpm verify` passes locally on 2026-07-10.

## Loop Notes
- 2026-07-09: Workspace contained only `SLATE_CODEX_HANDOFF.md`. Initialized Git in place because no existing repository or branch was available.
- 2026-07-09: Subagent tools are present, but this environment requires explicit user authorization before spawning them, so implementation is inline.
- 2026-07-09: Implemented a verified monorepo scaffold plus a thin product slice across core, storage, sync, editor, UI, web, desktop, mobile shell, Rust crypto, CI, and e2e.
- 2026-07-09: Visual QA used an Image Gen concept and Playwright screenshots because the in-app browser backend reported `iab` unavailable.
- 2026-07-10: Replaced the storage JSON cache with a real SQLite FTS5 index through Node 24 `node:sqlite`; added corruption auto-rebuild, FTS search, external-change reconciliation, and polling watch notifications.
- 2026-07-10: Added live CodeMirror invisible-Markdown decorations for inactive lines and covered them with a jsdom editor mount test.
- 2026-07-10: Added axe Playwright accessibility coverage for the primary workspace on desktop and mobile projects.
- 2026-07-10: Added a debounced autosave controller, browser draft writer, and SlateApp wiring so editor changes schedule writes and flush before sheet switches/new-sheet actions.
- 2026-07-10: Wired the desktop app to a Tauri autosave writer backed by a Rust conflict-safe disk write helper; browser/mobile keep the draft fallback until their storage adapters land.
- 2026-07-10: Added Tauri SQL plugin wiring, a default SQL capability, and a tested storage helper that opens the app-relative SQLite index and applies the shared FTS schema.
- 2026-07-10: Added wa-sqlite dependency wiring and a tested web OPFS helper that registers the OPFS VFS, opens the Slate index, and applies the shared FTS schema.

## Phase Board

### Phase 0 - Foundation and Guardrails
- [x] pnpm workspace scaffold
- [x] React/Vite web app
- [x] Tauri desktop shell
- [x] Rust crate with tests
- [x] ESLint, TypeScript, Vitest, Playwright, CI
- [x] `AGENTS.md`, `PROGRESS.md`, `DECISIONS.md`, `README.md`, `CHANGELOG.md`
- [x] `pnpm verify` exits 0

### Phase 1 - Domain Core
- [x] Pure TypeScript models
- [x] Markdown/frontmatter parser
- [x] Tag extraction
- [x] Wiki-link and backlink index
- [x] Smart filter evaluator
- [x] Word, character, reading-time, and goal calculations
- [x] Stable id handling and rename-safe link resolution
- [ ] Broaden property tests and coverage thresholds to the final quality bar

### Phase 2 - Storage and Index
- [x] Storage adapter interface
- [x] Local file-backed implementation
- [x] Rebuildable index model
- [x] Import existing folder as a Space
- [x] Conflict-safe write helpers
- [x] Replace JSON cache implementation with SQLite/FTS for the Node/local adapter
- [x] Add file watcher and external-change reconcile loop
- [x] Add Tauri plugin SQL adapter wiring for native desktop/mobile runtime
- [ ] Use the Tauri SQL helper for native index rebuild/search operations beyond schema bootstrap
- [x] Add OPFS/wa-sqlite adapter wiring for web runtime
- [ ] Use the web OPFS helper for browser index rebuild/search operations beyond schema bootstrap

### Phase 3 - Editor MVP
- [x] CodeMirror 6 host
- [x] CommonMark/GFM setup
- [x] Invisible Markdown marker range helper
- [x] Find/replace support extension
- [x] Autosave hooks wired to storage writer interface
- [x] Desktop autosave writes through Tauri to conflict-safe Markdown files
- [x] Counters HUD
- [x] Apply invisible Markdown decorations in the live editor view

### Phase 4 - Organization UI
- [x] Three-pane app shell
- [x] Space switcher
- [x] Nested notebook tree
- [x] Sheet list
- [x] Tag/search filtering
- [x] Per-space accent
- [ ] Drag/drop and disk-backed move operations

### Phase 5 - Power Features
- [x] Smart filter UI skeleton
- [ ] Wiki-link navigation
- [x] Inspector with backlinks and outline
- [x] Writing goals UI
- [x] Command palette
- [x] Global search UI skeleton

### Phase 6 - Design Polish and Accessibility
- [x] Light theme and design tokens
- [ ] Focus, typewriter, and full-screen modes
- [ ] Empty states
- [ ] Keyboard-only walkthrough
- [x] Axe/a11y coverage
- [x] Responsive desktop/mobile screenshots visually inspected

### Phase 7 - Cross-Platform and Sync
- [x] Web PWA build
- [x] Mobile shell placeholder
- [ ] BYO-folder reconcile model
- [x] CRDT/local merge tests
- [x] Slate Sync interface behind a flag

### Phase 8 - Export, Publish, and Release Hardening
- [ ] Export interfaces
- [ ] Publish adapter interfaces
- [x] E2EE crypto tests
- [ ] Performance budget hooks
- [ ] Release notes

## Blocked or Workaround Entries
- `pnpm install` needed `NODE_OPTIONS=--use-system-ca` locally because the npm registry certificate chain was not trusted by Node.
- Cargo needed revocation checking disabled on this Windows host; `.cargo/config.toml` sets `check-revoke = false`.
- Vite preview did not satisfy Playwright's readiness check in this shell, so e2e uses `scripts/serve-static.mjs` against the built web app.
