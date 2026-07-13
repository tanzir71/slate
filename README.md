# Slate

**Website:** https://slate-local-workspace.vercel.app/ · **Live demo:** https://slate-local-workspace.vercel.app/demo/

> A local-first Markdown editor and knowledge workspace — the calm of Ulysses/Bear with the ownership of Obsidian, on web and desktop.

## What is this?

Slate organizes writing into **Spaces → sheets**, edits pure Markdown, and keeps everything on your machine. It ships as a web PWA and a Tauri desktop app built from the same codebase, with performance budgets enforced in CI (opening a 50k-word document and searching 10k sheets are tested paths, not hopes).

## Architecture

A pnpm monorepo where **every capability is a package with a clean interface**, and the apps are thin shells that assemble them:

```
                    apps/web (Vite PWA)      apps/desktop (Tauri 2)
                        │                        │
                        └──────────┬─────────────┘
                                   │ both assemble the same packages
   ┌───────────────────────────────┼──────────────────────────────────┐
   │                               ▼                                   │
   │  packages/ui        React app shell (sidebar, sheet list,         │
   │                     inspector, palette, focus mode)               │
   │  packages/editor    CodeMirror 6 Markdown editing setup           │
   │  packages/core      PURE domain model + Markdown logic            │
   │  packages/storage   file/index adapters + local implementation    │
   │                     (SQLite FTS full-text search)                 │
   │  packages/sync      sync interfaces + deterministic merge helpers │
   │  packages/export    export adapters, HTML artifact rendering      │
   │  packages/publish   publish adapters, static publish contract     │
   │  packages/tokens    design tokens                                 │
   │                                                                   │
   │  crates/slate-core  Rust support crate (desktop-side heavy work)  │
   └───────────────────────────────────────────────────────────────────┘
```

Why this shape: `core` is pure (no I/O), so all document logic is fast to test; storage/sync/export/publish are **adapter interfaces**, so cloud sync or new export targets can be added without touching the editor; and the desktop app gets native speed via the Rust crate while sharing 95% of code with the web PWA. `apps/mobile` is a placeholder for the Tauri mobile track.

## Getting started (from zero)

### Prerequisites

| Tool | Why | Get it |
|---|---|---|
| Node.js 24+ | Everything | <https://nodejs.org> |
| pnpm 10+ | Monorepo manager | `npm install -g pnpm` |
| Rust stable | Desktop app only | <https://rustup.rs> |
| Tauri 2 OS prerequisites | Desktop app only | <https://v2.tauri.app/start/prerequisites/> |

### 1. Install

```bash
pnpm install
```

> **Windows note:** on this host, dependency installation needed Node's system certificate store: `$env:NODE_OPTIONS='--use-system-ca'; pnpm install`. Cargo revocation checks are disabled in `.cargo/config.toml` because local Schannel revocation lookup failed while fetching crates.

### 2. Run

```bash
pnpm dev:web       # browser version at the printed URL
pnpm dev:desktop   # native desktop window (first Rust build is slow)
```

### 3. Verify

```bash
pnpm verify
```

The verify gate runs TypeScript checks, ESLint, Vitest, Rust tests, builds both shells, checks performance budgets, and runs Playwright smoke tests.

```bash
pnpm perf
```

The performance hook checks the 50k-word open path, typing HUD stats on a large sheet, and SQLite FTS search over 10k synthetic sheets.

After `pnpm build`, the debug desktop executable is at `apps/desktop/src-tauri/target/debug/slate-desktop.exe`.

## Keyboard shortcuts

| Action | Shortcut |
|---|---|
| Command palette | `Ctrl+K` / `Cmd+K` |
| New sheet | `Ctrl+N` / `Cmd+N` |
| Focus sheet search | `Ctrl+Shift+F` / `Cmd+Shift+F` |
| Toggle inspector | `Ctrl+I` / `Cmd+I` |
| Focus mode | `Ctrl+.` / `Cmd+.` |
| Switch Spaces | `Ctrl+Alt+1..9` / `Cmd+Alt+1..9` |
| Toggle sidebar | `Ctrl+\` / `Cmd+\` |
| Toggle sheet list | `Ctrl+Alt+\` / `Cmd+Alt+\` |
| Close palette / exit focus or full-screen | `Esc` |

## Project layout

```
apps/web        Vite PWA target
apps/desktop    Tauri desktop target
apps/mobile     mobile shell placeholder
packages/*      core · storage · sync · export · publish · editor · ui · tokens
crates/slate-core   Rust support crate
```

## Troubleshooting

- **`pnpm install` TLS errors on Windows** → `$env:NODE_OPTIONS='--use-system-ca'` first.
- **`pnpm dev:desktop` fails** → confirm Rust (`cargo --version`) and the Tauri 2 OS prerequisites are installed; the web target needs neither.
- **Verify gate fails on perf budgets** → run `pnpm perf` alone to see which budget regressed.
