# Snippets (unreleased v0.5 work)

The browser implementation is under verification on the development branch. It has not been published; the public app remains v0.2.1. Native snippet integration is pending.

Choose **Sheet actions → Manage snippets**, or **Manage snippets** in Editor settings. Add a definition with a name, trigger, body, scope and activation key. The default activation is Tab; Space or both keys can be selected. Changes save ordinary JSON files. A definition in the current Space overrides the same global trigger; disabling a local definition suppresses that global trigger in this Space.

Space definitions live at `.slate/snippets.json` in the selected folder or browser library. Browser-global definitions live in `global/snippets.json` beside the browser's Spaces directory. They apply to this browser origin. Missing global configuration provides three built-ins: `;today`, `;tbl` and `;sig`. Saving global changes materializes that file; an explicit empty `snippets` array clears the built-ins.

```json
{
  "version": 1,
  "snippets": [
    {
      "trigger": ";greet",
      "name": "Greeting",
      "body": "Hello ${1:Name},\n\n${2:Message}\n\n— {{prompt:Sender|Sam}}$0",
      "expandOn": "tab",
      "enabled": true
    }
  ]
}
```

Type a trigger at a word boundary outside code, then press its activation key. Tab and Shift Tab move between numbered fields; `$0` is the final cursor position. Repeated numbers edit linked fields together. Nested defaults work: replacing an outer field skips its removed children and keeps later fields. Escape or a selection outside the fields ends navigation. Undoing the expansion restores the trigger; edits in separate fields have separate undo boundaries.

Press **Mod ;** in the editor, or choose **Insert snippet**, to search names and triggers. Arrow keys select a result, Tab toggles its source preview, and Enter inserts it. Escape cancels. A visible editor completion menu retains Tab priority. Snippets do not expand during composition or with multiple selections.

Bodies accept the [template variables and filters](templates.md), including dates, time, title, selection, Space, notebook and prompts. Values are captured when invoking the snippet; `title` is the current sheet title. Prompts and clipboard content open a form before insertion. **Read clipboard** is explicit, with a manual field when browser access is unavailable. Supplied values stay literal, so a clipboard value containing `${1:Text}` cannot create another field. Unresolved variables stay visible for review. If the sheet or selection changes while the form is open, insertion is rejected and the newer writing is retained.

**Edit Space JSON** and **Edit global JSON** expose the exact configuration for advanced changes and repair. Unknown file and entry properties are preserved by normal form edits. Malformed JSON with valid UTF-8 can be repaired; unsupported encodings remain read-only with an original-file download. If another application changes the configuration before saving, its primary file stays intact and your proposal is saved as a conflict copy. Review the current file before editing again. Definitions refresh after focus changes, saves and visible file polling, including offline use.

The [block menu](block-menu.md) also groups snippets by name and trigger. These choices use the same prompts and tab stops, and the gutter inserts them after the complete current block in one undo step.
