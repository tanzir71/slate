# Changelog

All notable changes to Slate will be documented in this file.

The format is based on Keep a Changelog, and this project uses Conventional Commits.

## [Unreleased]

### Added
- Initial handoff-driven pnpm monorepo with web, desktop, mobile, UI, editor, core, storage, sync, tokens, and Rust crates.
- Pure core Markdown parsing, tags, wiki-links, backlinks, smart filters, stats, and goal progress.
- Local storage adapter with rebuildable index cache and conflict-copy writes.
- Sync merge helper and feature-gated Slate Sync stub.
- CodeMirror editor host, command palette, three-pane Slate UI, inspector, search, sheet creation, and responsive layout.
- Tauri 2 desktop shell and debug build.
- Rust authenticated encryption helpers with wrong-key failure tests.
- Vitest, Playwright, ESLint, TypeScript, Cargo, and CI verify gate.

### Changed
- Playwright e2e serves the built web app through a small static Node server for deterministic readiness.

### Known Gaps
- SQLite/FTS, live file watching, drag/drop disk moves, live invisible-Markdown decorations, export/publish adapters, axe, and performance budgets remain to be deepened from the scaffold.
