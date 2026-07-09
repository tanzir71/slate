# Slate 0.1.0 Handoff Build

Date: 2026-07-10

This handoff build delivers a verified local-first Markdown workspace skeleton with real domain logic, file-backed storage, SQLite/FTS indexing, CodeMirror editing, a three-pane React UI, Tauri desktop wiring, web/mobile build targets, sync/export/publish adapter boundaries, and release-hardening gates.

## Shipped
- Domain core for Markdown/frontmatter parsing, tags, wiki links, backlinks, smart filters, stats, writing goals, stable ids, and canonical round trips.
- Local storage adapter with conflict-copy writes, move/delete operations, SQLite FTS5 indexing, corrupted-index rebuilds, external-change reconciliation, and watch notifications.
- Runtime SQLite bridges for Tauri SQL and web OPFS, plus native and browser Markdown file-source adapters.
- CodeMirror editor host with CommonMark/GFM, find/replace support, invisible Markdown decorations, wiki-link navigation, autosave hooks, and writing HUD counters.
- Three-pane workspace UI with Spaces, notebooks, sheet list, search/tag filtering, inspector, command palette, goals, editor modes, empty states, drag/drop sheet moves, and keyboard-only desktop walkthrough coverage.
- Tauri desktop shell with conflict-safe native sheet writes, SQL plugin bootstrap, Rust path-safety helpers, and E2EE crypto tests.
- Web PWA and mobile shell builds that share the same UI package.
- `@slate/sync` merge and BYO-folder reconcile models, gated Slate Sync stub, `@slate/export` interfaces with themeable HTML export, and `@slate/publish` interfaces with a static publish adapter.
- Verify gate for typecheck, lint, Vitest coverage, Rust tests, builds, Tauri debug build, performance budgets, and Playwright e2e/a11y.

## Verification
- `pnpm verify` passed locally on 2026-07-10.
- Vitest: 18 files, 57 tests passing; core coverage gate at 94.3% lines/statements, 84.48% branches, 100% functions.
- Rust: 8 tests passing in `crates/slate-core`.
- Playwright: 7 passing, 1 skipped mobile keyboard walkthrough by design.
- Performance budgets from the latest verify run:
  - Open 50k-word sheet: 30.7ms / 400ms budget.
  - Typing HUD stats on 5k words: 0.7ms / 50ms budget.
  - SQLite FTS search over 10k sheets: 0.5ms / 100ms budget.

## Operational Notes
- On this Windows host, dependency install required `NODE_OPTIONS=--use-system-ca`.
- Cargo revocation checking is disabled in `.cargo/config.toml` for this repository because local Schannel revocation lookup failed while fetching crates.
- Playwright uses `scripts/serve-static.mjs` against the built web app because Vite preview did not satisfy readiness checks in this shell.
- The in-app browser backend was unavailable, so rendered QA used Playwright screenshots and checks.

## Remaining Deepening
- Browser directory-handle persistence and UI integration.
- Full PDF/DOCX/ePub exporters and real WordPress/Ghost publish adapters beyond the current adapter contracts.
- Broader axe flows beyond the primary workspace smoke coverage.
