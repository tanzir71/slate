# AGENTS.md - Slate

## Commands
- Install: `pnpm install`
- Dev desktop: `pnpm dev:desktop`
- Dev web: `pnpm dev:web`
- Verify gate: `pnpm verify`
- Unit tests: `pnpm test`
- Performance budgets: `pnpm perf`
- E2E: `pnpm e2e`
- Rust tests: `cargo test --manifest-path crates/slate-core/Cargo.toml`

## Golden Rules
- `packages/core` is pure TypeScript. No platform, Tauri, or DOM imports.
- Files on disk are the source of truth. SQLite and search indexes are rebuildable caches.
- Never lose user data. Prefer conflict copies over overwrites.
- One task equals one commit when Git is available. Use Conventional Commits.
- Update `PROGRESS.md` every loop.
- Write or adjust a test with every behavior change.
- TypeScript strict. No `any` without a `// why:` comment.
- Keep functions small and pure where possible. Delete dead code.

## Definition of Done
- `pnpm verify` exits 0, or a platform blocker has a documented workaround in `PROGRESS.md`.
- New behavior is covered by a test that fails without the change.
- `PROGRESS.md` and, for architectural choices, `DECISIONS.md` are updated.

## Where Things Live
- Domain logic: `packages/core`
- Editor: `packages/editor`
- File IO and index adapters: `packages/storage`
- Sync: `packages/sync`
- React UI: `packages/ui`
- Design tokens: `packages/tokens`
- Rust core: `crates/slate-core`
