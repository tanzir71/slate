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

Only one tab can write a Space. Other tabs show **Use here**, which asks the current tab to finish saving and release ownership. Changes are broadcast to other tabs. External folder changes are also scanned while the app is visible. Conflicting edits become separate files. A failed write keeps the unsaved draft and offers Retry saving.

Use **Alt N** for a new sheet, **Ctrl/Command K** for commands, **Ctrl/Command B/I** for bold/italic, **Ctrl/Command Shift F** for search, and **Ctrl/Command Shift I** for the inspector. Browser-reserved new-window shortcuts keep their browser meaning.

The New sheet, Today and Capture app shortcuts request confirmation before creating or appending files. Opening Markdown through the installed-app file handler also asks before importing, preserving existing files.

Updates show a **Reload** action. Slate flushes pending edits before activating the new worker. Updates do not rewrite existing Markdown files.

## Verification

`pnpm build:site` assembles the site with relative assets and checks the manifest, CSP, redirect and initial JavaScript budget. `pnpm e2e` serves it under `/slate/` and exercises Chromium, Firefox, WebKit and mobile Chromium.

Playwright 1.65.1 fixes the older WebKit runtime's missing Storage API. Storage tests use an isolated persistent WebKit profile because ephemeral WebKit contexts do not support OPFS. Windows WebKit still returns transient OPFS/cache errors; its complete storage suite passes on Linux and runs on Linux/macOS in CI. On Windows, the supported-engine command is `pnpm e2e --project=chromium --project=firefox --project=mobile`.
