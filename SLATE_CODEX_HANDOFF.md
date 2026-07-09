# Slate — Markdown Editor & Knowledge Workspace
### Codex Build Handoff & Autonomous Build Spec

> **Working codename:** `Slate` (a placeholder — rename freely).
> **What this document is:** A complete, self-contained specification for building a cross-platform Markdown editor that combines the focused writing experience of **Ulysses** and **Bear** with the rich organizational model of **Evernote Spaces**. It is written to be executed by an autonomous coding agent (OpenAI Codex / codex-cli) **in a loop**, with explicit phases, acceptance criteria, and self-verification gates so the agent can drive the app to a refined, production-quality state with minimal human intervention.
> **Audience:** The coding agent (primary) and the human reviewer (secondary).
> **Date:** 2026-07-09

---

## 0. How to Use This Document (Read First — Agent Loop Protocol)

You are an autonomous engineering agent. You will build this app by working through the **phased milestones in Section 9**. Each phase has tasks, a Definition of Done (DoD), and machine-checkable acceptance criteria.

### 0.1 The loop

Run this loop until all phases are complete and the global quality bar (Section 12) is met:

```
1. READ  → Read AGENTS.md and this spec. Load PROGRESS.md to find the current phase/task.
2. PLAN  → Pick the next unblocked task. Write a short plan in PROGRESS.md.
3. BUILD → Implement the task. Keep changes small and cohesive (one task per commit).
4. VERIFY→ Run the full gate: typecheck, lint, unit tests, e2e (if applicable), build.
5. SELF-REVIEW → Diff your changes against the task's acceptance criteria. Fix gaps.
6. RECORD→ Update PROGRESS.md (done/blocked/notes). Commit with a conventional message.
7. REPEAT→ If the phase DoD is met, advance to the next phase. Otherwise continue.
```

### 0.2 Hard rules for the loop

- **Never advance a phase with a red gate.** `pnpm verify` (defined in Section 11.4) must exit 0.
- **One task = one commit.** Use Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `chore:`, `docs:`).
- **Write the test first or alongside** the feature. No feature is "done" without a test that would fail if it regressed.
- **If blocked ≥ 2 attempts on the same task,** write a `BLOCKED:` entry in PROGRESS.md with the error, your hypotheses, and the smallest reproduction, then move to the next unblocked task.
- **Keep a running `DECISIONS.md`** (an ADR log) whenever you make a non-obvious architectural choice. One short entry each: context, decision, consequence.
- **Do not invent scope.** If a requirement is ambiguous, choose the simplest interpretation consistent with Section 4 (Product Principles) and note the assumption in DECISIONS.md.
- **Prefer deleting code to adding it** when it achieves the same acceptance criteria.

### 0.3 Files you must maintain at the repo root

| File | Purpose |
|---|---|
| `AGENTS.md` | Agent operating rules, commands, conventions (Section 10). Create in Phase 0. |
| `PROGRESS.md` | Live task board: phase, task, status, notes. Update every loop. |
| `DECISIONS.md` | Lightweight ADR log. Append-only. |
| `README.md` | Human-facing setup + run instructions. |
| `CHANGELOG.md` | Keep a Changelog format, updated per phase. |

---

## 1. Product Vision & Positioning

**One-liner:** *A calm, local-first Markdown workspace where writing feels like Bear and organizing feels like Evernote Spaces — on every device you own.*

**The wedge.** The best writing apps (Ulysses, Bear) are Apple-only and organize around a single flat library with tags/groups. The best organizers (Evernote, Notion) are cloud-first, heavier, and treat Markdown as a second-class citizen. **Slate sits in the gap:** a genuinely delightful Markdown editor with a first-class, multi-level organizational system (Spaces), that is **local-first, plain-text, and cross-platform** (macOS, Windows, Linux, iOS, Android, and web).

**What "refined" means here (the bar):** launch-to-first-keystroke under 1.5s on desktop; typing latency imperceptible on a 50k-word sheet; every action reachable by keyboard; no data loss ever (plain `.md` files are the source of truth); sync that is invisible when it works and recoverable when it doesn't.

**Non-goals (v1):** real-time multiplayer co-editing; a plugin marketplace; AI features beyond a thin, optional assist layer; a proprietary block format. These are explicitly deferred (Section 8.4) so the core stays sharp.

---

## 2. Target Users & Personas

