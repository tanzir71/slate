# Changelog

All notable changes to Slate will be documented in this file.

The format is based on Keep a Changelog, and this project uses Conventional Commits.

## [Unreleased]

### Added
- Light, Dark and System appearance with bundled Geist, Geist Mono and Newsreader fonts.
- Shared command/keymap registry, searchable OS-aware shortcut sheet and formatting selection toolbar with one-step undo.
- Live Markdown basics for headings, emphasis, highlights, links, tags, code, frontmatter and task checkboxes.
- Notebook navigation, persisted pins/density/collapse preferences, safe bulk move/trash and bounded sheet-list rendering.
- Interactive writing statistics, reading time and cursor navigation in the browser status bar.
- Reviewed Light/Dark visual regression baselines and a release typing benchmark using real saved 50k-word files.
- Unsigned three-platform desktop preview packaging, startup smokes, checksums and source-commit manifests from v0.3.
- Real Light/Dark landing captures with responsive mobile views and theme-aware image selection.

### Changed
- Reuse commands, formatting and shortcut notices in the native preview.
- Compute derived sheet summaries in a worker and keep typing recovery in a versioned incremental journal compatible with older open apps.
- Resolve release versions and commits before publishing; verify the live browser app and every desktop asset before creating the public release.

### Fixed
- Preserve independent undo history when changing native preview sheets and respect handled, composing and AltGr keyboard events.
- Keep optional view persistence from reading scroll layout during editor input while flushing pending scroll positions on exit.
- Preserve newer recovery drafts and unsupported source bytes across ownership transfer and conflicting external changes.
- Give modal close buttons 44 × 44 touch targets and keep long shortcut lists keyboard-scrollable.

## [0.2.1] - 2026-11-17

### Fixed
- Re-read the latest recovery journal before granting write ownership, so a tab taking over after the writer disappears keeps its latest unsaved words.
- Discard stale reader drafts when the previous writer has already saved, and update the editor buffer before enabling input.

## [0.2.0] - 2026-11-17

### Added
- Redesigned paper-and-graphite landing page with local fonts, real product screenshots, responsive navigation, and a direct browser-app launch.
- Persistent browser Folder/library Spaces, conflict-safe autosave and recovery, local worker FTS search, multi-tab ownership, and byte-preserving zip import/export.
- Offline PWA caching with an explicit save-before-reload update flow, install icons and confirmation-based launch shortcuts.
- Tag/release-driven GitHub Pages publication with three-browser checks, landing performance budgets and a live save/reopen smoke check.
- Offline release notes, incoming-update previews, browser capability information and author credit in About Slate.
- Installable manifest, local brand assets, confirmed Capture/Today/New sheet actions and Markdown file handling.

### Changed
- Restores the last sheet, caret, scroll position and remembered inspector visibility; starts with the command palette closed.
- Uses browser-safe shortcuts, real notebook/tag navigation, and basic Markdown formatting with one-step undo.
- Prioritizes the editor before opening its rebuildable search cache.

### Known limitations
- Folder editing requires a supporting Chromium browser. Other modern browsers use the private library and local import/export.
- Themes, creation tools, Tidy, desktop hardening, automation, history/export formats and opt-in Sync remain in later handover milestones.

## [0.1.0] - Handoff baseline

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
- Export adapter interfaces, registry, and a themeable HTML export adapter in `@slate/export`.
- Publish adapter interfaces, registry, and a deterministic static publish adapter in `@slate/publish`.
- Performance budget script wired into `pnpm verify` for large-sheet open, typing HUD, and SQLite FTS search timings.
- Release notes for the 0.1.0 handoff build.
- Core coverage enforcement and broader domain tests for round-trip stability, filters, metadata fallbacks, GFM parsing, and goal variants.
- Pure BYO-folder reconciliation model for accepting external edits, writing local edits, clean merges, and deterministic conflict-copy actions.
- Disk-backed sheet moves that refresh the SQLite index, avoid destination overwrites, and can be triggered through notebook drag/drop in the UI.
- Ctrl/Cmd-click wiki-link navigation in the editor with stable-id-first sheet resolution.
- Focus, typewriter, and full-screen editor modes with accessible toolbar toggles.
- Empty states for sheet search and inspector backlinks/outline panels.
- Keyboard shortcuts and a Playwright keyboard-only walkthrough for palette, search, inspector, focus mode, and space switching.
- Tauri 2 desktop shell and debug build.
- Rust authenticated encryption helpers with wrong-key failure tests.
- Vitest, Playwright, ESLint, TypeScript, Cargo, and CI verify gate.
- Axe Playwright accessibility smoke coverage for the primary workspace.

### Changed
- Playwright e2e serves the built web app through a small static Node server for deterministic readiness.
- Replaced the scaffold JSON index stand-in with a real SQLite FTS5 database via Node 24 `node:sqlite`.
