import { expect, it } from "vitest";
import fc from "fast-check";
import { scanMarkdownSections, planMarkdownSectionMove } from "../src/markdownSections";
import { applyTextChanges } from "../src/textChanges";

it("resolves complete root sections with children while ignoring code, metadata and container headings", () => {
  const prefix = "\uFEFF---\r\ntitle: '# Hidden'\r\n---\r\n\r\nIntro\r\n\r\n";
  const source = prefix + "# First\r\n\r\n~~~md\r\n# Literal\r\n~~~\r\n\r\n> ## Quoted\r\n\r\n## Child\r\nWords.\r\n\r\n# Next\r\nDone.\r\n";
  const document = scanMarkdownSections(source);
  expect(document.bodyFrom).toBe(source.indexOf("\r\n\r\nIntro") + 2);
  expect(document.sections.map(section => section.heading.label)).toEqual(["First", "Child", "Next"]);
  expect(document.sections[0]!.from).toBe(prefix.length);
  expect(document.sections[0]!.end).toBe(source.indexOf("# Next"));
  expect(source.slice(document.sections[0]!.from, document.sections[0]!.to)).toBe("# First\r\n\r\n~~~md\r\n# Literal\r\n~~~\r\n\r\n> ## Quoted\r\n\r\n## Child\r\nWords.");
  expect(document.sections[1]!.end).toBe(document.sections[0]!.end);
});

it.each(["\n", "\r\n", "\r"])("moves a whole parent and children after its sibling with %j", eol => {
  const prefix = ["\uFEFF---", "title: Kept", "...", "", "Intro", ""].join(eol) + eol;
  const first = ["# First", "", "A", "", "## Child", "", "C"].join(eol), second = ["# Second", "", "B"].join(eol);
  const source = prefix + first + eol + eol + second + eol;
  const plan = planMarkdownSectionMove(scanMarkdownSections(source), 0, 3)!;
  const output = applyTextChanges(source, plan.changes);
  expect(output).toBe(prefix + second + eol + eol + first + eol);
  expect(output.slice(plan.selection.anchor, plan.selection.head)).toBe(first);
});

it.each(["", "\n", "\n\n"])("moves the last section before the first while retaining an EOF suffix of %j", suffix => {
  const source = "Intro\n\n# A\n\nalpha\n\n# B\n\nbeta" + suffix;
  const plan = planMarkdownSectionMove(scanMarkdownSections(source), 1, 0)!;
  const output = applyTextChanges(source, plan.changes);
  expect(output).toBe("Intro\n\n# B\n\nbeta\n\n# A\n\nalpha" + suffix);
  expect(output.slice(plan.selection.anchor, plan.selection.head)).toBe("# B\n\nbeta");
});

it("preserves Setext, Unicode, duplicate labels and mixed line endings inside moved payloads", () => {
  const prefix = "\uFEFFTitle 🙂\r\n===\r\n\r\n```md\n# Literal\n```\r\n\r\n";
  const first = "## বাংলা\ntext", last = "## বাংলা\nlast", source = prefix + first + "\n\n" + last;
  const document = scanMarkdownSections(source);
  expect(document.sections.map(section => section.heading.label)).toEqual(["Title 🙂", "বাংলা", "বাংলা"]);
  const plan = planMarkdownSectionMove(document, 2, 1)!;
  const output = applyTextChanges(source, plan.changes);
  expect(output).toBe(prefix + last + "\r\n\r\n" + first);
  expect(output.slice(plan.selection.anchor, plan.selection.head)).toBe(last);
});

it("moves the full physical heading line, including legal indentation and trailing spaces", () => {
  const source = "  # A\n\none  \n\n   # B\n\nother  \n";
  const plan = planMarkdownSectionMove(scanMarkdownSections(source), 1, 0)!;
  expect(applyTextChanges(source, plan.changes)).toBe("   # B\n\nother  \n\n  # A\n\none  \n");
});

