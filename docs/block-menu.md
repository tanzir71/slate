# Block menu (unreleased work)

These development features have not been published. The public app remains v0.2.1.

Type `/` at the beginning of a line or after whitespace to search blocks. The menu stays closed in code, URLs and front matter. Names, aliases, template categories and relative paths, and snippet triggers support prefix and fuzzy matches. Results are grouped as Blocks, Insert, Templates and Snippets. Arrow keys select a result, Tab switches between the editor/search and its source/render preview, Enter chooses it, and Escape keeps your typed text. The gutter's block actions also offer **Insert block after**. A query such as `/TeamReview` can match `Team/Review.md`; the gutter search also accepts its full relative path.

Templates in this menu insert into the current sheet. They retain ordinary Markdown properties and use their variables, prompts and cursor marker. Title/date fields and prompts open for review when needed. **New from template** creates a separate sheet and uses the template's destination and filename settings. See [templates](templates.md) for the file format and variables.

While a slash query is open, Space stays in the query and Tab previews its result. Enter chooses a matching snippet, including definitions normally activated by Space.

Snippet results use the same definitions and fields as trigger expansion and the **Mod ;** picker. Linked and nested numbered fields remain editable with Tab and Shift Tab; `$0` is the final position. Gutter choices add missing blank separation in the same undo step. See [snippets](snippets.md) for configuration and scope rules.

Clipboard access is explicit. A prompt offers **Read clipboard** and a manual field; clipboard and prompt values stay literal. The preview shows the selected definition and its rendered defaults. A choice captures those values while loading its definition or filling its form.

Selecting a Space template or snippet revalidates its file. If its content changed, review the refreshed preview and choose again. A changed sheet, caret, composition or write ownership rejects the saved editor request and keeps newer writing. Canceling a form keeps the original query. Each insertion is one undo step, and definition files stay intact. The same operations work offline and in the selected Folder tier.

[Custom blocks](custom-blocks.md) add literal Markdown fragments from `.slate/blocks/` to the Blocks group.
