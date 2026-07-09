# Slate

A local-first Markdown editor and knowledge workspace inspired by Ulysses, Bear, Evernote Spaces, and Obsidian.

## Prerequisites
- Node.js 24+
- pnpm 10+
- Rust stable
- Platform prerequisites for Tauri 2 on your OS

## Install
```bash
pnpm install
```

## Run
```bash
pnpm dev:web
pnpm dev:desktop
```

## Verify
```bash
pnpm verify
```

The verify gate runs TypeScript checks, ESLint, Vitest, Rust tests, builds the web and desktop shells, and runs Playwright smoke tests.

## Keyboard
- Command palette: `Ctrl+K` / `Cmd+K`
- New sheet: `Ctrl+N` / `Cmd+N`
- Focus sheet search: `Ctrl+Shift+F` / `Cmd+Shift+F`
- Toggle inspector: `Ctrl+I` / `Cmd+I`
- Focus mode: `Ctrl+.` / `Cmd+.`
- Switch Spaces: `Ctrl+Alt+1..9` / `Cmd+Alt+1..9`
- Toggle sidebar: `Ctrl+\` / `Cmd+\`
- Toggle sheet list: `Ctrl+Alt+\` / `Cmd+Alt+\`
- Close palette or exit focus/full-screen mode: `Esc`

On this Windows host, dependency installation required Node to use the system certificate store:

```powershell
$env:NODE_OPTIONS='--use-system-ca'; pnpm install
```

Cargo revocation checks are disabled for this repository in `.cargo/config.toml` because local Schannel revocation lookup failed while fetching crates.

After `pnpm build`, the debug desktop executable is produced at:

```text
apps/desktop/src-tauri/target/debug/slate-desktop.exe
```

## Project Layout
- `apps/web`: Vite PWA target
- `apps/desktop`: Tauri desktop target
- `apps/mobile`: mobile shell placeholder for the Tauri mobile track
- `packages/core`: pure domain model and Markdown logic
- `packages/storage`: file/index adapter interfaces and local implementation
- `packages/sync`: sync interfaces and deterministic merge helpers
- `packages/export`: export adapter interfaces and HTML artifact rendering
- `packages/publish`: publish adapter interfaces and static publish contract
- `packages/editor`: CodeMirror setup
- `packages/ui`: React app shell
- `packages/tokens`: design tokens
- `crates/slate-core`: Rust support crate