it("keeps a bare BOM at the document start when its first section moves", () => {
  const source = "\uFEFF# A\n\nalpha\n\n# B\n\nbeta";
  const plan = planMarkdownSectionMove(scanMarkdownSections(source), 0, 2)!;
  expect(applyTextChanges(source, plan.changes)).toBe("\uFEFF# B\n\nbeta\n\n# A\n\nalpha");
});

it("uses block boundaries when previously adjacent heading sections change order", () => {
  const source = "# A\ntext\n# B\nother\n";
  const plan = planMarkdownSectionMove(scanMarkdownSections(source), 1, 0)!;
  expect(applyTextChanges(source, plan.changes)).toBe("# B\nother\n\n# A\ntext\n");
});

it("carries a moved child and its descendants into another section without rewriting their depth", () => {
  const source = "# A\n\na\n\n## Child A\n\n### Grandchild\n\ng\n\n# B\n\nb\n\n## Child B\n\nc";
  const plan = planMarkdownSectionMove(scanMarkdownSections(source), 1, 4)!;
  expect(applyTextChanges(source, plan.changes)).toBe("# A\n\na\n\n# B\n\nb\n\n## Child A\n\n### Grandchild\n\ng\n\n## Child B\n\nc");
});

it("can move a child before its parent while leaving the prologue in place", () => {
  const source = "Prologue\n\n# Parent\n\nbody\n\n## Child\n\nchild\n";
  const plan = planMarkdownSectionMove(scanMarkdownSections(source), 1, 0)!;
  expect(applyTextChanges(source, plan.changes)).toBe("Prologue\n\n## Child\n\nchild\n\n# Parent\n\nbody\n");
});

it("leaves a parent in place when the destination is itself, a child, or its existing end", () => {
  const document = scanMarkdownSections("# A\n\n## Child\n\nText\n\n# B\n\nLast");
  for (const before of [0, 1, 2]) expect(planMarkdownSectionMove(document, 0, before)).toBeUndefined();
  expect(planMarkdownSectionMove(document, 2, 3)).toBeUndefined();
});

it.each(["", "\uFEFF", "---\ntitle: unfinished", "\uFEFF---\n# Protected", "> # Quoted\n\n    # Indented\n\n~~~md\n# Literal\n~~~"])("does not expose movable sections in %j", source => {
  expect(scanMarkdownSections(source).sections).toEqual([]);
});

it.each([[-1, 0], [0, -1], [2, 0], [0, 3], [0.5, 1], [0, Number.NaN]])("rejects invalid section indexes %s / %s", (index, before) => {
  expect(() => planMarkdownSectionMove(scanMarkdownSections("# A\n\n# B"), index, before)).toThrow(RangeError);
});

it("retains every generated payload and the EOF convention across section permutations", () => {
  fc.assert(fc.property(
    fc.array(fc.constantFrom("Words.", "বাংলা 🙂", "**bold**", "`# code`", "[link](other.md)"), { minLength: 2, maxLength: 8 }),
    fc.constantFrom("\n", "\r\n", "\r"), fc.boolean(), fc.nat(100), fc.nat(100),
    (bodies, eol, finalEol, pick, destination) => {
      const chunks = bodies.map((body, index) => `# Section ${index}${eol}${eol}${body}`);
      const source = chunks.join(eol + eol) + (finalEol ? eol : ""), index = pick % chunks.length, before = destination % (chunks.length + 1);
      const document = scanMarkdownSections(source), plan = planMarkdownSectionMove(document, index, before);
      const output = plan ? applyTextChanges(source, plan.changes) : source;
      const order = chunks.map((_, at) => at);
      if (plan) { const [moved] = order.splice(index, 1); order.splice(before > index ? before - 1 : before, 0, moved!); }
      else expect([index, index + 1]).toContain(before);
      const actual = scanMarkdownSections(output);
      expect(actual.sections.map(section => output.slice(section.from, section.to))).toEqual(order.map(at => chunks[at]));
      expect(output.endsWith(eol)).toBe(finalEol);
    },
  ), { numRuns: 80 });
});