**Primary — "The Long-form Writer" (Tanzir-type / Ulysses refugee).** Writes articles, docs, threads, and long notes. Wants distraction-free Markdown, writing goals, and clean export/publish. Frustrated that Ulysses/Bear are Apple-only and that organization is flat.

**Secondary — "The Knowledge Organizer" (Evernote/Notion refugee).** Keeps many projects and reference materials. Wants Spaces to separate work/personal/projects, nested notebooks, tags, saved searches, and links between notes — without a cloud lock-in or a database learning curve.

**Tertiary — "The Developer/Technical Note-taker" (Obsidian-adjacent).** Wants plain-text files on disk, code blocks, wiki-links/backlinks, and no vendor format. Values keyboard-driven flow and local ownership.

**Design tension to resolve continuously:** the Writer wants *less* UI; the Organizer wants *more* structure. Slate resolves this with **progressive disclosure** — a minimal three-pane default that reveals power (filters, backlinks, metadata) only on demand.

---

## 3. Competitive Analysis

Research current as of July 2026. Sources listed at the end of this section.

### 3.1 Feature & positioning matrix

| Dimension | **Ulysses** | **Bear 2** | **Evernote** | **Obsidian** | **Notion** | **Craft** | **Slate (target)** |
|---|---|---|---|---|---|---|---|
| Core model | Markdown sheets in a unified library | Markdown notes + nested tags | Rich notes in notebooks/stacks/**Spaces** | Plain-text `.md` vault, graph | Cloud blocks + databases | Nested block documents | **Plain-text `.md` + Spaces hierarchy** |
| Markdown | Markdown XL (footnotes, annotations) | Polar Markdown, hide syntax, style headings | Rich text (MD import/export weak) | CommonMark + wiki-links | Not true MD (block model) | Rich blocks, MD-ish | **CommonMark + GFM + "Slate XL" (footnotes, annotations, wiki-links)** |
| Organization | Groups (folders), filters, keywords | Nested tags `#a/b`, no folders | **Spaces > Notebooks; Stacks** | Folders + tags + links | Pages, databases, workspaces | Nested pages | **Spaces > Notebooks/Groups > Sheets + tags + smart filters** |
| Backlinks / linking | Limited | Wiki-links + backlinks panel (no graph) | Note links | `[[ ]]` links + **graph view** | Mentions, relations | Backlinks (no graph) | **`[[ ]]` wiki-links + backlinks panel + optional graph** |
| Writing goals | Yes (word/char/time) | No | No | Via plugins | No | No | **Yes (per-sheet & per-space)** |
| Export / publish | PDF, DOCX, HTML, ePub; WordPress/Ghost | PDF, DOCX, HTML, +themes | PDF/HTML | MD; plugins | MD/PDF/HTML | 1-click web publish | **PDF, DOCX, HTML, ePub + themeable styles + publish** |
| Storage | iCloud (proprietary DB) | iCloud (SQLite) | Cloud | **Local files** | Cloud | Offline-first sync | **Local `.md` files = source of truth** |
| Sync | iCloud only | iCloud only | Proprietary cloud | Paid sync / DIY | Cloud | Proprietary | **Optional E2EE cloud + BYO folder (iCloud/Dropbox/Git)** |
| Platforms | mac/iOS/iPad | mac/iOS/iPad | all + web | desktop/mobile | all + web | Apple-first + web | **mac/Win/Linux/iOS/Android/web** |
| Encryption | No | Per-note (Pro) | No E2EE | Local only | No E2EE | — | **Optional per-space E2EE** |
| Pricing (2026) | $5.99/mo, $49.99/yr | $2.99/mo, $29.99/yr | Free(50 notes)/Starter $99/Advanced $249.99/yr | Free; sync $ | Free tier; paid | Free/Plus | **Free core + Pro sync (target ~$3–5/mo)** |

### 3.2 What we take from each (and what we deliberately reject)

- **From Ulysses:** the *unified library* mental model, **writing goals**, and export/publish quality with themeable styles. **Reject:** proprietary storage and Apple-only reach.
- **From Bear:** the *beautiful, low-chrome editor*, **hide-markdown-on-blur** rendering, **nested tags**, per-note encryption, and fast full-text search. **Reject:** flat single-library ceiling and Apple lock-in.
- **From Evernote:** **Spaces** as the top-level separation of contexts, plus the Notebook layer beneath. **Reject:** the heavy cloud dependency, aggressive free-tier caps (50 notes/1 device), and weak Markdown.
- **From Obsidian:** **plain-text files as source of truth**, `[[wiki-links]]`, backlinks, and optional **graph view**; total data ownership. **Reject:** the fragile plugin-dependency treadmill and paid-or-DIY mobile sync friction.
- **From Notion/Craft:** **progressive structure** and clean nested navigation; one-click web publish. **Reject:** the non-Markdown block format and cloud-only offline story.

### 3.3 Gap Slate fills (the strategic bet)

No current app is **all** of: (1) true plain-text Markdown, (2) multi-level Spaces organization, (3) genuinely cross-platform incl. Windows/Linux/Android, (4) local-first with optional E2EE sync, (5) a writing-grade editor. Ulysses/Bear miss 3+4 (Apple-only). Evernote/Notion miss 1+4. Obsidian misses a polished org model + frictionless mobile sync. **Slate targets the intersection.**

### 3.4 Risks the competitors reveal

- **Sync is where these apps live or die.** Obsidian monetizes it; Bear/Ulysses lean on iCloud; Evernote's cloud is the lock-in. Slate must make sync *invisible and trustworthy* or it fails. Treat Section 8.3 as make-or-break.
- **Cross-platform Markdown "flavor drift"** breaks trust. Pin a spec (Appendix A) and test round-trips.
- **Free-tier resentment** (Evernote's 50-note cap) is a cautionary tale: keep the local core fully free; charge only for sync/publish conveniences.

**Sources:** [Ulysses Review 2026 (Productivity Stack)](https://productivitystack.io/tools/ulysses/), [Ulysses (G2)](https://www.g2.com/products/ulysses/reviews), [What's new in Bear 2](https://bear.app/faq/whats-new-in-bear-2/), [Bear Review 2026 (Productivity Stack)](https://productivitystack.io/tools/bear/), [Evernote — Spaces, Stacks & Notebooks](https://evernote.com/blog/spaces-stacks-notebooks), [Evernote Spaces Overview (Help)](https://help.evernote.com/hc/en-us/articles/36621846528915-Spaces-Overview-for-individual-accounts), [Evernote pricing 2026 (eesel)](https://www.eesel.ai/blog/evernote-pricing), [Notion vs Obsidian 2026 (Atlas)](https://www.atlasworkspace.ai/blog/notion-vs-obsidian), [Craft vs Ulysses (Craft)](https://www.craft.do/compare/ulysses), [Tauri 2.0 Stable Release](https://v2.tauri.app/blog/tauri-20/), [Tauri 2.0 (docs)](https://v2.tauri.app/)

---

## 4. Product Principles (the tie-breakers)

1. **Plain text or it didn't happen.** Every sheet is a real `.md` file on disk. The app is a lens, not a vault you're trapped in.
2. **Calm by default, powerful on demand.** Minimal three-pane UI; power features hide until invoked. Progressive disclosure over feature walls.
3. **The keyboard is the primary input.** Everything has a shortcut; a command palette exposes all actions.
4. **Never lose a keystroke.** Local-first, autosave, crash-safe, conflict-preserving. Data safety beats every other concern.
5. **Fast is a feature.** Cold start < 1.5s; typing latency imperceptible; search results < 100ms on 10k sheets.
6. **Consistency across platforms** without feeling foreign on any. Respect native conventions (menus, shortcuts, share sheets).
7. **Boring, testable architecture.** Prefer well-trodden libraries and pure functions. Optimize for the agent's ability to verify.

---

## 5. Information Architecture — The Organization Model

This is Slate's differentiator. Model it precisely.

```
Account
└── Space            (top-level context: "Work", "Personal", "Novel")  ← Evernote-inspired
    ├── Notebook      (a collection: "Blog", "Research")               ← a.k.a. "Group"
    │   ├── Notebook  (nested, arbitrary depth)
    │   └── Sheet     (a single .md file — the atomic unit)            ← Ulysses "sheet"/Bear "note"
    ├── Sheet         (sheets can live directly under a Space too)
    ├── Smart Filter  (saved dynamic query: tag/date/text/goal state)  ← Ulysses filters
    └── Settings      (theme, goal, optional E2EE, sync target)
```

- **Space** = hard separation of context. Switching Spaces changes the whole sidebar. Each Space maps to a **root folder on disk** (so users can point a Space at an existing folder / iCloud / Dropbox / Git repo).
- **Notebook (Group)** = folder within a Space; nestable to arbitrary depth.
- **Sheet** = one `.md` file. The unit of editing, linking, exporting.
- **Tags** = `#nested/tags` parsed from sheet content and/or front-matter; cross-cut Notebooks and can even be scoped global vs per-Space (setting).
- **Smart Filters** = saved queries (e.g., `tag:#draft AND modified:<7d AND goal:incomplete`). Live-updating virtual collections.
- **Links** = `[[Sheet Title]]` wiki-links and standard `[text](path)`; backlinks index maintained incrementally.

**Disk layout (source of truth):**
```
<SpaceRoot>/
  .slate/
    space.json          # space id, name, icon, color, settings
    index.sqlite        # derived FTS + metadata index (rebuildable, never authoritative)
    filters.json        # smart filters
  Blog/                 # a Notebook == a directory
    my-post.md          # a Sheet
    assets/             # co-located images/attachments
  Research/
    Deep/
      note.md
```
**Rule:** the SQLite index is a *cache*. If it's deleted, the app rebuilds it from the `.md` files. Files always win.

**Front-matter contract (YAML) — optional but recognized:**
```yaml
---
title: My Post
tags: [draft, blog/tech]
created: 2026-07-09T10:00:00Z
updated: 2026-07-09T12:00:00Z
goal: { type: words, target: 1200 }
id: 01J8...ULID   # stable id for links that survive renames
---
```

---

## 6. Editor Specification

**Engine:** **CodeMirror 6** (modular, high-performance, mobile-capable, first-class Markdown language support). Do **not** use a WYSIWYG/block engine — it conflicts with the plain-text principle.

**Editing model — "invisible Markdown":** render Markdown inline like Bear 2. Syntax markers (`**`, `#`, `>`) are visible on the active line / when the caret is inside the token, and dim/hide otherwise. Implement via CodeMirror decorations, not by mutating the document.

**Must support:**
- CommonMark + GFM (tables, task lists `- [ ]`, strikethrough, autolinks).
- Fenced code blocks with syntax highlighting (Lezer/Highlight.js) for 100+ languages.
- LaTeX math (`$…$`, `$$…$$`) via KaTeX.
- Footnotes, and "Slate XL" annotations/comments (Appendix A).
- `[[wiki-links]]` with autocomplete (fuzzy over sheet titles) and click-to-navigate.
- Image paste/drag → saved to co-located `assets/`, linked relatively.
- Typewriter mode, focus mode (dim inactive paragraphs), and a distraction-free full-screen mode.
- Word/char/reading-time counters; live **writing goal** progress ring.
- Find & replace (regex optional); outline view from headings.

**Performance targets:** open + render a 50,000-word sheet in < 400ms; sustained typing with no dropped frames; incremental parse (no full re-tokenize on keystroke).

---

## 7. UX / Visual Design

**Layout:** classic three-pane, each independently collapsible.
1. **Sidebar** — Space switcher (top), then Notebooks tree + Smart Filters + Tags.
2. **Sheet list** — sheets in the selected Notebook/Filter, with sort (modified/created/title/manual) and inline preview snippet + goal indicator.
3. **Editor** — the sheet, with an optional right **Inspector** (metadata, backlinks, table of contents, goal, tags) — hidden by default (progressive disclosure).

**Command palette** (`Cmd/Ctrl-K`): fuzzy access to every command, sheet, and Space. This is the power-user spine.

**Theming:** light/dark/system + a small set of built-in themes; user themes via CSS variables (design tokens below). Editor themes independent from chrome themes.

**Design tokens (seed — refine in Phase 6):**
```
--font-ui: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif
--font-editor: "iA Writer Quattro", ui-monospace, "SF Mono", monospace  (user-swappable)
--radius: 8px;  --space-unit: 4px
color: neutral gray scale + one accent per Space (user-set)
motion: 120–200ms ease-out; respect prefers-reduced-motion
```

**Accessibility (WCAG 2.1 AA, non-negotiable):** full keyboard nav, visible focus rings, ≥4.5:1 text contrast, ≥44px touch targets on mobile, screen-reader labels, and reduced-motion support. Ship an a11y test in CI (axe).

---

## 8. Architecture & Technology

### 8.1 Stack (decided)

- **Shell:** **Tauri 2** (Rust core) for macOS, Windows, Linux, **iOS, and Android** from one codebase; **web** target via the same React app served as a PWA. (Tauri 2 is stable since Oct 2024 and supports mobile; binaries ~8MB vs Electron ~150MB.)
- **UI:** **React 18 + TypeScript** (strict), **Vite** bundler.
- **Editor:** **CodeMirror 6**.
- **State:** **Zustand** (lightweight) + TanStack Query for async; avoid Redux boilerplate.
- **Styling:** CSS variables + a utility layer (Tailwind acceptable) — but tokens drive everything.
- **Local index/search:** **SQLite** (via `tauri-plugin-sql` / `sqlx` on native; `wa-sqlite`/OPFS on web) with **FTS5** for full-text search.
- **Markdown parsing (non-editor, e.g. export/index):** `unified`/`remark` + `remark-gfm`.
- **Package manager / monorepo:** **pnpm workspaces**.
- **Testing:** Vitest (unit), Playwright (e2e/web), `@tauri-apps/api` mocks; Rust `cargo test` for core.

### 8.2 Repository layout (monorepo)

```
slate/
  AGENTS.md  PROGRESS.md  DECISIONS.md  README.md  CHANGELOG.md
  package.json  pnpm-workspace.yaml  turbo.json
  apps/
    desktop/            # Tauri desktop entry (wraps @slate/ui)
    mobile/             # Tauri mobile (iOS/Android) config
    web/                # Vite PWA build of @slate/ui
  packages/
    ui/                 # React app: panes, editor host, command palette
    editor/             # CodeMirror 6 setup, Slate-XL extensions, decorations
    core/               # platform-agnostic domain: Space/Notebook/Sheet models,
                        #   parsing, link/backlink index, filters, goals (pure TS, 100% unit-tested)
    storage/            # file IO + SQLite index adapters (native vs web behind one interface)
    sync/               # optional sync engine (Section 8.3), behind a feature flag
    tokens/             # design tokens + theme definitions
  crates/
    slate-core/         # Rust: fast file watch, indexing, crypto (E2EE), FS bridge
  e2e/                  # Playwright specs
```

**Golden rule:** `packages/core` is pure, platform-free, and exhaustively unit-tested. All platform differences live behind adapter interfaces in `storage`/`sync`. This maximizes what the agent can verify without a device.

### 8.3 Sync strategy (make-or-break — build behind a flag, ship in Phase 7)

Two complementary layers; the local app never depends on either being present.

1. **BYO-folder sync (default, zero-infra):** because a Space *is* a folder, users can place it in iCloud Drive / Dropbox / OneDrive / a Git repo and get sync "for free." The app must be **robust to external file changes** (file watcher → reconcile) and **conflict-safe**: on a detected conflict, never overwrite — write `sheet (conflicted copy YYYY-MM-DD).md` and surface a merge UI. This works on day one with no backend.
2. **Slate Sync (optional, Pro):** an end-to-end-encrypted cloud relay for users who want turnkey cross-device sync incl. mobile. Model sheets as text with a **CRDT** (Yjs or Automerge) to enable low-friction merges; store encrypted blobs server-side (server never sees plaintext). Per-Space E2EE key. **Do not build the server in this repo's MVP** — define the interface in `packages/sync`, stub it, and gate behind `feature.slateSync`. Phase 7 delivers the client interface + local CRDT merge + conflict UI; the hosted service is a separate track.

**Testing sync is mandatory:** simulate two clients editing the same sheet offline, then reconcile; assert no data loss and deterministic merge. This test suite is the trust anchor.

### 8.4 Explicitly deferred (do not build in v1)

Real-time multiplayer presence/cursors; plugin marketplace/third-party plugin API; server-side AI; proprietary block format; web-clipper browser extension; team/enterprise admin. Note them in a `FUTURE.md` and move on.

---

## 9. Phased Milestones (the build plan the agent executes)

Each phase: **Goal → Tasks → Definition of Done (DoD) → Acceptance criteria (machine-checkable).** Do phases in order. Do not start a phase until the previous DoD is green.

### Phase 0 — Foundation & Guardrails
**Goal:** a running, verifiable skeleton the loop can build on.
**Tasks:** scaffold pnpm monorepo + Tauri 2 desktop app + Vite React/TS(strict); set up ESLint/Prettier, Vitest, Playwright, `cargo test`; create `AGENTS.md`, `PROGRESS.md`, `DECISIONS.md`, `README.md`, `CHANGELOG.md`; add the `pnpm verify` meta-script (Section 11.4); set up GitHub-Actions-style CI config; render a "Hello Slate" window.
**DoD:** `pnpm install && pnpm verify` exits 0; desktop app launches to a window; CI config present.
**Acceptance:** typecheck passes with `strict:true`; one trivial unit test and one Playwright smoke test pass; `tauri build` (debug) succeeds on the host OS.

### Phase 1 — Domain Core (pure, testable)
**Goal:** the `packages/core` model with no UI.
**Tasks:** define types for `Space`, `Notebook`, `Sheet`, `Tag`, `SmartFilter`, `Link`; Markdown parse → AST (remark) with GFM; tag extraction (`#nested/tag`) from body + front-matter; wiki-link + backlink indexer; smart-filter query evaluator (tag/date/text/goal predicates); word/char/reading-time + goal computation; stable `id` (ULID) handling and rename-safe link resolution.
**DoD:** `packages/core` at ≥90% line coverage; zero platform imports.
**Acceptance:** unit tests for tag parsing, backlink resolution across renames, and every filter predicate; property test: parse→serialize round-trip of a sheet is byte-stable for canonical input.

### Phase 2 — Storage & Index
**Goal:** files on disk are the source of truth; SQLite is a rebuildable cache.
**Tasks:** `storage` adapter interface; native impl (Tauri FS + `tauri-plugin-sql` FTS5) and web impl (OPFS + wa-sqlite); file watcher → incremental reindex; index rebuild-from-scratch command; import an existing folder as a Space.
**DoD:** deleting `index.sqlite` and reopening rebuilds identical search results.
**Acceptance:** create/rename/move/delete of files reflect in the index within 500ms; FTS query returns correct sheets; a corrupted index auto-rebuilds; test proves files are never mutated by indexing.

### Phase 3 — Editor MVP
**Goal:** a delightful Markdown editing surface.
**Tasks:** integrate CodeMirror 6 into `packages/editor`; CommonMark+GFM; invisible-Markdown decorations (Bear-style); code fences w/ highlighting; task lists; find/replace; autosave (debounced) to disk; word/char/reading-time HUD.
**DoD:** editing a sheet writes valid `.md` to disk with no data loss across app restarts.
**Acceptance:** typing latency budget met on a 50k-word fixture (perf test); autosave survives a forced quit (crash-safety test); markdown round-trips through disk unchanged.

### Phase 4 — Organization: Spaces, Notebooks, Sheets, Tags
**Goal:** the three-pane app with the full hierarchy.
**Tasks:** sidebar with Space switcher + nested Notebook tree (create/rename/move/delete, drag-drop); sheet list with sort + preview + goal indicator; tag tree (nested) with cross-cut filtering; per-Space accent color/icon; move sheet between Notebooks/Spaces (moves the file).
**DoD:** a user can model the Section 5 hierarchy end-to-end via UI, and it maps 1:1 to disk.
**Acceptance:** drag-drop a sheet across Notebooks moves the file and updates links; nested tag `#a/b` filters correctly; creating a Space points at a chosen folder and imports it.

### Phase 5 — Power Features: Smart Filters, Links, Backlinks, Goals, Search
**Goal:** the Evernote/Obsidian-grade organizational payoff.
**Tasks:** Smart Filter builder + saved filters (live-updating); `[[wiki-link]]` autocomplete + navigation; Inspector panel (backlinks, outline/ToC, metadata, tags); writing goals per sheet and per Space with progress UI; global command palette (`Cmd/Ctrl-K`) exposing all actions/sheets/spaces; global fuzzy + full-text search UI.
**DoD:** all four differentiators (Spaces, filters, backlinks, goals) usable and keyboard-driven.
**Acceptance:** a saved filter updates when a matching sheet is edited; backlinks panel lists all linking sheets and survives a rename; command palette can reach every command; search < 100ms on a 10k-sheet fixture.

### Phase 6 — Design Polish, Theming, Accessibility
**Goal:** it *feels* like Bear/Ulysses.
**Tasks:** finalize design tokens + built-in light/dark/themes; editor themes; focus/typewriter/full-screen modes; motion pass (respect reduced-motion); empty states + onboarding first-run; WCAG 2.1 AA pass (contrast, focus, labels, targets); responsive layout for small windows.
**DoD:** axe a11y suite passes; visual QA checklist complete.
**Acceptance:** automated axe run has zero critical violations; keyboard-only walkthrough completes core flows; contrast tokens verified; reduced-motion honored.

### Phase 7 — Cross-Platform Targets & Sync
**Goal:** run everywhere; make sync trustworthy.
**Tasks:** Tauri mobile (iOS + Android) build configs; web PWA build; platform-native menus/shortcuts/share; BYO-folder sync robustness (external-change reconcile + conflict-copy + merge UI); `packages/sync` interface + local CRDT (Yjs/Automerge) merge + conflict tests (Slate Sync gated behind flag, stub backend).
**DoD:** app builds and runs on desktop (3 OSes), web PWA, and at least one mobile target; conflict test suite green.
**Acceptance:** two-client offline-edit reconciliation loses no data and merges deterministically; external file change (simulating Dropbox) reconciles without clobber; mobile build launches and edits a sheet.

### Phase 8 — Export, Publish & Release Hardening
**Goal:** ship-ready.
**Tasks:** export PDF/DOCX/HTML/ePub with themeable styles; one-click publish (WordPress/Ghost adapters behind interfaces, at least one working); per-Space optional E2EE (Rust crypto in `slate-core`); crash reporting (opt-in), update mechanism; performance budget enforcement in CI; docs + first-run tour.
**DoD:** signed/packaged builds; all quality-bar metrics (Section 12) met.
**Acceptance:** export fixtures match golden snapshots; E2EE round-trips (encrypt→decrypt) with wrong-key failure test; cold-start and search budgets enforced by a CI perf gate.

---

## 10. AGENTS.md — Operating Rules (create this file in Phase 0)

Put a file at repo root named `AGENTS.md` with (at minimum) the content below. Codex reads `AGENTS.md` automatically.

```md
# AGENTS.md — Slate

## Commands
- Install:      pnpm install
- Dev desktop:  pnpm dev:desktop
- Dev web:      pnpm dev:web
- Verify (gate): pnpm verify        # typecheck + lint + test + build; MUST pass before commit
- Unit tests:   pnpm test
- E2E:          pnpm e2e
- Rust tests:   cargo test --manifest-path crates/slate-core/Cargo.toml

## Golden rules
- packages/core is pure TypeScript. No platform/Tauri/DOM imports. 100%-ish tested.
- Files on disk are the source of truth. The SQLite index is a rebuildable cache.
- Never lose user data. Prefer conflict-copies over overwrites.
- One task = one commit (Conventional Commits). Update PROGRESS.md every loop.
- Write/adjust a test with every behavior change.
- TypeScript strict. No `any` without a `// why:` comment. No unused exports.
- Keep functions small and pure where possible. Delete dead code.

## Definition of Done (per task)
- `pnpm verify` exits 0.
- New behavior covered by a test that fails without the change.
- PROGRESS.md and (if architectural) DECISIONS.md updated.

## Where things live
- Domain logic → packages/core
- Editor → packages/editor
- File IO / index → packages/storage
- Sync → packages/sync (feature-flagged)
- React UI → packages/ui
- Rust core (watch/crypto/FS) → crates/slate-core
```

---

## 11. Engineering Standards & The Verify Gate

### 11.1 Language & style
TypeScript `strict: true`, `noUncheckedIndexedAccess: true`. ESLint (typescript-eslint recommended) + Prettier. Rust: `clippy` clean, `rustfmt`. No warnings in CI.

### 11.2 Testing pyramid
- **Unit (most):** `packages/core` logic — parsing, indexing, filters, links, goals, merge.
- **Integration:** storage adapters against a temp dir; index rebuild; watcher reconcile.
- **E2E (few, high-value):** Playwright on the web build — create Space → notebook → sheet → edit → filter → backlink → search.
- **Perf tests:** editor latency, cold start, search — assert against budgets (Section 12).
- **Property tests:** markdown round-trip stability; CRDT merge determinism.

### 11.3 CI
On every push: `pnpm verify` on Linux + macOS + Windows; `cargo test`; axe a11y (Phase 6+); perf budget gate (Phase 8). Red CI blocks merge.

### 11.4 The `pnpm verify` script (define in Phase 0)
```
pnpm verify = typecheck  (tsc --noEmit, all packages)
           && lint       (eslint . && cargo clippy -- -D warnings)
           && test        (vitest run + cargo test)
           && build       (vite build + tauri build --debug)
```
This single command is the loop's gate. It must exit 0 before any commit.

---

## 12. Global Quality Bar (Definition of "Refined")

The app is "done/refined" only when **all** hold:

- **Correctness:** all phase acceptance criteria green; CI green on 3 desktop OSes + web.
- **Data safety:** crash-safety, autosave, and conflict-copy tests pass; no test can produce data loss.
- **Performance:** cold start < 1.5s (desktop); open 50k-word sheet < 400ms; typing shows no dropped frames; search < 100ms @ 10k sheets.
- **Accessibility:** axe zero critical violations; full keyboard operability; WCAG 2.1 AA contrast.
- **Coverage:** `packages/core` ≥ 90%; overall ≥ 75% lines.
- **Cross-platform:** builds+launches on macOS/Windows/Linux, web PWA, and ≥1 mobile target.
- **Fidelity:** editor matches the "invisible Markdown" spec; Spaces/Notebooks/Sheets/tags/filters/backlinks/goals all functional and keyboard-driven.
- **Docs:** README lets a new dev run all targets; DECISIONS.md explains every non-obvious choice.

When every item is checked in PROGRESS.md and CI is green, stop the loop and write a `RELEASE_NOTES.md` summarizing what shipped.

---

## 13. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Sync/merge data loss (the killer) | CRDT + conflict-copies + a mandatory two-client reconciliation test suite; files always win over index. |
| Tauri mobile immaturity for complex UI | Keep mobile UI simple (reader+editor+nav); validate the CodeMirror-in-webview path early in Phase 7; fall back to a reduced mobile feature set if needed (note in DECISIONS.md). |
| Markdown flavor drift across platforms | Pin Appendix A; round-trip property tests; single parser (`remark`) config shared everywhere. |
| Editor perf on huge sheets | CodeMirror incremental parsing; virtualize sheet list; perf tests as CI gates. |
| Scope creep | Section 8.4 deferral list; agent must log any new scope in DECISIONS.md and prefer the simplest path. |
| Cross-platform build flakiness | CI matrix on 3 OSes from Phase 0; keep native surface (`slate-core`) thin. |

---

## 14. Appendix A — "Slate XL" Markdown Flavor (pin this)

Base: **CommonMark + GFM** (tables, task lists, strikethrough, autolinks). Extensions:
- **Wiki-links:** `[[Sheet Title]]` and `[[Sheet Title|display text]]`; resolves by title then by `id`.
- **Footnotes:** `[^1]` / `[^1]: text` (GFM footnotes).
- **Annotations/comments (non-exported by default):** `%%comment%%`.
- **Math:** `$inline$` and `$$block$$` (KaTeX).
- **Highlight:** `==highlight==`.
- **Front-matter:** YAML block (Section 5). Optional; app also works on plain `.md` with zero front-matter.
- **Images/attachments:** relative links into a co-located `assets/` dir.

Round-trip rule: parsing a Slate-XL document and re-serializing it must be byte-stable for canonical input (property-tested).

## 15. Appendix B — Keyboard Shortcuts (seed; finalize Phase 5–6)

| Action | macOS | Win/Linux |
|---|---|---|
| Command palette | ⌘K | Ctrl+K |
| New sheet | ⌘N | Ctrl+N |
| New notebook | ⇧⌘N | Ctrl+Shift+N |
| Switch Space | ⌃1..9 | Ctrl+Alt+1..9 |
| Quick open / go to sheet | ⌘O | Ctrl+O |
| Search everything | ⇧⌘F | Ctrl+Shift+F |
| Toggle inspector (backlinks/ToC) | ⌘I | Ctrl+I |
| Focus mode | ⌘. | Ctrl+. |
| Insert wiki-link | ⌘L | Ctrl+L |
| Toggle sidebar / list | ⌘\ / ⌥⌘\ | Ctrl+\ / Ctrl+Alt+\ |

## 16. Appendix C — Glossary

**Space** = top-level context, backed by a root folder. **Notebook (Group)** = a folder within a Space, nestable. **Sheet** = one `.md` file. **Smart Filter** = a saved live query. **Backlink** = a sheet that links to the current one. **Slate Sync** = optional E2EE cloud sync (Pro). **BYO-folder sync** = using iCloud/Dropbox/Git by pointing a Space at that folder.

---

## 17. First Actions for the Agent (start here)

1. Create the repo and **Phase 0** scaffold; commit `chore: scaffold monorepo + tauri + ci`.
2. Write `AGENTS.md`, `PROGRESS.md` (seed with all phases/tasks from Section 9), `DECISIONS.md`.
3. Make `pnpm verify` exist and pass on a trivial test.
4. Begin the loop at **Phase 1**. Update `PROGRESS.md` after every task. Do not advance a phase on a red gate.
