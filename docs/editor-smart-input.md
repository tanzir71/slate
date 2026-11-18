# Smart input (unreleased v0.4 work)

Open **Editor settings** from the header, command palette or Ctrl/Command comma. Each preference applies immediately on this device and survives reopening. Turning one off keeps the other rules available. Preferences never change existing files.

- **Continue lists and quotes:** Enter continues a marker; Enter on an empty item or Backspace at its content start removes a level. Numbered siblings keep their starting number and align continuation lines when counter width changes.
- **Indent list items:** Tab and Shift-Tab move an item and its children between levels. At the outer boundary, Tab keeps its normal focus behavior.
- **Move list items with children:** Alt Up/Down moves whole sibling items. Numbered siblings are renumbered.
- **Edit tables with the keyboard:** Type `| a | b |` and Enter to create the separator and first body row. Tab and Shift-Tab move between cells, skipping the separator; Tab at the end appends a row. Shift-Tab in the first cell keeps normal focus behavior. Enter adds a row below the current row without splitting cell text. Tab, Enter and leaving the editor align edited tables. Each structural edit is one undo step. Quoted/list-contained tables, escaped pipes, Unicode and extra source cells are preserved. The command palette provides padding alignment, column insertion/deletion and left/center/right/no alignment. These manual commands remain available when the smart-table preference is off; the sole column cannot be deleted.
- **Wrap selected text:** Type `*`, `_`, a backtick, `~~`, `==`, `[` or `(` over selected words to wrap them. The words stay selected; each complete wrapper is one undo step.
- **Suggest sheets after [[:** Type part of a sheet title or file path. Suggestions show the full path to distinguish equal titles. Enter, Tab or a click inserts `[[path/to/file.md|Title]]`. Inside table cells the link uses `[[path/to/file.md]]` so an alias pipe cannot split the cell. Escape keeps the typed query. Ctrl/Command click follows the link. Accepting a suggestion takes one undo step; undo restores the query.
- **Suggest tags after #:** Reuse this Space's tags, including nested tags such as `#work/project`. Enter, Tab or a click accepts; Escape keeps the query.
- **Choose dates after @:** Type `@` and accept **Choose date…** to open the calendar picker. The choice inserts a plain `YYYY-MM-DD` date in one undo step. Cancel or Escape keeps the query. A complete typed ISO date prefills the picker; other queries start with today on this device. If the note changes while the picker is open, close it and try again.

Wiki and tag suggestions stay literal in code, URLs, HTML comments, front-matter, read-only notes and IME composition. Block-level slash suggestions stay out of table cells. This branch has no release tag or public deployment.


Use `/` at a block boundary to search the built-in catalog. Arrow keys choose a block, Tab previews its Markdown/rendering, Enter inserts, and Escape keeps the typed query. Hover a block for its **+** and drag grip. **Block actions** is also reachable with Tab and has a 44 px touch target: insert after the current block, move it up/down, or select the whole block to use the existing **Turn selection into** toolbar. Drag and move preserve complete lists, quotes, fences and tables. Each move or insertion takes one undo; front matter stays in place. If a note changes while a menu is open, choose the block again.

The **+** picker searches the same catalog without typing a slash into the note. Cancelling a code-language or image choice keeps the original text. Successful images remain as numbered files beside their note under `assets/`; undo removes the Markdown reference and keeps the image file.

- **Paste rich text as Markdown:** Web and word-processor HTML becomes Markdown; a failure keeps a plain-text fallback. Conversion loads only when needed.
- **Paste links over selected text:** An accepted URL wraps selected words without losing them.
- **Paste images:** Clipboard images become local numbered PNG files and relative Markdown links. Saved PNG bytes stay exact; other supported image types are decoded and encoded locally. A failed or stale paste keeps its pending payload for explicit retry.
- **Paste delimited tables:** Tab/comma-separated cell data becomes a GFM table.
- **Close code fences:** Enter after an opening backtick/tilde fence adds its matching closing fence. A bare fence opens the language picker; cancel retains the plain closed fence. Language choice and the pair remain one undo even after a delayed choice.
- **Create front matter:** Enter after `---` on the first line adds a closing boundary and leaves the caret inside. Later text remains outside the metadata.

Each paste/fence rule has its own setting. Ctrl/Command Shift V retains plain paste. IME composition and read-only notes retain their platform input behavior.
