# Smart input (unreleased v0.4 work)

Open **Editor settings** from the header, command palette or Ctrl/Command comma. Each preference applies immediately on this device and survives reopening. Turning one off keeps the other rules available. Preferences never change existing files.

- **Continue lists and quotes:** Enter continues a marker; Enter on an empty item or Backspace at its content start removes a level. Numbered siblings keep their starting number and align continuation lines when counter width changes.
- **Indent list items:** Tab and Shift-Tab move an item and its children between levels. At the outer boundary, Tab keeps its normal focus behavior.
- **Move list items with children:** Alt Up/Down moves whole sibling items. Numbered siblings are renumbered.
- **Wrap selected text:** Type `*`, `_`, a backtick, `~~`, `==`, `[` or `(` over selected words to wrap them. The words stay selected; each complete wrapper is one undo step.
- **Suggest sheets after [[:** Type part of a sheet title or file path. Suggestions show the full path to distinguish equal titles. Enter, Tab or a click inserts `[[path/to/file.md|Title]]`. Escape keeps the typed query. Ctrl/Command click follows the link. Accepting a suggestion takes one undo step; undo restores the query.
- **Suggest tags after #:** Reuse this Space's tags, including nested tags such as `#work/project`. Enter, Tab or a click accepts; Escape keeps the query.

Wiki and tag suggestions stay literal in code, URLs, HTML comments, front-matter, read-only notes and IME composition. The date picker and the remaining smart-table/paste/fence rules are still in progress. This branch has no release tag or public deployment.
