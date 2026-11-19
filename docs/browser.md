# Slate in the browser

Open the app at `/slate/app/` on GitHub Pages. It runs locally and works offline after its service worker has cached the first visit. No account or server is needed. The old `/demo/` link opens a temporary Sample Space.

| Capability | Chromium | Firefox / Safari |
| --- | --- | --- |
| Edit a selected folder in place | Yes, with permission | Use local import/export |
| Private browser library | OPFS | OPFS in supported modern browsers |
| Offline writing | After first visit | After first visit |
| Install as an app | Where the browser offers installation | Browser-dependent |
| Open Markdown from the OS | Installed app file handler | Import files |
| Import folders/files/zip; export a Space as zip | Yes | Yes |
| CLI, local MCP and global keyboard capture | Desktop releases | Desktop releases |

Folder handles are remembered in IndexedDB. On the next visit, choose **Reconnect** to grant access again. Browser libraries contain ordinary Markdown and asset files inside the browser's private file system. Choose **Export .zip** regularly to keep a portable backup. Export includes `.slate/` configuration and trash. Removing site data removes private browser files; it does not remove files in a selected folder.

Only one tab can write a Space. Other tabs show **Use here**, which asks the current tab to finish saving and release ownership. Changes are broadcast to other tabs. External folder changes use native observation where available, with visible-window scanning as a fallback. Conflicting edits become separate files. A failed write keeps the unsaved draft and offers Retry saving.

Markdown editing uses UTF-8. Files with other encodings remain read-only, with **Download original** and Space export preserving their bytes. Convert a copy to UTF-8 outside Slate and import that copy to edit it.

Use **Alt N** for a new sheet, **Ctrl/Command K** for the palette, **Ctrl/Command P** for Quick open, **Ctrl/Command B/I** for bold/italic, **Ctrl/Command Shift F** for search, and **Ctrl/Command Shift I** for the inspector. With selected text, **Ctrl/Command K** inserts a link. Browser-reserved new-window shortcuts keep their browser meaning.

In the palette, type `>` for commands, `#` for tags, `@` for headings, `/` for blocks and templates, or `;` for snippets. Quick open starts with sheets. Duplicate titles show their file paths. Arrow keys choose a result, Enter runs it, Tab previews it, and Escape closes the palette. File and heading choices read the current file; a stale heading is rejected without replacing your words. Block and snippet choices use the editor selection captured when the palette opened.

Typing and block insertion preserve a UTF-8 BOM and existing line endings. Undo restores the original text.

The New sheet, Today and Capture app shortcuts request confirmation before creating or appending files. Opening Markdown through the installed-app file handler also asks before importing, preserving existing files.

Updates show a **Reload** action. Slate flushes pending edits before activating the new worker. Updates do not rewrite existing Markdown files.

Choose **About Slate** in the header or command palette to read the release notes and browser capability matrix. These notes work offline after the first visit. A waiting update also offers **What's new**, which shows the incoming release before you choose Reload.

## Verification

`pnpm build:site` assembles the site with relative assets and checks the manifest, CSP, redirect and initial JavaScript budget. `pnpm e2e` serves it under `/slate/` and exercises Chromium, Firefox, WebKit and mobile Chromium.

`pnpm perf:typing` runs the strict 50k-word typing budget in fresh browser processes and checks the saved Markdown. On Windows, use `pnpm perf:typing --project=chromium --project=firefox --project=mobile`; WebKit runs on Linux/macOS. The timing limit is unchanged across engines.

Playwright 1.65.1 fixes the older WebKit runtime's missing Storage API. Storage tests use an isolated persistent WebKit profile because ephemeral WebKit contexts do not support OPFS. Windows WebKit still returns transient OPFS/cache errors; its complete storage suite passes on Linux and runs on Linux/macOS in CI. On Windows, the supported-engine command is `pnpm e2e --project=chromium --project=firefox --project=mobile`.
