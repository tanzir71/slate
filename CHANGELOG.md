# Changelog

All notable changes to Slate will be documented in this file.

The format is based on Keep a Changelog, and this project uses Conventional Commits.

## [Unreleased]

### Added
- Initial handoff-driven pnpm monorepo with web, desktop, mobile, UI, editor, core, storage, sync, tokens, and Rust crates.
- Pure core Markdown parsing, tags, wiki-links, backlinks, smart filters, stats, and goal progress.
- Local storage adapter with rebuildable index cache and conflict-copy writes.
- SQLite/FTS5-backed local storage index with search, corruption recovery, external-change reconciliation, and polling watch notifications.
- Sync merge helper and feature-gated Slate Sync stub.
- CodeMirror editor host, command palette, three-pane Slate UI, inspector, search, sheet creation, and responsive layout.
- Live CodeMirror invisible-Markdown decorations for inactive syntax markers.
- Debounced editor autosave controller with browser draft fallback and injectable storage writer.
- Desktop Tauri autosave writer and conflict-safe Rust disk write helper.
- Tauri SQL plugin wiring plus a storage helper that applies the shared SQLite/FTS schema through the native plugin binding.
- wa-sqlite OPFS wiring plus a storage helper that opens the browser index and applies the shared SQLite/FTS schema.
- Shared async SQLite index operations for native/web read, FTS search, and replace-all writes.
- Runtime SQLite adapter that rebuilds the shared index from an abstract Markdown file source.
- Browser directory-handle Markdown file source for recursive web rebuilds.
- Native Tauri Markdown file source commands and invoke wrapper for recursive desktop rebuilds.
- Core coverage enforcement and broader domain tests for round-trip stability, filters, metadata fallbacks, GFM parsing, and goal variants.
- Tauri 2 desktop shell and debug build.
- Rust authenticated encryption helpers with wrong-key failure tests.
- Vitest, Playwright, ESLint, TypeScript, Cargo, and CI verify gate.
- Axe Playwright accessibility smoke coverage for the primary workspace.

### Changed
- Playwright e2e serves the built web app through a small static Node server for deterministic readiness.
- Replaced the scaffold JSON index stand-in with a real SQLite FTS5 database via Node 24 `node:sqlite`.

### Known Gaps
- Browser handle persistence, drag/drop disk moves, export/publish adapters, deeper axe coverage, and performance budgets remain to be deepened from the scaffold.
