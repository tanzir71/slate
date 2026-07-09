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
