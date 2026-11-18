import { expect, it } from "vitest";
import { carryOverTasks } from "../src/dailyNote";
import { previousDailyNote } from "../src/dailyNotePath";
import { parseMarkdownPreview, type MarkdownPreviewNode } from "../src/blocks";

function taskText(source: string) {
  const tasks: { checked: boolean; text: string }[] = [];
  const text = (node: MarkdownPreviewNode): string =>
    node.value ?? (node.children ?? []).map(text).join("");
  function visit(node: MarkdownPreviewNode) {
    if (typeof node.checked === "boolean")
      tasks.push({ checked: node.checked, text: text(node.children![0]!) });
    for (const child of node.children ?? []) visit(child);
  }
  visit(parseMarkdownPreview(source));
  return tasks;
}
it("chooses only the latest earlier canonical valid daily path, including leap days", () => {
  const paths = [
    "Daily/2024-02-28.md",
    "Daily/2024-02-29.md",
    "Daily/2024-03-01.md",
    "Daily/2024-03-02.md",
    "Daily/2024-02-30.md",
    "Daily/2024-02-29 (1).md",
    "Daily/sub/2024-02-29.md",
    "Inbox/2024-02-29.md",
    ".slate/Daily/2024-02-29.md",
  ];
  expect(previousDailyNote(paths, "2024-03-01")).toBe("Daily/2024-02-29.md");
  expect(previousDailyNote([...paths].reverse(), "2024-03-01")).toBe(
    "Daily/2024-02-29.md",
  );
  expect(previousDailyNote(paths, "2024-02-28")).toBeUndefined();
  expect(previousDailyNote([], "2024-03-01")).toBeUndefined();
  expect(
    previousDailyNote(["Daily/2024-02-29.md\n"], "2024-03-01"),
  ).toBeUndefined();
  expect(() => previousDailyNote(paths, "2023-02-29")).toThrow(
    "valid calendar date",
  );
});
it("copies real unfinished GFM tasks and their rich multiline context without altering the source", () => {
  const source =
    "# Tasks\n\n- [ ] **Ship** [review](https://example.com) 🙂\n\n  Keep this paragraph.\n\n  - Supporting detail\n  - [x] Done subtask\n  - [ ] Pending subtask\n\n- [X] Finished\n- Ordinary sibling\n+ [ ] Next\n";
  const before = source;
  const copied = carryOverTasks(source);
  expect(taskText(copied)).toEqual([
    { checked: false, text: "Ship review 🙂" },
    { checked: false, text: "Pending subtask" },
    { checked: false, text: "Next" },
  ]);
  expect(copied).toContain("Keep this paragraph.");
  expect(copied).toContain("Supporting detail");
  expect(copied).not.toMatch(/Done subtask|Finished|Ordinary sibling/);
  expect(source).toBe(before);
});
it("keeps finished ancestors as plain context for nested unfinished work, with no duplicate tasks", () => {
  const copied = carryOverTasks(
    "- [x] Project\n  - Context\n    - [ ] Remaining\n  - [x] Done\n\n> Owner's note\n> - [ ] Quoted task\n",
  );
  expect(taskText(copied)).toEqual([
    { checked: false, text: "Remaining" },
    { checked: false, text: "Quoted task" },
  ]);
  expect(copied).toContain("- Project");
  expect(copied).toContain("Context");
  expect(copied).toContain("Owner's note");
  expect(copied).not.toContain("Done");
});
it("does not collect checkbox examples in fences, indented code, HTML, inline code or plain text", () => {
  const source =
    "```md\n- [ ] Fenced\n```\n\n    - [ ] Indented\n\n<div>\n- [ ] HTML\n</div>\n\n`- [ ] Inline`\n\nText [ ] ordinary\n\n- [ ] Actual\n";
  expect(taskText(carryOverTasks(source))).toEqual([
    { checked: false, text: "Actual" },
  ]);
  expect(carryOverTasks("- [x] Done\n\nNo work")).toBe("");
});
it.each(["\n", "\r\n", "\r"])(
  "protects complete, invalid and unfinished YAML with %j",
  (eol) => {
    const header = [
      "\uFEFF---",
      "invalid: [",
      "example: |",
      "  - [ ] Metadata",
    ].join(eol);
    for (const closing of ["---", "..."]) {
      expect(
        taskText(carryOverTasks(header + eol + closing + eol + "- [ ] Body")),
      ).toEqual([{ checked: false, text: "Body" }]);
    }
    expect(carryOverTasks(header + eol + "- [ ] Still metadata")).toBe("");
    expect(carryOverTasks("---")).toBe("");
    expect(taskText(carryOverTasks("\uFEFF- [ ] No header"))).toEqual([
      { checked: false, text: "No header" },
    ]);
  },
);
it("retains reference definitions and footnotes needed by pending tasks", () => {
  const copied = carryOverTasks(
    '- [ ] Read [review][ref] ![diagram][image] with note[^n]\n\n[ref]: https://example.com/review "Review"\n[image]: ./assets/diagram.png\n[^n]: Keep these words.\n',
  );
  expect(copied).toContain('[ref]: https://example.com/review "Review"');
  expect(copied).toContain("[image]: ./assets/diagram.png");
  expect(copied).toContain("[^n]: Keep these words.");
});
it("keeps ordered task groups and literal template expressions as data", () => {
  const copied = carryOverTasks(
    "3. [ ] Keep {{date}} and {{cursor}} literal\n4. [x] Done\n5. [ ] Keep `code`\n",
  );
  expect(taskText(copied)).toEqual([
    { checked: false, text: "Keep {{date}} and {{cursor}} literal" },
    { checked: false, text: "Keep code" },
  ]);
  expect(copied).toMatch(/^3\. \[ \]/);
});
