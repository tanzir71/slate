# Slate Decisions

## 2026-11-19 - Restrict desktop commands and keep SQL inside the native process

Search cache readiness follows source revisions. Serialize rebuilds, invalidate on unsaved or external changes, discard in-flight old answers, and consult indexed results only after the latest successful replacement. A failed rebuild uses current file contents until repaired; cache failure cannot hide or mutate source files.

Set an explicit production CSP: local scripts, local fonts, the required Tauri IPC endpoints and same-origin workers; permit inline styles for CodeMirror and React layout. Block objects, frames, base changes and form navigation. Preserve Tauri�s generated bootstrap hashes/nonces. A separate development policy permits Vite React-refresh inline bootstrap and its exact HMR websocket. The [Tauri CSP guide](https://v2.tauri.app/security/csp/) and [configuration reference](https://v2.tauri.app/reference/config/#securityconfig) describe both build-time CSP modification and the separate dev policy. The compiled frontend tests run under the production response header, including real Tidy workers, and prove injected inline scripts, base URLs and outbound fetches are blocked.

Tauri�s app commands are [available to app windows/webviews by default unless listed in AppManifest](https://v2.tauri.app/security/capabilities/). Declare every registered application command in the build manifest and grant its generated permission only to local `main`. Keep the registry, manifest and capability list exhaustively checked. Filesystem commands still validate fixed roots and exact source snapshots in Rust; the generated permission does not replace those checks. Legacy Markdown readers now use the same checked reader, rejecting links and traversal with serialized typed errors while preserving BOM/CRLF bytes. Async legacy commands use the blocking filesystem pool. Native clients turn those typed failures into readable Error objects without dropping the kind.

Remove the webview�s SQL plugin and its general load/select/execute permissions. The native process opens only its fixed app-cache `slate-index.sqlite`; reject linked/non-file database, WAL and shared-memory paths. Two bounded commands replace the rebuildable index in one transaction and search it with fixed parameterized statements. Queries are literal FTS terms, including Unicode fallback; no caller supplies a database location or SQL text. Cache failure keeps file-based search available and never rewrites notes. Retain old disposable caches rather than treating them as user data to migrate. The existing generic storage SQL adapter remains available to consumers that deliberately provide that plugin; the desktop app uses the bounded cache port.

F-02 lifecycle plugins, bundle defaults, native root selection and later desktop features remain required work. This security checkpoint does not establish completion of the whole milestone or relax any release gate.

## 2026-11-19 - Make the production desktop workspace read real files

Reuse the disk-backed Zustand workspace through a neutral FileSpace protocol. Browser adapters retain their mutable file capability; native adapters expose create-only, exact-byte checked save, move and trash operations, with no unchecked write/remove port. Preserve BrowserSpace exports for existing consumers. Production desktop uses a separate native entry and reads the existing app-data `spaces/default` root; startup failures remain visible and never create seeded replacement notes. Global snippets use the native app-data `global` directory. Multiple/root-selected native Spaces remain a separate required integration; do not represent seeded Work/Personal spaces as real roots.

Native mutations serialize this process and retain the actual detached source before publishing without replacement. Stage and sync proposals; verify hard-link support before detaching a canonical note; compare the captured bytes and retain conflict versions if another writer won. Missing canonical notes with a pending marker report the recovery path instead of authorizing a default. Clean up only verified unchanged successful-write copies, keeping autosave from accumulating unlimited snapshots. Retained copies after completed handoffs use previous-copy names, so a deliberate later deletion honors absence instead of being mistaken for interruption. This is a recoverable handoff with a brief external canonical-name gap, not an OS-level atomic compare-and-replace. Reads/mutations reject linked parents/files and paths outside the root. Portable new paths also reject [Windows device names, stream syntax and trailing dots/spaces](https://learn.microsoft.com/en-gb/windows/win32/fileio/naming-a-file). Preserve original bytes, BOM/line endings, read-only failures, trash and exports.

Use [notify�s recommended native watcher](https://docs.rs/notify/8.2.0/notify/fn.recommended_watcher.html) for both fixed roots, ignore access-only events and coalesce frontend refreshes by25ms. Reconcile after listener registration to cover the initial read/listen gap; retain dirty drafts during refresh. Report watch failures and enable400ms periodic checking rather than silently freezing external changes. Close requests prevent immediate destruction and await a successful draft flush; failed saves keep the window and recovery journal open.

The shared file workspace uses its implemented command set on desktop with native shortcut chords; unrelated legacy preview-only focus/Space commands stay out of its registry. Reuse native Tidy and library UI through the checked port. Search remains a rebuildable cache. Because the SQL plugin pools connections, perform an entire native replacement on one SQLx transaction, with bound values and rollback covering both sheets and FTS tables. Source bytes never depend on successful indexing. Native watcher/transaction tests are included in the normal test/lint gate.

## 2026-11-19 - Collect every Linux budget result after a worker budget failure

CI's first runtime budget still requires all preceding verification to succeed. Give that worker step an outcome ID, then run menu and typing when it actually executed (success or failure) and the workflow has not been cancelled. An explicit status function overrides GitHub's [default success precondition](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions#status-check-functions), which previously suppressed both measurements after the worker failure. Keep the three commands sequential, mandatory and unfiltered; every failed budget still fails the job. Cancelled/skipped prerequisites remain stopped. Pages publication, all four reference profiles, limits and retry policies are unchanged. Test the real conditions against outcome/host/cancellation combinations, including the default status precondition.

## 2026-11-19 - Keep native settings publication recoverable and refuse replacement races

Native Tidy settings use two fixed-path commands within the existing default Space. They accept exact proposal/snapshot byte arrays and expose no arbitrary filesystem path. Reading never creates a directory or file. Reject linked private directories, linked/non-file settings and read-only replacements; preserve undecodable bytes for the UI instead of lossy conversion. The TypeScript adapter validates IPC shapes and JSON interpretation while retaining the literal source, BOM and unknown numeric spelling.

A plain [Rust rename](https://doc.rust-lang.org/stable/std/fs/fn.rename.html) replaces an existing destination. Instead, reserve and sync a distinct proposal, verify hard-link publication works before detaching anything, then retain the actual previous inode under a reserved pending filename. Recheck those captured bytes against the opening snapshot and publish by creating a new canonical hard link, which refuses to replace a file that appeared during the handoff. Restore a raced previous file only if the canonical name remains absent; keep all versions otherwise. Serialize this process's readers/writers and retain previous/conflict copies rather than pruning user bytes.

This is a recoverable handoff, with a brief canonical-name gap for other processes. Completed handoffs archive the pending name as a previous copy. A missing canonical file with a pending copy reports the interruption and retained path; reads and writes leave it untouched for explicit recovery. Deliberately deleting a completed canonical settings file still honors absence. Native settings controls/on-save and real per-Space desktop wiring remain required integrations; the current IPC follows the existing default-Space root.

## 2026-11-19 - Format only a captured successful note save

Keep canonical note-save subscriptions separate from catalog/preference notifications. Publish the exact saved source, path and edit origin after refresh; failed writes and conflict copies cannot authorize formatting. Explicit Save stages the current supported note even when unchanged, using the same optimistic conflict protection as autosave. Initial load/import and recovery flushes do not request formatting. Observer failures cannot turn completed writes into unsaved drafts.

The browser's optional on-save flow waits for a matching worker lint report, then uses the existing guarded proposal/application path. Original input reaches disk before formatting; worker failure leaves it saved. Consume each intent once, require readable enabled settings and current source/path/rules/ownership, and discard stale intents. A save that precedes the initial settings read waits for the actual file; enabling the setting later does not revive saves made while it was disabled.

CodeMirror reports input, Tidy and history origins separately. Background saves from Tidy, Undo/Redo and recovery never trigger another automatic edit. One Undo therefore restores the original source and stays restored through autosave; another user edit may format again, and explicit Save intentionally requests formatting again. Native review/configuration IO and batch review remain separate required work. This unreleased integration does not waive worker, menu or strict next-frame publication gates.

## 2026-11-19 - Use the released parser fix for dense-list array movement

The measured worker bottleneck includes mdast-util-from-markdown 2.0.3 repeatedly inserting list-item events into a growing array. The standalone CPU profile identifies that parser work and allocation cost; a deterministic regression counts 5,040,000 shifted entries for 600 items. Upgrade the six locked parser dependency edges to the released 2.1.0 within their existing 2.x ranges. Its upstream [release notes](https://github.com/syntax-tree/mdast-util-from-markdown/releases/tag/2.1.0) describe batched list-item handling and compiler allocation improvements. Keep every other toolchain/dependency version unchanged and verify the scoped lockfile with frozen install and the published integrity.

Retain 2.0.3 only as an exact test-only alias for independent full-GFM tree/position comparisons. Compare 600 generated boundary/nesting/EOL cases in addition to the existing CommonMark/GFM parity suite. The unchanged GFM 4 extensions support both parser versions; a documented type bridge exists only at the legacy test oracle because 2.1 adds listener context fields. Product parser selection, normalized content proof and worker/application ownership guards are untouched. Count array movement rather than timing a flaky unit deadline. Browser worker acceptance, full source checks and publication gates remain required; CPU profiles do not establish the 150 ms budget.

## 2026-11-19 - Gate real Tidy worker round trips on every Linux profile

Keep Tidy acceptance in a separate fresh-browser process, inheriting Chromium, Firefox, WebKit and mobile from the existing reference configuration. Measure the real emitted module worker through request/reply for four documents with 50,000 body words, including the known slow dense list. Include worker construction/startup in the first flat-lint result; retain internal CPU time separately. Validate original-source/request binding, exact fixes and untouched open-sheet bytes before asserting each 150 ms budget. Store all measurements before final assertions, with no selected reruns or threshold relaxation. Require perf:tidy in verify, Linux CI and Pages publication alongside the original menu/typing gates.

## 2026-11-19 - Preserve Markdown BOMs and use a DOM-free worker decoder

The real byte-level Tidy test exposed generic text decoding stripping a Markdown BOM before the editor received source. Preserve that marker for Markdown reads, lists, saves and move comparisons; JSON callers retain their existing decoder behavior. A BOM-only external edit must conflict rather than be treated as an unchanged file. File export/trash continue to copy original bytes.

The bundled Markdown parser selected a browser entity decoder that initialized document.createElement, which cannot execute in a worker. A worker-only Vite resolver uses the dependency importer's native resolution to select the package's pure entity-table implementation. Main-bundle resolution is untouched. The actual-worker browser flows are the regression evidence; do not replace the parser with a DOM shim or relax semantic checks.

## 2026-11-19 - Keep Tidy review asynchronous and source-bound

Use a dedicated worker with one active computation and one replaceable pending snapshot. Superseded results cannot apply, and unavailable workers report an actionable error rather than parsing large documents on the main thread. Keep configuration/JSON token edits in the separate pure tidy/settings entry; preserve unknown numeric spelling and text instead of reserializing metadata. Main-thread identity checks compare captured configuration references outside the structured-cloned report. Recheck source, sheet path and write ownership at application time, then apply the verified original-span proposal as one isolated editor transaction.

CodeMirror normalizes line endings internally. A history state field retains raw CR/CRLF only when needed; inverted effects restore it with Undo/Redo, avoiding whole-document snapshots for ordinary LF keystrokes. Source review temporarily suppresses Live decorations and adds line tints; view changes do not reset history. Full persistent Live/Source/Read controls remain the later F-11 milestone. JSON settings dialogs retain their opening byte snapshot so background refresh cannot turn an old draft into an overwrite. Native review controls, automatic save/batch flows and the150ms worker gate remain required work.

## 2026-11-19 - Keep Tidy settings as explicit byte-checked file edits

Expose the persisted adapter separately through @slate/storage/browser-tidy so future review/settings code can load it on demand. Reading .slate/tidy.json never creates a file or normalizes user text. Keep exact UTF-8 source and bytes, including a BOM, and validate only for interpretation/explicit save. Saving the entered JSON avoids rounding unknown future numeric fields through JSON reserialization. Use the Space mutation queue and saveSnapshot original-byte comparison: retain external edits as canonical and the proposal as a conflict copy, including changes that only add/remove the BOM. Keep invalid text repairable; unsupported bytes or failed reads require a fresh readable snapshot before saving. On-save/automatic formatting must remain disabled if configuration is invalid or unavailable. Review UI integration remains separate.

## 2026-11-19 - Keep Tidy proposals source-bound and independently reviewable

The core exposes pure lint()/fix() with all23 Appendix-D rule IDs, original UTF-16 spans and one minimal final change. Selected IDs stay bound to their original report source; overlapping repairs remap offsets or fall back to independent guarded repairs. Apply-all proves disjoint/subsumed repairs atomically, while preserving individual diagnostics and selection. Structural ambiguities remain manual warnings rather than bypassing the mdast content guarantee. A false keepHardBreaks setting removes trailing-space markers by using equivalent backslashes; it never silently removes a semantic line break.

Use strict version1 configuration with on-save off by default, preserved unknown model fields and explicit rule overrides. Minimal limits fixes to whitespace; GitHub excludes Slate-specific YAML/table alignment; Slate enables Appendix-D conventions with bare URLs off. Actual file IO, worker/review UI, on-save and batch remain separate required integrations.

Choose the CommonMark parser only when raw source cannot contain a GFM construct, including decoded autolink candidates; otherwise use full GFM. Exact AST and position parity is covered by explicit and generated reference comparisons. Linear assembly applies validated original-offset edits without repeatedly copying the whole document, preserving same-position insertion order. The dense-list150ms target is still unmet and cannot be waived by faster plain-text results.
## 2026-11-19 - Publish measured block-menu anchors after CodeMirror writes

The menu can commit React state before paint without running React effects inside CodeMirror measurement. A synchronous callback in requestMeasure.write let flushSync run a pending editor reconfiguration while CodeMirror was still updating, causing a real Firefox offline-reopen crash. Queue that measured notification in a microtask and recheck the live editor/current query before delivery. Keep existing pre-input geometry reuse, keyboard priority and deadlines. Closing, replacing the query or destroying the editor cancels the stale notification; no extra animation frame is requested.

## 2026-11-19 - Bind folder observation to the open Space lifecycle

Lazy template, snippet and block libraries are refresh consumers, not owners of the file observer, polling timer or unload flush handlers. Keep those subscriptions stable for the workspace store and read current committed libraries from a layout-updated ref. Continue rejecting callbacks after cleanup and disconnecting a subscription that completes after its owner closes. The selected-folder regression delays observer completion through library loading, tracks active instances accurately, requires one observer for the open Space, and retains exact saved bytes, a 500 ms external-refresh check and reconnect behavior. An older observer disconnecting must not make a mock falsely report that every observer is disconnected.

## 2026-11-19 - Guard Tidy proposals with a separate content projection

Expose the pure formatting engine through @slate/core/tidy so later worker/review code can load it on demand. Compare mdast without positions and list spread, with whitespace collapsed only in text nodes. Keep node types, nesting, heading depths, list starts, task states, links, references, table alignment, literal code/HTML and all other values. Preserve the file BOM and exact wiki links/embeds (including aliases): mdast treats their paths as ordinary text, while significant spaces select different Slate files. YAML presentation may change only when typed values, ordered sequences and attached comments match; mapping order is presentational. Preserve original numeric scalar spellings as well, because JavaScript rounding can hide changed large integers or signed zero. Preserve invalid/unknown-tagged, non-string-keyed or anchor/alias-bearing metadata literally: numeric/complex keys can collide as JavaScript properties, reordering aliases can change binding, and resolving them can expand data. Every proposed original-offset edit group is snapshotted, validated and accepted atomically only after this comparison. A rejected group returns the original source. Rule generation, the large-document worker and explicit undoable review remain required F-60…F-64 work.

## 2026-11-19 - Slash queries take priority over implicit snippet activation

A Space-enabled trigger can otherwise match the suffix of /;trigger and replace only that suffix, leaving a stray slash. Preserve the shared block-query eligibility as the priority boundary: after the cheap cached suffix match, skip implicit Tab/Space expansion for an eligible slash query, including native Space input with no keydown. Space remains query text; Enter explicitly selects a grouped result. Ordinary triggers, protected syntax and a literal slash followed by whitespace keep their established behavior. Unit and actual-browser failing-before regressions cover this conflict.

## 2026-11-19 - Insert template choices into the current sheet

F-30 says Enter inserts a grouped result, so slash templates use the current sheet and its guarded replacement span. Prepare only the template body and ordinary note properties; omit filename/destination planning fields used by New from template. Keep that existing file-creation flow intact. Template variables, prompts and explicit clipboard input retain F-40 rendering; snippets retain F-50 tab stops. A prepared UTF-16 cursor maps through the literal fragment planner's BOM removal, line endings and blank separation, while ordinary custom files still default to their end. Reject out-of-range cursors. Editor insertion shares the existing immutable document/selection, composition, connection and editability guards and one history transaction. The browser menu subscribes to cached libraries; explicit choices revalidate files outside ordinary typing. Template fields load in a lazy native dialog, while snippets reuse the existing prompt and linked-field transaction. Gutter selections retain their original selection snapshot. Only successful insertions update ranking history; original Figma template and braces assets provide the family icons.

## 2026-11-19 - Inject assertion-read failures at the reader boundary

The macOS WebKit paste-regression trace contains three saved-sheet evaluations: the injected NotFoundError, the previous bytes and then the exact pasted bytes. The browser StorageManager override nevertheless reports one read, so its count is not a reliable measure of assertion attempts. Give the test helper an optional reader, defaulting to the unchanged real-file reader. The regression injects one genuine browser DOMException through that boundary, counts attempts in the runner, and then reads real files. Keep the existing5-second deadline, exact content, Saved status, one-failure count and reload assertions. Production paste and storage code are unchanged.

## 2026-11-19 - Cache custom block search and revalidate the chosen preview

Share the existing block ranking algorithm across built-in metadata and literal custom fragments. Refresh the Space directory on startup, focus, advisory Space-scoped broadcasts and the existing visible polling loop. No file reads happen while filtering or navigating menu results. A failed directory listing clears offered custom entries while reporting its error; individual unsupported files remain visible in management with original-byte downloads. Advisory messaging failures do not undo committed writes.

An explicit selection compares the rendered preview source with the current cache, then re-reads that file and checks current ownership and source again. Only then may the editor snapshot guard apply the fragment. This also rejects a cache refresh that happened before React committed a new preview. Settings edits retain their original byte snapshot and write through the same Space queue as notes, preserving external primaries and conflict copies. The browser surface exposes management through the slash preview, Editor settings and the shared command registry. Native management is not advertised before its native adapter is implemented.

## 2026-11-19 - Restore origin-global files after browser scope stories

F-50 macOS CI showed the global writer's ;scope configuration in a later temporary WebKit profile, where the table trigger was consequently absent. Treat temporary profile teardown as insufficient isolation for origin-global OPFS files. A story that changes global/snippets.json captures its exact original bytes, restores those bytes or the original absence in finally, and verifies the restored file within the existing 5-second assertion deadline. Keep Space files and sibling data intact. The production behavior for an explicitly configured global file remains valid; the regression belongs to test fixture cleanup. Preserve the original keyboard operations and all data/field assertions.

## 2026-11-19 - Capture custom-block editor requests before reading files

Custom fragments are loaded on explicit selection. Capture the immutable editor Text and EditorSelection with the eligible slash range or parsed gutter endpoint first. After the read, require the same document and selection, a connected editable view, current write access and no active composition. A stale request produces no edit. Apply the pure plan through one history-isolated transaction and return focus to the editor. Subsequent IME updates keep their own undo group.

Slash capture reuses the bounded query/context checks and excludes multiple carets. Gutter insertion uses the end of the parsed source block, which permits inserting after an entire code fence without changing the code. Metadata and out-of-range targets stay protected. Treat a note's sole leading BOM as a file marker when calculating blank separation; keep that BOM directly before its first inserted content, while removing only the fragment file's BOM.

## 2026-11-19 - Save custom block edits against exact byte snapshots

Custom fragments retain a UTF-8 BOM and line endings in their editable source. The existing note save path compares decoded strings, which cannot detect a BOM-only external change and conflicts with a BOM-preserving base string. Add saveSnapshot to the same serialized Space mutation queue: capture a defensive copy of the original bytes before waiting, check current ownership when the write executes, and compare the final disk bytes with the base and proposed bytes. A changed primary keeps its bytes and the proposal becomes a conflict copy, including when the primary was deleted or changed encoding. Existing note save behavior stays separate.

Block directory reads report per-file errors and retain original bytes; unsupported encodings and unavailable reads cannot be saved through the fragment editor. An oversized but valid UTF-8 file may be explicitly shortened against its snapshot. A failed directory listing remains an error, while a file that disappears during listing is omitted. New blocks use portable filenames and the existing numbered collision path. All reads and writes stay inside the canonical private block directory. Menu/editor integration follows these adapters.

## 2026-11-19 - Custom block files contain literal Markdown fragments

F-32 specifies .slate/blocks/*.md without a second metadata or variable language. Use the file stem as the name and its relative path to distinguish names in nested folders, consistent with Space template directory organization. Preserve its source as ordinary Markdown: YAML, template expressions and numbered snippet syntax remain literal. Templates and snippets retain their separate variable/field behavior. Bound each fragment to 1 MiB of UTF-8, counted without platform APIs. Reading and planning never write its file.

Insertion removes only the fragment's leading file BOM, converts its line endings to the note's first existing convention (LF for an empty note), and adds only missing blank-line separation around the replacement. Existing note bytes outside the requested span and trailing fragment line breaks remain intact. Return one change and a UTF-16 caret at the end of inserted content. Platform adapters must enforce code-context, ownership and stale-source checks. No custom blocks are advertised until directory reading, insertion and the actual menu are integrated and verified.

## 2026-11-19 - Integrate snippets through cached file scopes and guarded editor requests

F-50 browser integration keeps the global and Space files as the source of truth. A lazy library reads both scopes, resolves overrides/disabled entries and builds the bounded suffix index outside key handlers. Unchanged source snapshots retain the same index. Missing global configuration supplies three shipped defaults without writing a file; an explicit valid empty file clears them. Invalid or unavailable configuration disables expansion and exposes repair rather than silently replacing it. Focus, visible file polling and optional cross-tab messages refresh definitions; messaging failure must not block a successful file commit or loading.

Capture the document, selection, date, ID and contextual variables once at invocation. Prompt/clipboard forms render literal values and insert only against that captured document/selection; a stale request cannot overwrite newer writing. The picker and settings reuse WorkspaceDialog and design tokens, with original A4 search/file assets and A7 table geometry. Existing native commands do not advertise the unfinished native library.

Keep active completion menus ahead of field Tab navigation; a pending background completion lookup must not consume it. Field navigation creates an explicit history boundary even though it changes only selection. The shared composition observer recognizes this boundary before its document-change guard, preventing Firefox composition edits in separate fields from joining one undo group. This also retains the established atomic undo behavior for smart input and paste. A slash followed immediately by whitespace ends block search, so literal separators inside an expanded snippet cannot steal Tab; multiword queries beginning with a non-whitespace character remain valid.

## 2026-11-19 - Install Starter Kits as Separate Space Notebooks

F-45 specifies starter kits without a separate contents/design contract. Provide Work, Writing, Engineering and Personal setups: an overview, two notes rendered from the actual bundled Markdown templates, and two notebook defaults referring to those same built-ins. Users can customize a built-in through the existing Edit template/Save template copy flow. The kit picker previews its contents and accepts a portable top-level notebook name. Select a fresh root against current disk files, existing preference paths and pending kit preparations, including case variants. Existing notes, assets and configured defaults stay intact; adding another kit is a separate setup.

Preparation captures the invoking date, flushes drafts and validates settings before kit writes. Serialize preparations/installation through the workspace operation queue and reserve pending roots in memory. Track each completed write before notification or refresh so Retry in the active dialog skips completed files, preserving later external edits. Interrupted reserved files are retained and a retry creates a numbered copy. After notes are saved, re-read workspace preferences and add only missing defaults through the existing optimistic conflict-copy path. Retry after a preference failure does not duplicate notes. Closing after partial failure keeps files and releases the in-memory session; later installation creates another setup rather than promising persisted recovery metadata.

Open the actual overview at completion and retain committed rows if notification/refresh fails. The picker uses the existing WorkspaceDialog, tokens and native controls, with access from Sheet actions and the untouched new-template source view. Keep renderer/catalog/dialog code lazy. Browser integration passes the four-profile functional suite; native workspace template integration remains pending.

## 2026-11-18 - Carry Daily Tasks Once at Canonical Creation

F-43 captures the local invoking date and opens Daily/YYYY-MM-DD.md. Only first creation uses the built-in Daily note Markdown and the same pure template renderer/caret mapping as the gallery. Today is a dedicated daily command; New Sheet notebook defaults continue to apply only to New Sheet. Select the latest earlier valid canonical daily filename, including across missed days; do not aggregate all historical notes or re-append tasks when today already exists. Read the prior file after flushing drafts. A missing/unreadable prior file stops creation with a repair message rather than silently skipping its work.

Use the GFM AST to copy unfinished task lists, not checkbox-shaped text in code, HTML or protected complete/unfinished metadata. Keep rich task text, multiline context, nested pending tasks, quotes, link/image references and footnote definitions. Completed task siblings are omitted; a completed/non-task ancestor becomes plain list context when needed by unfinished descendants. Serialization may normalize the copied Markdown; the previous file stays byte-for-byte unchanged. Template-looking expressions in copied task values stay literal. Parsing/rendering loads only on first daily creation and does not run while typing.

Check the canonical path inside the existing owned mutation queue before writing, including empty files and undecodable bytes. Reopen existing files without decoding them for the existence check. Preserve the new row/caret after committed bytes even if subsequent notification/refresh fails. This shares the adapter's existing external read/write race limits; it does not claim an exclusive filesystem primitive against external writers. Native workspace integration remains separate pending work.

## 2026-11-18 - Render File Templates from Explicit Values and a YAML AST

F-40 uses pure core functions with caller-supplied clock/date/offset, title, IDs, selection, clipboard and prompt answers. Expand tokens once; never evaluate code or recursively expand user values. Keep unknown/malformed variables and filters verbatim with field/range diagnostics. Use Moment-style calendar/time tokens, bracketed literals, English names and ISO week-year boundaries. Retain non-Latin letters/marks in slugs while folding Latin accents. One prompt label shares its answer/default across content and routing fields.

Parse template YAML with the existing safe schema, validate mappings/aliases and remove only the top-level template key. Render decoded scalar values, keys and comments through the AST, then serialize and validate the final property map. This escapes quotes/newlines rather than injecting property text. Promote any configuration anchors referenced by sheet properties before removing configuration; keep normal shared/cyclic aliases. Preserve BOM, closing marker, line endings and exact body bytes. Drop an empty configuration-only header, retaining comment-only metadata. Invalid metadata produces no file plan.

Map caret markers through actual YAML serialization using a sentinel selected after all filters have rendered and checked against source/output values. Remove every sentinel and validate the resulting keys again, then choose the first printed marker. This prevents a transformed user value from colliding with the sentinel and catches duplicate/reserved keys formed after marker removal. Routing proposes portable relative Markdown paths, rejects private configuration/traversal and requires unresolved routing fields to be supplied or explicitly overridden. Actual collision-safe creation remains the storage adapter's job. The core format is independent of the pending gallery/file-creation UI.

## 2026-11-18 - Keep Gutter Controls Outside Markdown and Reuse the Catalog

Resolve top-level Markdown ranges only on explicit pointer/menu actions, cached by CodeMirror Text identity. Protect BOM and complete/unfinished YAML metadata. Move entire source payloads, including nested lists, fences and tables; adjust only joining whitespace and keep the change as one undo transaction. Refuse a bare divider move that would reinterpret the first line as unfinished YAML. The parser and move planner remain pure TypeScript in core.

CodeMirror owns the small plus/grip DOM outside contentDOM. Hover measures the visible row in requestMeasure; typing, scrolling and nonempty text selections hide stale controls without parsing or React updates. An empty-caret move retains the hover target so native pointer-down can start a drag. A same-view drag carries a random token and immutable source snapshot, with a guarded deferred drop. Blank-line drops use their actual document slot. A 44 px Block actions button offers touch and keyboard move/insert/select actions. While words are selected it leaves the Tab sequence to the existing selection toolbar.

Reuse the slash picker, preview, frecency and resource dialogs for a virtual zero-width insertion target. No slash is added to the file. Gutter insertions request separate-block boundaries even for inline entries, so a date cannot attach to a closing fence and headings cannot absorb adjacent paragraphs. Ordinary slash behavior and all Appendix B goldens retain their existing placement. Resource cancellation leaves original source untouched; stale source/ownership checks reject an edit and preserve any saved asset.

F-33 uses the existing tested selection formatter: paragraph, headings1–6, bullet/ordered/task lists, quote and code block. The grip selects the complete source block and exposes that same Turn selection into toolbar. Do not add a second conversion engine or promise semantic conversion between every Markdown AST node type. Block actions return focus to the editor after modal cleanup so the formatter remains reachable.

## 2026-11-18 - Guard Rapid Android Fence Completion Before Platform Deferral

CodeMirror defers Chrome/Android Enter before extension keymaps and can suppress its replay immediately after input. The macOS mobile CI trace leaves the typed opening fence with no picker. A capture-phase regression reproduces a platform listener consuming the key before the fence keymap. On Chrome/Android only, complete an eligible short fence/front-matter line before that deferral when the collapsed DOM selection, complete rendered line and source range agree. Pending DOM input, composition, modifiers, protected source and disabled preferences remain with the platform handler. Other platforms retain the normal keymap. Do not access private observer state or flush an IME session.

The settings browser fixture now replaces the document through CodeMirror Select All and keyboard input, rather than DOM fill over an inactive horizontal-rule widget. Await the rendered rule and exact replacement file before the next Enter. CI traces establish retained source on all three platforms, but the original fill failure has not reproduced locally. Keep that distinction and the unrelated Windows setup timeouts in PROGRESS.md.

## 2026-11-18 - Complete Fences and Keep Smart Edits Apart from New Compositions

F-24 handles an empty selection at the end of an opening fence or the first-line YAML boundary. It preserves the typed marker, whitespace, quote/list continuation and following source. Closed fences, code/HTML interiors, existing front matter, multiple selections and composition remain literal. Bare code fences open the existing language picker after completion; cancellation keeps the closed plain fence. Independent fence/front-matter preferences default on and reconfigure the current view.

Language selection replaces the still-current completed edit through a captured public undo transaction followed by the chosen edit, dispatched together as one update. Validate both the completed source/selection and restored original text before applying. Adapters see only the combined change; one undo restores the typed opening marker even after a long picker delay, and redo restores the chosen language. A no-history language amendment was rejected because it survives undo outside the inserted fence.

Firefox can deliver a subsequent new text insertion as input.type.compose without a start suffix. CodeMirror's history forcibly joins that label to the previous event, including an isolated smart edit. Track only whether the last document change was isolated or an undo/redo. Normalize the next continuation-labelled composition to input.type.compose.start through public transaction-filter specs; preserve the original transaction's changes, selection, effects and annotations. Later IME updates retain normal grouping. This adds constant state bookkeeping without document scans, private input-state mutation or React work on ordinary typing.

## 2026-11-18 - Snapshot Clipboard Requests and Preserve Saved Pixels

F-23 captures clipboard strings and File objects synchronously during the paste event. HTML conversion and image preparation load on demand. Each asynchronous request retains the immutable CodeMirror document and selection it started with; a changed document, caret, ownership, composition or image destination prevents insertion. Retry is explicit at the current caret, and each pending request has its own dismissible notice. Conversion failures with no images can fall back to the complete plain text; image failures retain the whole request so text and pixels are not separated accidentally. Ordinary typing performs no clipboard conversion, document scan or React notice update.

Saved image promises are cached by File and destination callback. Embedded resource promises are also cached by clipboard snapshot and source. A failed promise can retry; a successful copy is reused after a stale result. Undo removes the inserted Markdown and preserves saved files. A new clipboard event reserves a fresh numbered filename. The image importer saves beside the current sheet, returning a portable ./assets reference. The existing image picker also now writes beside nested sheets so its relative reference resolves.

PNG bytes pass through unchanged when their signature is present. Other image formats decode in the browser's image context and encode to PNG through canvas; copied HTML and SVG markup are never attached as live documents. Remote clipboard image URLs are not fetched by conversion. Browser writes use the existing ownership-controlled serial queue. Native IPC accepts binary bytes and reserves numbered files with create_new, then writes and syncs them; collisions, empty files and interrupted reserved copies are preserved. Native asset paths use a portable restricted grammar and reject symlink parents. This guards existing paths; it does not promise race-free traversal against an external process replacing parent directories during a write.

Four independent version-1 preferences default on for older settings: rich text, URL-over-selection, images and delimited tables. Reconfiguring them preserves the editor instance and undo history. Disable CodeMirror's upstream URL-paste handler so plain paste and the URL setting control all automatic wrapping; retain its www-to-https behavior and existing XMPP/mailto/HTTPS targets.

Opening-stage performance marks contain stage names and sequence numbers only. Offline tests attach them to locate the unexplained Windows second-reload stall without changing readiness deadlines, ownership semantics or the strict typing budget.

## 2026-11-18 - Bound Input Queries and Resolve Wiki Paths Explicitly

Inspect only a bounded suffix before invoking the Markdown syntax tree: 67 UTF-16 units for the existing 64-character slash query and 131 for wiki/tag queries. Verify the actual preceding character when a suffix begins midway through a line. Ordinary typing does not materialize the entire caret line. The shared syntax guard excludes code, links, URLs, HTML comments and front matter; wiki completion may inspect its own existing wiki token without treating nested links as eligible.

The pure wiki completion planner writes canonical paths with a readable alias so equal titles remain distinct. Use a stable ULID when a filename cannot be represented by the current wiki grammar. A reusable path index gives exact full filenames priority, including files differing only by extension case, and resolves shortened/case-insensitive aliases only when unique. These are provider/navigation foundations; the autocomplete UI and date picker are separate work and are not exposed yet.

## 2026-11-18 - Pair Selected Text at the Editor Input Boundary

Plan selection wrappers from immutable editor state, inserting delimiters around the original ranges rather than replacing selected words. Preserve reversed and multiple selections; choose longer backtick fences when content already contains code delimiters. Only typed delimiters with a nonempty selection enter this rule. Paste, composition, readonly states and an empty caret retain normal handling. A tilde or equals inserts its complete double marker; consume its second physical character before the browser changes the DOM, preserving a single undo step. Keep that pending character through unrelated configuration updates and clear it when the document or selection changes.

For a non-cancellable mobile input, reconcile the DOM to identical source in a transaction excluded from history; this follows CodeMirror's approach to skipping a previously inserted closing bracket. A regression verifies both selected words and single-step undo through that fallback.

Expose one independently disabled preference using the existing versioned schema and live CodeMirror compartment. Older preference records default the new field without affecting saved notes. Ordinary non-delimiter typing returns before document inspection. A large-selection regression rejects spreading every code span into a function call; scan the maximum delimiter width instead. Wiki/tag completion and the date picker remain later F-21 work.

## 2026-11-18 - Keep Smart Lists Structural and Undoable

Use CodeMirror's existing Markdown continuation/deletion commands with explicit isolated history. Disable the language extension's automatic keymap so disabled rules cannot run through a second handler. Resolve list ancestry through the Markdown syntax tree; indentation and movement operate on whole sibling items and their descendant blocks. Renumber direct ordered siblings while preserving the original first counter. When a counter crosses a digit boundary, adjust child-line indentation in the same transaction, including counters changed by the upstream Enter command. Do not intercept Tab at the first sibling or Shift-Tab at a root list, preserving keyboard focus escape.

Versioned editor preferences live in optional local storage, shared across Spaces on the current app origin; the pure core validates their schema. Unsupported or unavailable preferences fall back to enabled list rules and never block a document. An Editor settings command and dialog expose only the three implemented groups. A CodeMirror compartment applies changes without recreating a document or its undo history. Cross-tab storage events refresh the preferences; preference writes remain outside React state updaters. Full Settings/automation configuration remains the later F-94 scope.

## 2026-11-18 - Bridge the Slash Menu Without Delaying Ordinary Input

Keep query detection and editor transactions in CodeMirror; React owns the nonmodal list, safe GFM preview and resource dialogs. Only an eligible slash opens the menu. Capture its anchor before the native slash changes the DOM and publish after that transaction; use CodeMirror's normal measurement phase to reconcile wrapping/scrolling. Commit an open menu during the callback's frame with flushSync so React does not add another scheduled frame. Ordinary characters never read anchor geometry or publish menu state. Cancelled requests preserve the literal query; async insertions require the same source and an editable, connected editor. Optional local usage history is validated and affects ranking only. The exact `ta` alias keeps four-keystroke Table insertion stable under that history. Image bytes use the existing serialized, conflict-preserving import adapter; raw HTML and all preview links remain inert, including heading links that would otherwise change the app route.

Menu timing gets its own Playwright process and report directory under the existing Linux reference policy, retaining all four profiles, the strict <50 ms assertion and diagnostic results on other hosts. Its fixture starts with a real empty saved sheet and measures the actual slash input through the first visible frame, then verifies saved bytes. Template/Snippet groups, the gutter/grip, broader smart input and automatic TOC refresh remain later work; this menu does not advertise future libraries.

## 2026-11-18 - Plan Block Transactions in the Pure Core

Context: v0.4's slash menu, gutter insertion and later CLI/automation consumers need the same Markdown outputs. Resource picking and platform IO cannot enter packages/core.

Decision: Keep the built-in catalog and insertion planner pure. Return original-document TextChange coordinates plus a final UTF-16 selection, or a typed resource request before any edit. Footnote references/definitions share one planned transaction; front-matter is guarded at the document start; dates/times are explicit inputs. The editor adapter will commit a plan as one undo step after resolving any resource request.

Consequence: Golden fixtures cover all 28 entries, including five callout variants and the A2 Tag item. The plan's 3×3 table is interpreted as three columns and three rows including the header (two body rows). Existing source text and newline bytes stay outside the replaced query; inserted line endings follow the document. Menu UI, resource adapters and automatic TOC refresh remain separate v0.4 work, so this foundation does not advertise those features as shipped.

## 2026-11-18 - Bound Derived Summary Refreshes

Context: The full-document summary worker remains active on every edit even with one in-flight job. A two-CPU WebKit diagnostic sent 226 jobs during 225 inputs and recorded 1,567 ms of aggregate worker round-trip time. Summaries feed the list, statistics, tags and inspector; they are rebuildable projections of the immutable source buffers.

Decision: Coalesce pending snapshots into refresh windows at least 100 ms apart, then post after a frame. The first snapshot has no throttle delay. Continuous editing still publishes intermediate summaries; this is a bounded refresh cadence rather than a wait for typing to stop. Keep one pending latest snapshot and cancel all timers/frames before closing the worker client.

Consequence: Derived metadata can trail input by roughly 100 ms plus frame/worker time. List actions require the summary path set to match current source file identities; while paths differ, rows, selection and dragging are disabled and the list reports busy. Content-only edits do not block list actions. Editor transactions, live preview, synchronous recovery and file saves retain their existing paths. Unit clocks cover coalescing, continuous updates, final text and cancellation; browser checks cover real worker requests, a held-worker bulk move and exact saved words. The <16 ms typing gate and its workload remain unchanged.

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

## 2026-07-10 - Inject Autosave Writer Into UI

Context: The handoff requires autosave to persist editor changes, but importing the Node/Tauri storage adapter directly into the shared React app would break the web bundle.

Decision: Add a debounced `createAutosaveController` in `packages/ui` that accepts a `SheetAutosaveWriter` interface. `SlateApp` uses a browser draft writer by default and can receive a real storage-backed writer from native shells.

Consequence: The UI now schedules and flushes autosaves without coupling React to Node-only storage. Native desktop/mobile still need runtime wiring to pass the real adapter.

## 2026-07-10 - Use a Tauri Command for Desktop Autosave

Context: The shared UI autosave controller needed a real native writer, but the full Tauri SQL index adapter is still separate runtime work.

Decision: Add a desktop-only `write_sheet` Tauri command that writes Markdown under the app-data default Space through a tested Rust helper in `slate-core`. The helper performs root-safe path validation and conflict-copy preservation.

Consequence: Desktop autosave now writes conflict-safe `.md` files without pulling native APIs into the web/mobile bundles. The SQLite index adapter still needs native Tauri SQL wiring.

## 2026-07-10 - Bootstrap Native SQLite Through Tauri SQL

Context: The handoff calls for native SQLite via `tauri-plugin-sql`, while the existing Node adapter already owns the canonical index schema and FTS layout.

Decision: Install and initialize the official Tauri SQL plugin with SQLite enabled, grant `sql:default` to the main window, and add an `@slate/storage/tauri-sql` helper that opens `sqlite:slate-index.sqlite` and applies the shared schema.

Consequence: Native shells now have a verified SQLite entrypoint that matches the Node schema. Rebuild/search operations still need to be routed through this helper in a later slice.

## 2026-07-10 - Bootstrap Web SQLite Through wa-sqlite OPFS

Context: The handoff calls for a web runtime adapter using OPFS and wa-sqlite, but OPFS VFS access is worker-oriented and should not leak into UI components.

Decision: Add `@slate/storage/web-opfs` as a browser-only helper that loads the async wa-sqlite build, registers `OriginPrivateFileSystemVFS`, opens `slate/index.sqlite`, and applies the shared index schema. The helper is injectable for tests and has a close lifecycle.

Consequence: The web runtime now has a verified OPFS SQLite bootstrap path without importing Node storage code. Browser rebuild/search operations still need to consume this helper in a later slice.

## 2026-07-10 - Share Async SQLite Index Operations

Context: Native Tauri SQL and web wa-sqlite expose different JavaScript database APIs, but both need the same Slate index semantics.

Decision: Add a small generic async SQL executor contract and shared index operations for reading entries, FTS search, and transactional replace-all writes. The Tauri and web helpers adapt their native APIs to that contract.

Consequence: Native/web index behavior now shares one tested query layer. Runtime file scanning and Markdown parsing still need adapter-specific wiring before they reach full rebuild-from-disk parity.

## 2026-07-10 - Bridge Runtime File Sources to SQLite Indexes

Context: Native and web runtimes will discover Markdown files through different APIs, but parsing files into Slate index rows should remain identical.

Decision: Add `@slate/storage/runtime`, which accepts an abstract Markdown file source and a runtime SQLite index, parses Markdown through `@slate/core`, and rebuilds the SQL index with deterministic ordering.

Consequence: Concrete Tauri/web file source adapters can now plug into one shared rebuild path. The remaining work is implementing those file-source adapters against real native/web filesystem APIs.

## 2026-07-10 - Use Directory Handles for Web File Sources

Context: The web runtime needs a concrete way to feed user-selected Markdown folders into the shared SQLite rebuild path without Node or Tauri APIs.

Decision: Add `@slate/storage/web-file-source`, a small adapter over browser directory/file handles that recursively lists `.md` files, ignores `.slate`, and normalizes workspace-relative reads.

Consequence: The web path can now rebuild from a selected directory handle through the shared runtime adapter. Browser permission prompts and handle persistence remain app-integration work.

## 2026-07-10 - Use Tauri Commands for Native File Sources

Context: Native rebuilds need a concrete Markdown file scanner, but shared storage code should not import Tauri APIs directly unless the native shell opts in.

Decision: Add root-safe Rust helpers for listing and reading Markdown files under the default Space, expose them as `list_markdown_files` and `read_markdown_file` Tauri commands, and publish an injectable `@slate/storage/tauri-file-source` wrapper over `invoke`.

Consequence: Desktop rebuilds can now use the same `RuntimeMarkdownFileSource` contract as web directory handles. The app still needs a UI integration point to trigger full native rebuilds from this source.

## 2026-07-10 - Enforce Core Coverage in the Unit Gate

Context: The handoff requires `packages/core` at or above 90% line coverage, but the existing verify gate ran Vitest without coverage thresholds.

Decision: Run Vitest with V8 coverage in `pnpm test`, scope the enforced include set to `packages/core/src/**/*.ts`, and set global thresholds at 90% lines/statements/functions with a 75% branch floor.

Consequence: The Phase 1 core quality bar is now machine-enforced without forcing the scaffolded UI/storage packages to meet the final overall 75% threshold before their remaining behavior lands.

## 2026-07-10 - Inject Sheet Moves Behind a UI Adapter

Context: The three-pane UI needed drag/drop sheet moves, but the shared React package still runs in web, desktop, and mobile shells with different filesystem capabilities.

Decision: Add a `SheetMoveWriter` prop to `SlateApp`, have notebook drop targets call it with source/destination Markdown paths, and update the visible sheet notebook only after the move writer succeeds. The Node local storage adapter now rebuilds SQLite after `moveSheet` and refuses to overwrite an existing destination.

Consequence: The UI can prove the drag/drop workflow without importing Node or Tauri storage code, while disk-backed adapters preserve index freshness and avoid move-time data loss. Native/web shells still need to inject their concrete move writers.

## 2026-07-10 - Navigate Wiki Links From CodeMirror Clicks

Context: Wiki-link navigation needs to work inside the plain Markdown editor without converting the document into a block or rich-text model.

Decision: Add an editor hit-test helper for `[[target|display]]` ranges and handle Ctrl/Cmd-clicks through a CodeMirror DOM event extension. `SlateApp` resolves links by stable id first and by normalized title second, then selects the matching sheet.

Consequence: Wiki links are navigable while the Markdown source stays untouched. The first implementation is click-based; autocomplete and unresolved-link creation remain later Phase 5 polish.

## 2026-07-10 - Keep Editor Modes as Local UI State

Context: Focus, typewriter, and full-screen modes are writing-surface preferences, but the scaffold does not yet have persisted per-space settings.

Decision: Implement the modes as local `SlateApp` state toggled from icon toolbar buttons. CSS classes control the layout: focus mode hides navigation and dims inactive editor lines, typewriter mode changes editor vertical rhythm, and full-screen mode hides top chrome.

Consequence: The writing modes are usable and testable without inventing a settings store prematurely. Persisting these preferences can be layered onto per-space settings later.

## 2026-07-10 - Keep BYO-Folder Reconcile Decisions Pure

Context: BYO-folder sync must work across desktop, web directory handles, and mobile/native filesystem adapters without clobbering Dropbox/iCloud/Git edits.

Decision: Add `reconcileByoFolderFile` in `packages/sync` as a pure decision model over base, local, and external file contents. Runtime adapters can map its actions to disk writes, deletes, clean merged writes, or conflict-copy writes.

Consequence: The no-data-loss policy is testable without filesystem coupling, and platform adapters can share identical conflict semantics while still owning their IO details.

## 2026-07-10 - Put Export Behind Format Adapters

Context: PDF, DOCX, HTML, and ePub export will need different rendering libraries and platform packaging behavior, but the UI should call one stable export surface.

Decision: Add `@slate/export` with an `ExportAdapter` contract and registry. The first concrete adapter renders sanitized, themeable HTML; PDF/DOCX/ePub can attach to the same registry later.

Consequence: Export behavior is testable before heavier renderer dependencies arrive, and unsupported formats fail clearly instead of pretending to be implemented.

## 2026-07-10 - Put Publish Behind Provider Adapters

Context: WordPress, Ghost, static-site, and future publish targets need different credentials and HTTP APIs, but Slate should expose one publish action.

Decision: Add `@slate/publish` with a `PublishAdapter` contract and registry. The first concrete adapter is a deterministic static target that proves the contract without external network calls.

Consequence: Provider-specific integrations can be added behind a stable interface, and unsupported providers fail explicitly until real adapters are wired.

## 2026-07-10 - Keep Perf Budgets Deterministic in Verify

Context: The handoff requires cold/open/search/typing performance gates, but device-level cold start and full UI latency are noisy in a local agent loop.

Decision: Add `pnpm perf` as a deterministic Node script after the build step. It measures pure large-sheet parsing, typing HUD stat calculation, and SQLite FTS search over 10k synthetic rows.

Consequence: The verify gate now has a real performance tripwire without adding flaky browser timing assertions. Deeper device/browser telemetry can layer on top later.

## 2026-11-17 - Browser Spaces are files, with recoverable writes

Context: The redesign handover starts with a useful static web app. The baseline web shell edited only seeded data and could not reopen it.

Decision: Use a Zustand workspace store fed by shared `BrowserFiles` and `BrowserSpace` adapters. Folder Spaces use a selected directory handle retained in IndexedDB; library Spaces use `/spaces/<id>/` in OPFS. Sample sheets stay in memory until Keep. Serialize mutations, compare the last disk content before saves, create conflict copies on divergent edits, refuse move overwrites, and copy deletions to `.slate/trash/` before removing their source. A synchronous localStorage recovery journal holds only pending edits; successful writes clear it, and recovered divergent edits also become conflict copies. Web Locks and BroadcastChannel provide one write owner and a flush-before-takeover flow.

Consequence: Markdown files remain authoritative; a journal recovers interrupted writes without becoming the normal database. Archives include configuration, trash and binary assets byte-for-byte. Storage permission/quota failures keep drafts and surface a retry action.

## 2026-11-17 - FTS-enabled SQLite in a cooperative OPFS worker

Context: GitHub Pages cannot provide COOP/COEP headers. Real browser testing found that the baseline `wa-sqlite@1.0.0` WASM lacks FTS5 (`no such module: fts5`), which the shared schema requires.

Decision: Pin the PowerSync-maintained `@journeyapps/wa-sqlite@2.0.10` build, which includes FTS5, and use its `OPFSCoopSyncVFS` in a dedicated worker. Bundle the WASM URL locally, keep `/indexes/<space-id>.sqlite` separate from user files, and rebuild from Markdown. Adapt bound queries using prepared statements. The VFS uses access handles and Web Locks without SharedArrayBuffer. Source: [wa-sqlite VFS documentation](https://github.com/powersync-ja/wa-sqlite/blob/master/src/examples/README.md); upstream [FTS build discussion](https://github.com/rhashimoto/wa-sqlite/discussions/79).

Consequence: Chromium, Firefox and Linux WebKit tests exercise a real FTS index without cross-origin isolation. A cache failure leaves files editable and allows direct file search. Playwright 1.65.1 and isolated persistent WebKit profiles fix the old runtime's missing Storage API; Windows WebKit still has transient OPFS/cache errors. The complete WebKit storage gate passes on Linux and runs on Linux/macOS, with a documented Windows workaround in `PROGRESS.md`.

## 2026-11-17 - Relative app assets, hash routes and prompt updates

Decision: Assemble the static site at `/app/`, keep `/demo/` as a redirect to `../app/?sample=1`, and keep sheet deep links in the hash. Bundle the provided logo/icon assets, precache the shell/editor/WASM using Workbox, and activate updates only after an explicit Reload action flushes pending writes. CSP is a meta policy with same-origin connections only. Tag-triggered Pages builds run browser gates before deployment and a save/reopen smoke check afterward.

Visual reference: The live Figma tool returned `Unknown tool` in this session. The dated handover snapshots are the available implementation reference; live-Figma parity remains unverified. No handover plan was changed to match implementation.

## 2026-11-17 - Prioritize the landing page and GitHub publication

The user explicitly requested that the landing page become first priority and be pushed to GitHub ready for every release. This overrides the plan's original v0.6 timing for F-120. Implement L1/L2's paper/graphite layout and bundled typography now, retain the rule that marketing only shows implemented capabilities, and publish the landing and app in the same GitHub Pages artifact on each release. The rest of the handover remains active and keeps its dependency order.

## 2026-11-17 - Keep marketing assets small without remote dependencies

The production site inlines minified landing CSS, critical font bytes, shared SVG icons and the header lockup, and serves a responsive AVIF crop of the real app on mobile. Inlining removes connection overhead under the default mobile network simulation; redundant production font preloads are removed. The footer lockup loads lazily. The committed marketing fonts retain only Latin/punctuation and the weights used by the design; `scripts/subset-landing-fonts.py` reproduces them from the full editor fonts, which remain unchanged for user documents. Original SVGs and font files/licenses remain bundled. Every site build regenerates screenshots and checks both marketing and app budgets. Lighthouse audits the production artifact with default mobile throttling before publication; the 1.5-second budget remains unchanged.

## 2026-11-17 - Read current and waiting release notes separately

Current release notes use the precached `whats-new.json` with normal fetch cache mode so they remain available offline, including in Firefox (a reproduced `no-store` request fails offline there). A waiting update uses a query and `no-store` to read the incoming version without being served the active worker's older JSON. Opening notes is read-only; Reload remains an explicit action after the workspace flush. The About surface uses a native dialog for focus containment and restores focus to its invoker when closed.

The header/palette About action always reviews the running release. Only the waiting-update toast's What's new action reviews the incoming release. A Windows Firefox trace exposed the incorrect coupling: a waiting update switched ordinary About to a `no-store` request and broke it offline. The two dialog modes now remain independent; no additional cache mechanism is needed.

## 2026-11-17 - Preserve unsupported Markdown encodings

Browser Markdown editing accepts UTF-8. Replacement decoding could silently change legacy file bytes on save, so decoding is strict. Unsupported files stay visible but read-only; raw downloads and zip exports preserve them. A recovered pending draft is written into a separate UTF-8 conflict copy, preserving both the original bytes and the user's words.

## 2026-11-17 - Refresh recovery at write ownership, before enabling input

A read-only tab's recovery snapshot can become stale while another tab writes. Reproduced a lost-draft case after the writer disappears: the reader's old snapshot replaced the newer journal entry. On ownership gain, read the current journal synchronously, replace the stale snapshot and overlay the editor buffer before changing editability. An empty journal discards stale reader drafts after the previous writer saved. No journal or Markdown format changes are needed. Unit cases cover both paths; a browser fault-injection test revokes writes in the first tab, closes it and verifies the second tab persists the latest draft.

Read-only flush requests leave the writer's journal and files untouched. This also allows a read-only tab to switch Spaces or reload an update without attempting to save another tab's recovery snapshot.

## 2026-11-17 - Prioritize the editor and isolate CI browser cases

Start the rebuildable SQLite cache after the editor's first frame, rather than opening/writing an empty index during first-run file operations. Files and recovery writes keep priority; the worker still builds a real OPFS FTS cache and receives subsequent saved changes. An empty Space does not need a worker.

Once a user opens a Space, begin loading the workspace and editor modules alongside file/catalog reads. These remain lazy at initial onboarding, but returning writers no longer wait for three sequential module/file phases. First-create test helpers allow 15 seconds for cold storage setup; a separate <60-second first-saved-writing assertion and the unchanged <1-second offline paint budget measure the product requirements directly.

The browser gate uses one Playwright worker, following [Playwright's CI recommendation](https://playwright.dev/docs/ci#workers), after Windows traces showed cold profiles stalling while three unrelated contexts initialized storage/cache concurrently. Its <1 s offline paint budget is measured with dedicated browser resources; `--workers=3` remains available for parallel stress checks. All browser projects, assertions, budgets and the concurrent two-tab ownership test remain enabled. Lighthouse uses software headless rendering with the same default mobile simulation and retains raw traces.

## 2026-11-17 - Use a consistent Linux landing performance reference

CI run 44104295348 reproduces macOS-specific native parser/layout costs: 124.7 ms in one layout of 216 objects and 67.1 ms consuming the document response. Its observed LCP is 426 ms, but the host-relative mobile simulation reports 1549 ms and 539 ms blocking time, despite approximately 400 bytes of landing JavaScript. Software rendering improves the prior macOS result without making this shared runner a stable performance reference. This is a host limitation, not evidence of equivalent Safari timing.

Enforce the unchanged Lighthouse thresholds on the Linux CI reference and Linux Pages publication, following [Lighthouse's consistent-environment guidance](https://github.com/GoogleChrome/lighthouse/blob/main/docs/variability.md). Keep macOS Lighthouse as an explicit diagnostic and upload its failed report/trace. All native builds, unit checks, core budgets and browser engines still gate their respective platforms. The root `pnpm verify` remains unchanged; the documented macOS CI workaround separates the platform checks from the canonical landing performance measurement.

## 2026-11-17 - Share appearance tokens across browser and desktop

`@slate/tokens` exports the handover's named Light/Dark colors and theme resolution without DOM dependencies. The UI applies these variables before React paints, remembers Light/Dark/System as an optional local preference and follows system changes only in System mode. Appearance changes never write Markdown. A contrast check covers the text/surface pairs from §6.3; selected-row metadata uses the secondary text token because tertiary text on the accent-soft background fails AA.

Both shells bundle Geist, Geist Mono and Newsreader from the existing workspace font dependencies. Newsreader's true italic face is available for a user's own Markdown emphasis; UI typography stays upright. Removed duplicated normal fonts from the web public directory and made the marketing subset script read those same canonical dependency files. The supplied brand silhouette is reused as a currentColor React component so it remains legible in both themes. Live Figma access is still unavailable; the dated foundations/A1/A9/A11 snapshots remain the visual reference.

## 2026-11-17 - Resolve commands once for keyboard, palette and help

The browser regression reproduced CodeMirror's Android Enter deferral dropping modifiers before custom handlers, turning Mod Enter into a newline. A capture listener handles only registered, modified Enter formatting commands on Android; composing input, AltGr and plain Enter stay with CodeMirror. Real mobile Chromium and a focused adapter test cover this path.

The pure core registry declares implemented commands, contexts and OS/browser defaults. The editor handles formatting before workspace shortcuts; Mod K inserts a link only with an editor selection and otherwise opens the palette. Exact modifiers, physical key codes, composition checks and AltGr protection keep command handling separate from text input. Browser New sheet uses Alt N, preserving the browser's reserved Mod N.

Each Space may supply `.slate/keymap.json` with `{ "version": 1, "bindings": { "format.bold": "Mod+Shift+b", "sheet.new": null } }`. Null unbinds a command. A custom map is validated as a whole, allowing swaps; invalid JSON, unknown commands, conflicts or Ctrl+Alt+letter on Windows/Linux retain all defaults and surface the reason. The map loads on Space open and window focus. Palette, shortcut sheet, editor and tooltips use the resolved map, and reconfiguration preserves the document and undo history. The read-only shortcut sheet uses a native dialog for focus containment and restores the invoker on close. Formatting operations are isolated transactions so each action has one undo step.

## 2026-11-17 - Measure the selection toolbar without touching the document

The selection observer reads visible CodeMirror coordinates in its measurement phase and emits only changed geometry. Empty or read-only selections perform no layout reads. The toolbar uses the registered formatting actions and resolved shortcut labels, preserves editor selection on pointer activation, supports keyboard focus/arrow navigation and returns focus to the editor after applying an action. Placement clamps to the visual viewport, prefers above the selected lines, falls below when needed and hides if neither side fits. Resize/scroll measurements keep it clear of the selection on mobile as well. Escape dismisses it without altering words; formatting remains one isolated undo transaction.

## 2026-11-17 - Render Markdown from the editor's incremental syntax tree

F-10a uses Lezer's Markdown/GFM tree plus small highlight/wiki/tag extensions. Only visible ranges receive decorations; code, escaped syntax, images and frontmatter stay source text. Caret/selected lines reveal their source markers. Rendering and settings changes never dispatch document edits; task widgets dispatch one checked-state character as an isolated undo action. Reference URLs and wiki aliases retain their source targets. External links open only on a modified primary click and only for HTTP(S)/mailto; document HTML is never interpreted.

Missing wiki targets are created through the existing serialized, conflict-safe file adapter. Link navigation/creation is serialized too, preserving source bytes, resolving existing titles or stable IDs first and using portable filenames. A lazily loaded helper imports only the needed parser export, keeping the initial shell small. Rich widgets and view-mode UI remain in their planned later milestone.

macOS CI's shortcut labels use the same Option glyph as the running app. Safari's toolbar traversal test uses Option-Tab with the default macOS navigation setting, following [Apple's keyboard reference](https://support.apple.com/guide/safari/keyboard-shortcuts-and-gestures-cpsh003/mac); no keyboard checks are skipped. The shortcuts invoker receives explicit focus before its dialog opens so Safari restores focus consistently too.


## 2026-11-18 - File-backed workspace preferences and bounded sheet rendering (F-90–93)

Context: The redesigned sidebar and list need pinned files, collapsed notebooks and density settings that travel with a Space. Large lists must keep keyboard navigation usable without mounting every row.

Decision: Store versioned preferences in `.slate/view.json`, preserve unknown fields, serialize updates and use the same optimistic conflict-copy save path as notes. Invalid configuration leaves notes available and the original configuration untouched. Move operations update pinned paths after the file has moved safely. Render fixed-height rows with viewport overscan above 80 entries; Arrow Up/Down, Home and End reach unmounted rows. Bulk move/trash runs through existing safe file operations sequentially and retains unfinished selections after a failure.

Consequence: SQLite remains a rebuildable cache. Preference files are included in exports, and a damaged preference file cannot overwrite notes. Cursor positions use a separate external store so caret movement only updates the status bar. The shared titlebar explicitly disables native window controls in the browser. Future view modes, history and Tidy controls arrive with their working features in later milestones.


## 2026-11-18 - Keep large-document typing independent of summaries and recovery snapshot size

Context: Valid 50k-word typing missed the 16 ms p95 gate. Profiling identified whole-document statistics, preview scans, controlled-value echoes and repeated recovery serialization on the input thread.

Decision: Compute immutable sheet summaries and row previews in a worker. Transfer metadata and body offsets, retain source strings on the main thread, ignore stale generations and reuse unchanged summaries. Fall back to scheduled local computation if worker startup fails. Pass CodeMirror transaction changes to browser recovery: write an immutable base snapshot before an atomic journal entry containing small change batches. Compact after 128 batches, retain legacy full-snapshot reading/writing, and use a full snapshot if an incremental base cannot be allocated. Keep the new versioned journal in `slate.recovery-v2.*` so older open apps cannot clear it. Migrate the old key only after committing the new journal; preserve divergent older-app drafts as separate recovered files. Retry reads if a writer compacts between reading a journal and its base, and refuse unsupported formats without clearing them. Delete old bases only after committing the replacement journal. Source-file writes, conflict detection and synchronous per-edit recovery remain in place.

Consequence: A failed journal commit leaves the previous committed draft recoverable; a crash between a base write and journal commit can leave an unreferenced private snapshot, which is safer than removing referenced recovery data. Exact source preservation, old journals, CRLF input, concurrent changes, quota fallback, compaction failure and worker failure/stale replies have regression coverage. The typing gate uses at least 225 real inputs and verifies the actual saved file, with the original <16 ms limit unchanged.

Typing checks run in a separate Playwright process and report folder; CI and Pages publication still enforce the same <16 ms limit for their supported engines. Diagnostic timing data includes clock granularity, frame timestamps, visibility/focus and handler durations. The budget remains unresolved when a run reports exactly 16 ms or more; passing functional checks is not evidence that this timing requirement has passed.

## 2026-11-18 - Share command definitions with the desktop preview

The native preview now uses the same registry, OS-aware key matcher, formatting adapter and modal shortcut/palette component as the browser. A surface constraint keeps existing native focus/typewriter/full-screen and Space-switch commands out of the browser until their browser features ship. The preview exposes only commands it implements; the former no-op export/menu entries are removed. Native window chrome remains provided by the OS until the v0.9 desktop titlebar work.

The desktop palette and inspector start closed. Inspector uses Mod+Shift+I, leaving Mod+I for Italic, and becomes an overlay when the window is too narrow for four columns. A sheet's editor instance and undo history are keyed to that sheet. Desktop frontend E2E uses the actual compiled app with an explicit IPC fixture; it validates frontend dispatch and save arguments, while Rust tests cover conflict-safe disk writes. OS package validation and native folder/watch/move/trash wiring remain separate work.

## 2026-11-18 - Keep the shortcut migration notice optional and consistent

Retain the existing `slate.shortcuts.v2` seen marker rather than showing another browser migration message. Build default-shortcut labels from the shared registry and OS profile, including Command/Shift on macOS. The native preview uses the same notice once per origin, with a keyboard-accessible dismiss button. Failed preference reads or writes skip this optional notice; they cannot fail a workspace open or change file recovery. The wording explicitly describes defaults because a Space can customize its bindings.

## 2026-11-18 - Keep pixel comparisons on one reproducible browser reference

Visual regression uses a Linux x64 Playwright 1.65.1 Noble image pinned by digest, including when invoked from Windows. An ephemeral Linux project installs the exact test runner, reads the real built site and mounts only expected PNGs and test reports writable. Host dependencies are not reused across operating systems. Time, locale, fonts, storage estimate and fixtures are controlled; file persistence and app rendering remain real. CI and Pages compare eight Light/Dark snapshots at the original 0.2% limit, and CI cannot update expected images.

The baseline review compares the implemented A1/A5/A11 structure to the supplied Figma snapshots; it does not claim raster equality with future-feature mockups. The shortcut sheet now places search in its header and uses A5's 720 px desktop frame, with a stacked header and scrollable body on small screens. Properties/rich widgets, starter kits and rebinding retain their planned later releases. Pixel regression is separate from the engine-wide functional, accessibility and typing gates.

Live Figma access was restored on 18 November. High-fidelity A1/A5/A11 contexts confirm the main layout metrics. The A5 modal (13:1882) now uses its exact heading/keycap sizes, 40 px column gap, spacing and token surfaces; icons reuse the plan's mapped 16 px/1.75 Lucide library. An explicit coarse-pointer header selector fixes the desktop selector overriding 44 px modal close targets. Both mobile close buttons have browser geometry assertions; the two intentional A5 baseline changes were reviewed and the full eight-image comparison passes.

## 2026-11-18 - Attach explicitly unsigned desktop previews from v0.3

Build a separate Tauri preview flavor with identifier `com.slate.workspace.preview`, per-user Windows installation, no updater artifacts and signing disabled. Keep ordinary verification builds unpackaged. Release packages are NSIS x64, AppImage x64 built on Ubuntu 22.04 (the glibc compatibility floor), and a permissions-preserving macOS ZIP whose binary must contain both Intel and Apple Silicon architectures. Each asset carries an exact version, source commit, byte count and SHA-256. A reusable workflow builds all three from one resolved commit; Pages waits for them from v0.3, and publication verifies every asset before uploading to a draft release and making it public.

The landing replaces its secondary source link with an explicitly labelled Desktop preview link to that exact release from v0.3. The browser remains primary. Preview documentation states the current seeded native shell/reopen limits; native file-workspace completion and signed distribution retain the v0.9 milestone. A separate application identifier keeps preview app data apart from stable installations. Failed packaging or checksum validation cannot silently publish a partial desktop release.

## 2026-11-18 - Declare the Linux runner as the typing-performance reference

The handover requires p95 < 16 ms on 50k words using Playwright and marks, but does not specify benchmark hardware. Use the Linux CI runner as the declared reference for all four browser profiles, with the same strict threshold, real input, byte checks and recovery enabled. Pages continues its strict Linux publication check. This is a fixed platform choice, not conditional exclusion based on a run's results. Windows/macOS retain required native builds and all supported functional checks, run the same timing assertions as diagnostics, and upload failed timing evidence. Root `pnpm verify` remains strict.

Evidence: Linux CI 44178565874 and 44190380062 passed every typing profile. In 44181834323 macOS Chromium's 50k p95 was 88.5 ms against 110.1 ms for a short note, WebKit 40/47 ms and mobile 100.4/112.7 ms. This demonstrates host-dependent latency even in the control; it does not identify its exact cause or establish macOS budget compliance. No engine or input workload is removed from the required Linux measurement, and the reference still fails at 16 ms. Reports retain non-reference failures for investigation rather than claiming the app is equally fast on every host.

## 2026-11-18 - Keep optional view persistence from forcing layout during input

Persist the caret immediately with the last observed scroll offset when CodeMirror reports a document or selection change. Reading `scrollDOM.scrollTop` after its DOM update can force synchronous layout inside input handling. Refresh the offset on scroll, and read the actual value on pagehide/teardown so a pending scroll event cannot lose the latest position. Source-file autosave and synchronous per-edit recovery are unchanged. A regression proves no scroll-layout read occurs between the edit callback and optional preference write, while checking changed scroll offsets and the saved caret; the existing pagehide regression checks a scroll whose event has not fired yet.

## 2026-11-18 - Reuse Rust dependencies and supersede old branch verification

Cache third-party Cargo dependencies for both standalone workspaces after selecting the Rust toolchain. Keep the action's default exclusion of workspace crates so Slate source and embedded frontend assets rebuild; every test/build/gate command still runs. Save dependency caches even when a later JavaScript or timing check fails, rather than recompiling unchanged dependencies on every attempt. Keys retain the Rust host/toolchain, environment and manifest/lockfile inputs.

Group CI by workflow and Git ref, allowing a newer branch/PR run to cancel its superseded run. Tag verification does not cancel an existing run. Release publication keeps its own required checks and is unaffected by these caches or branch concurrency.

## 2026-11-18 - Bound derived-summary worker requests to current work

Allow one in-flight summary request and keep only the latest pending immutable snapshot. When a reply arrives, publish it only if it matches the latest requested generation; otherwise send the latest snapshot and skip intermediate work. Ignore duplicate replies, preserve cached-document reuse, and fall back to the newest source if the worker errors or posting fails. Closing cancels pending work and late publication. This removes a worker backlog and unnecessary full-document transfers; it does not defer source-file saves or synchronous recovery, and does not change the typing gate or claim a measured latency improvement before verification.


## 2026-11-18 - Resolve canonical wiki paths without rewriting files

Wiki completions use a canonical Space-relative Markdown path and a display title, so equal titles in separate notebooks remain distinguishable. Resolve explicit paths before legacy titles, retaining exact filename case and rejecting ambiguous shortened or case-folded paths. Link identity and completion metadata contain only id, path and title and remain stable across body-only summary updates. Reconfigure the live editor's path index without a source edit or undo entry. Explicit paths can open an existing unsupported-encoding file through its download-original screen; no decoding, replacement file or byte rewrite is needed. Legacy title/id lookup remains unchanged for readable notes.


## 2026-11-18 - Keep recovery rows in the file list's stable order

Recovery creates virtual draft paths before their first disk write. Sort the overlaid paths with the same ordinal string ordering as the file adapter, before exposing them to summary workers or navigation. Otherwise, saving an appended recovered draft moves its row above the original between pointer-down and pointer-up; a real click can select the neighboring note. Sorting changes only derived list order and preserves source bytes, conflict handling and both recovery journals. The regression checks identical path order before and after saving two divergent drafts.


## 2026-11-18 - Use CodeMirror completion with current metadata identities

Use the existing CodeMirror autocomplete package directly (pinned 6.20.3) for keyboard, pointer, viewport and listbox behavior. Supply a bounded Markdown-aware source and precomputed title/path/tag metadata; ordinary typing never scans a full line or every sheet. Wiki paths disambiguate identical titles, and tags follow Slate's existing ASCII nested-tag grammar. Search matches titles or paths with accent-insensitive prefix/substring ranking. Render labels as plain text, style the tooltip with Slate tokens, and retain ordinary list Tab/Enter behavior when completion is inactive.

Each accepted option revalidates the current query, read-only/composition state and semantic target identity before one isolated transaction. A metadata refresh can add a newly typed tag while a pointer click is pending; compare semantic identities rather than object references so an unchanged target still works. Removed, renamed or no-longer-matching suggestions remain inert. Existing wiki closers are consumed instead of duplicated. Wiki and tag preferences are independent, default on for older version-1 preferences, and never modify note contents or reset editor history when changed. Date completion remains a separate pending rule.


## 2026-11-18 - Insert dates as calendar text with a captured source

Typing @ in an eligible Markdown context offers a calendar picker. Opening or cancelling it does not change source or undo history. Default to the local device date, or retain a complete typed ISO date. Validate the Gregorian year/month/day directly, including century leap-year rules, so no timezone conversion or JavaScript rollover changes the chosen date. Insert plain YYYY-MM-DD text in one isolated transaction and restore the original query and caret on undo.

Capture CodeMirror's immutable Text object when the picker opens; refuse insertion after source, selection, write ownership, composition or view lifetime changes. The external-edit browser regression writes a newer real file while the dialog is open, refreshes the editor, and verifies the picker cannot overwrite it and reopening preserves its exact bytes. Reuse WorkspaceDialog for focus trapping and restoration, with date-specific token styles independent of browser-only button styles. Date completion is an independent version-1 preference and defaults on for older settings.


## 2026-11-18 - Refresh an invalid file snapshot once

The [File System standard](https://fs.spec.whatwg.org/#api-filesystemfilehandle-getfile) says a File object may become unreadable after its underlying file changes; the [File API](https://w3c.github.io/FileAPI/#NotReadableError) associates NotReadableError with snapshot or lock failures. Source 2cca862's macOS completion case failed in a direct file read while saving; this is consistent with that class of failure but does not establish its exact filesystem cause.

Read through a fresh File object once more after NotReadableError, both in the directory adapter's byte read and the E2E source-byte helper. Keep a maximum of two snapshots without delays. Propagate a repeated failure and other errors, including denied permission; retain existing missing-file behavior. Do not retry writes, alter source, return empty bytes on errors, increase assertion limits or rerun timing tests for a pass. Adapter and browser fault tests prove exact current bytes, the bounded count and error propagation, and fail without the fresh read.


## 2026-11-18 - Keep table planning pure and retain every source cell

Represent table cells as raw inline Markdown in packages/core, with separate parser-supplied list/quote prefixes and UTF-16 ranges for editor selections. Follow the [GFM table rules](https://github.github.io/gfm/#tables-extension-): header/delimiter counts match, escaped pipes stay within cells, and ragged body rows are valid. Preserve excess body cells that GFM would omit in rendered output; never truncate them during padding or column edits. Normalize only ASCII boundary padding, keeping nonbreaking spaces, Unicode, escapes and code text intact.

Canonical output uses at least three delimiter hyphens with alignment colons, remains idempotent and provides empty-cell caret positions after the opening space. Reject invalid shapes, multiline cells/prefixes and unescaped pipes in manually constructed cell models. Column operations copy their inputs, validate indexes, and refuse deleting the sole column; the editor will expose availability and one-step undo when integrated. This foundation adds no automatic editor formatting yet.


## 2026-11-18 — F-22 editor table transactions and blur formatting

Use the complete GFM Table syntax tree only for explicit structural keys, palette actions and blur. Physical line prefixes come from parser row offsets, so quote/list containers survive canonical padding. Cell row/column/UTF-16 offsets preserve caret/selection through formatting. Tab skips delimiters, appends a body row at the end, and Shift-Tab at the first cell reaches normal focus behavior; Enter inserts a complete row without splitting inline text. Each source edit is one isolated history transaction. Explicit column deletion is unavailable for the sole column. Palette actions remain available when optional smart input is disabled.

A StateField composes position-only change descriptions for user input/deletion. Blur visits edited ranges, formats changed tables together and clears its work; initial/external documents remain untouched. Ordinary typing does not scan lines/tables. Structural table edits map pending work rather than losing another table's changes. Blur is deferred and cancelled on focus return/destruction; dialog, completion and selection-toolbar focus protects asynchronous picker snapshots. Wiki acceptance uses bare canonical links inside GFM tables because raw alias pipes are structural. Block-level slash suggestions stay out of cells. Independent version-1 smartTables preferences reconfigure the existing view and retain undo.


## 2026-11-18 — F-23 delimited clipboard data stays literal inside Markdown tables

Keep CSV/TSV parsing and Markdown serialization in the pure TypeScript core. Quoted delimiters, doubled quotes and embedded record separators follow the [RFC 4180 field model](https://www.rfc-editor.org/rfc/rfc4180.txt); also accept LF and CR records and Excel-style quoted TSV. Preserve field characters and source row order. Malformed quoting leaves the input available for literal paste. An explicit delimiter accepts ragged rows and pads every row to the widest field count, avoiding hidden GFM excess cells. Inference requires at least two fields per record; ragged multi-column rows are padded without dropping data. TSV can contain one row, while comma inference requires multiple rows so a single comma sentence remains text.

CSV cells are plain data. Escape CommonMark ASCII punctuation so Markdown, HTML-looking strings and entities remain literal; represent boundary spaces and tabs with numeric entities and embedded line breaks with generated `<br>`. This preserves values through the [GFM table model](https://github.github.io/gfm/#tables-extension-) and reuses F-22 canonical padding. NUL-containing input remains literal because Markdown replaces that character. Conversion is a paste-only operation; it does not inspect ordinary typing. The editor adapter, HTML converter, URL wrapping, image persistence and plain-paste shortcut remain separate integration work.


## 2026-11-18 — Open block menus own keyboard events before platform text input

CodeMirror's Android input adapter can defer Enter ahead of extension handlers and omit its replay when a recent mutation is followed by no DOM input. Highest keymap precedence does not cross that boundary. The block-menu controller therefore installs a capture-phase listener while its view is alive and handles only an active query's accepted menu keys, retaining composition/default-prevention guards and removing the listener on destruction. A bounded DOM query/caret check prevents capture from preempting pending native mutations; the existing extension handler remains the post-flush fallback. Ordinary document input continues through CodeMirror. A wall-time-controlled mobile regression reproduces the dropped key without private CodeMirror APIs or delayed/retried assertions; normal Enter, exact source and one undo remain covered across profiles.


## 2026-11-18 — Keep rich clipboard conversion behind a lazy editor boundary

F-23 HTML conversion belongs to the DOM-aware editor package; the pure core retains CSV/TSV parsing and table serialization. `convertClipboardHtml` dynamically imports pinned Turndown7.2.5 and GFM1.0.2. Parse clipboard fragments in a disconnected template, remove active document resources, rebuild word-processor inline formatting into a disconnected fragment, merge adjacent wrappers during append, resolve list metadata, and override GFM table handling so TD-only spreadsheets and spans retain their data. Rich conversion escapes literal HTML/entities/GFM markers, preserves inline-code contents and formatting, titles and safe relative/HTTP(S)/mail links, and emits canonical table source with the existing table domain helper. The converter does not fetch images or persist clipboard files. Native event snapshots, async source guards and image storage remain adapter work; current source does not activate smart paste.

References: [Turndown](https://github.com/mixmark-io/turndown), [GFM plugin](https://github.com/mixmark-io/turndown-plugin-gfm), [GFM tables](https://github.github.io/gfm/#tables-extension-), [CommonMark destinations and titles](https://spec.commonmark.org/0.31.2/#links).


## 2026-11-18 — Publication enforces every Linux reference browser profile

The Pages publication workflow must run the same unfiltered functional, block-menu and typing commands as reference Linux CI. Filtering to desktop Chrome/Firefox/WebKit omitted the mobile profile even though the shared configs include it. Remove those filters before artifact upload/deployment; keep strict budgets, failure propagation and fresh-process timing unchanged. Node invariants check the four-profile config inheritance, required unfiltered commands and publication ordering. This tightens publication acceptance without changing the user's strict next-frame typing definition; v0.3 remains unpublished.


## 2026-11-18 — Number clipboard assets within the serialized Space writer

Add importNumberedFile to the BrowserSpace mutation boundary. Validate its relative path and snapshot bytes when called; under the same write-ownership/serialization queue, choose the first free stem-N.extension and preserve known existing, empty and interrupted files. A failed read is not evidence that a filename is free. This provides F-23's numbered asset naming without weakening the existing import conflict behavior. The image adapter will keep PNG bytes intact, convert other image formats through an image/canvas context, and store assets beside their note for portable relative links.

References: [Canvas PNG output](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob), [SVG image-context restrictions](https://developer.mozilla.org/en-US/docs/Web/SVG/Guides/SVG_as_an_image). Browser codec and resource isolation still require runtime checks before the full paste feature is complete.


## 2026-11-18 — F-41 gallery uses Markdown files and the existing Space mutation queue

Keep the twelve bundled templates as actual Markdown assets and load the gallery lazily. Space template enumeration and editing belong to packages/storage; report malformed files independently and preserve original bytes until an explicit valid edit. Reuse the same optimistic-concurrency and numbered-create queue as ordinary notes. A built-in edit creates a private Space copy rather than mutating bundled content. The storage adapter is exported through the existing browser-space entrypoint so every frontend keeps its established bundler aliases.

Capture local date/time, selection, Space and a ULID once when opening the gallery, then supply this context to the pure renderer. Clipboard access follows an explicit button and always has a manual fallback. Use the renderer's proposed relative route only after validation. Flush the previous draft, commit the new file, register the actual path and initial caret in workspace state, then refresh. Fallible work after commit must not report creation as failed. Consume the initial caret after the native dialog closes and the editor can receive focus; normal reopening uses existing view preferences. Preview and rendering share YAML configuration stripping, including aliases and comments, without expanding variables in the preview.

Use the original A3 icon assets at their native 16px geometry, existing color/font tokens, and the shared dialog. Category counts come from available templates instead of the 34-item prototype. Expose the web command only while the native preview shell lacks real template persistence; native integration, defaults and daily carry-over remain explicit follow-up work under the full handover goal.


## 2026-11-18 — F-42 defaults identify a template and keep creation explicit

Store exact notebook-to-template references in the optional version-1 notebookTemplates preference map. Preserve unknown IDs and unrelated fields; own-property lookup and computed-property writes support notebook names such as __proto__ without inheriting object prototypes. Updates reuse optimistic preference writes and keep conflicts as separate files. Read current disk preferences before creating a new sheet rather than relying on a startup snapshot.

When a notebook has a default, New Sheet opens the existing gallery with that template selected and the invoking notebook as its initial destination. This retains prompts, explicit clipboard input, route validation, collision handling and cancellation. The explicit library action retains the template's own destination. No default inherits into child notebooks. Missing/broken defaults remain visible instead of silently generating blank notes. Ordinary notebooks keep the existing blank-sheet behavior.

Keep portable path validation in a renderer-independent core module, with the existing public export retained. Preferences must not pull template rendering into the app's eager bundle: the initial implementation's112,631-byte shell returns to92,781 bytes after this separation. The settings dialog is lazy and uses the existing shared dialog and tokens; per-notebook context actions add no permanent tree chrome.


## 2026-11-19 — Parse snippet fields before interpolating values

Keep numbered snippet syntax and trigger resolution in the pure TypeScript core. Parse defaults into a bounded acyclic definition graph before rendering; forward references and linked occurrences reuse the same default. Render F-40 variables only after parsing so clipboard, prompt and selected text cannot introduce tab stops. Record UTF-16 ranges plus parent occurrence IDs for the editor to remove only descendants of replaced nested fields. Preserve literal braces and Markdown escapes, normalize editor line endings, and reject malformed or amplifying definitions before insertion. Global and Space configuration remain versioned JSON; unknown metadata survives and a disabled Space definition suppresses the matching global trigger. On Tab or Space, resolve a bounded suffix through a prebuilt index; one longest textual match owns key and Unicode boundary acceptance. File persistence, guarded CodeMirror insertion and UI remain separate adapters.


## 2026-11-19 — Keep nested snippet navigation on public editor state

The pinned CodeMirror snippet parser cannot retain later peers after an outer nested default is replaced and misparses literal JSON braces within defaults. Use its public snippet() insertion and indentation API with escaped literal braces, then track the pure renderer's numbered ranges and occurrence ancestry in an editor-owned StateField. Replacing an outer field removes its deleted descendants, while later peers and ancestors map through the same changes. Tab/Shift-Tab follow numeric order with zero last; Escape, outside selection, undo/redo and read-only/disabled state clear the session. Configure linked selections in a non-document transaction before the atomic insertion, dispatching an ordered transaction array; passing multiple Transaction objects as variadic specs merges them under the old configuration. One undo restores the original source and selection. A request captures public Text and EditorSelection snapshots so async prompts cannot replace later writing. This editor adapter remains inactive until the file-backed snippet UI and trigger integration are completed.


## 2026-11-19 — Snippet configurations remain exact files at each scope

Keep Space snippets at .slate/snippets.json and browser-global definitions at global/snippets.json beside the OPFS Spaces directory. The browser catalog opens the origin root without creating a global folder; explicit save creates it through the existing file adapter. Parse only versioned, bounded JSON and preserve the exact source, original bytes and unknown metadata in a read snapshot. Malformed JSON with valid UTF-8 may be repaired against its exact source; unsupported encodings and unavailable reads remain blocked from edits. Save through the same optimistic-conflict mechanism as notes, never treating a changed or newly empty file as missing. A global store requires a shared write lock; the browser adapter obtains the same Web Lock for every Space/tab before the final optimistic read/write. Without Web Locks, global definitions remain readable and editing reports its limitation. Keep the global opener's factory dependencies lazy so ordinary catalog access does not reorder or grow the eager app graph. The pure core does not import browser APIs. The UI must distinguish missing definitions from invalid or unavailable configurations rather than silently falling back after an error.
