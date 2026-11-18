import { describe, expect, it } from "vitest";
import { applyTextChanges } from "../src/textChanges";
import {
  builtinBlocks,
  planBuiltinBlock,
  tableOfContents,
  type BlockContext,
  type BlockPlan,
} from "../src/blocks";
import golden from "./fixtures/blocks.json";

interface GoldenBlock {
  id: string;
  context?: Pick<BlockContext, "language" | "image" | "date" | "time">;
  text: string;
  selected?: string;
  caret?: number;
  followUp?: string;
}
function inserted(
  id: string,
  context: BlockContext,
): Extract<BlockPlan, { kind: "insert" }> {
  const plan = planBuiltinBlock(id, context);
  expect(plan.kind).toBe("insert");
  if (plan.kind !== "insert")
    throw new Error(`Expected an insertion for ${id}`);
  return plan;
}
const empty: BlockContext = { source: "/", from: 0, to: 1 };

describe("built-in block golden outputs", () => {
  it("covers every catalog entry once, with unique IDs and searchable labels", () => {
    expect(golden.map((fixture) => fixture.id).sort()).toEqual(
      builtinBlocks.map((block) => block.id).sort(),
    );
    expect(new Set(builtinBlocks.map((block) => block.id)).size).toBe(
      builtinBlocks.length,
    );
    for (const block of builtinBlocks) {
      expect(block.label.length).toBeGreaterThan(0);
      expect(block.aliases.length).toBeGreaterThan(0);
    }
  });
  it.each(golden as readonly GoldenBlock[])("$id", (fixture) => {
    const context = { ...empty, ...fixture.context };
    const plan = inserted(fixture.id, context);
    const output = applyTextChanges(context.source, plan.changes);
    expect(output).toBe(fixture.text);
    expect(plan.selection.anchor).toBeGreaterThanOrEqual(0);
    expect(plan.selection.head).toBeLessThanOrEqual(output.length);
    if (fixture.selected !== undefined)
      expect(output.slice(plan.selection.anchor, plan.selection.head)).toBe(
        fixture.selected,
      );
    else
      expect(plan.selection).toEqual({
        anchor: fixture.caret,
        head: fixture.caret,
      });
    expect(plan.followUp).toBe(fixture.followUp);
  });
});

it("preserves both sides and aligns UTF-16 selections after CRLF boundaries", () => {
  const source = "😀 Before\r\n/table\r\nAfter untouched.";
  const from = source.indexOf("/table");
  const context = { source, from, to: from + 6 };
  const plan = inserted("table", context);
  const output = applyTextChanges(source, plan.changes);
  const table = golden
    .find((fixture) => fixture.id === "table")!
    .text.replace(/\n/g, "\r\n");
  expect(output).toBe(`😀 Before\r\n\r\n${table}\r\n\r\nAfter untouched.`);
  expect(output.slice(plan.selection.anchor, plan.selection.head)).toBe(
    "Column",
  );
  expect(context).toEqual({ source, from, to: from + 6 });
});

it("joins prefix blocks to existing text without discarding the surrounding paragraph", () => {
  const context = { source: "Before /quote after", from: 7, to: 13 };
  const plan = inserted("quote", context);
  expect(applyTextChanges(context.source, plan.changes)).toBe(
    "Before \n\n>  after",
  );
  expect(plan.selection).toEqual({ anchor: 11, head: 11 });
});

it("appends a collision-free footnote definition in the same transaction", () => {
  const context = {
    source: "Keep [^1] and /fn after.\n\n[^1]: Original.\n",
    from: 14,
    to: 17,
  };
  const plan = inserted("footnote", context);
  const output = applyTextChanges(context.source, plan.changes);
  expect(output).toBe("Keep [^1] and [^2] after.\n\n[^1]: Original.\n\n[^2]: ");
  expect(plan.changes).toHaveLength(2);
  expect(plan.selection).toEqual({
    anchor: output.length,
    head: output.length,
  });
});

it("guards existing front-matter and only inserts properties at the document start", () => {
  expect(
    planBuiltinBlock("frontmatter", { source: "Keep\n/", from: 5, to: 6 }).kind,
  ).toBe("unavailable");
  expect(
    planBuiltinBlock("frontmatter", {
      source: "---\ntitle: Keep\n---\n",
      from: 0,
      to: 0,
    }).kind,
  ).toBe("unavailable");
  const source = "\uFEFF/yaml";
  const plan = inserted("frontmatter", { source, from: 1, to: source.length });
  expect(applyTextChanges(source, plan.changes)).toBe(
    "\uFEFF---\ntitle: \n---\n",
  );
  expect(plan.selection.anchor).toBe(12);
});

it.each(["image", "codeblock", "date", "time"])(
  "requests %s inputs before creating changes",
  (id) => {
    const plan = planBuiltinBlock(id, empty);
    expect(plan).toEqual({
      kind: "request",
      input: id === "codeblock" ? "language" : id,
    });
    expect(empty.source).toBe("/");
  },
);

it("escapes image asset names and labels while rejecting paths outside managed assets", () => {
  const plan = inserted("image", {
    ...empty,
    image: { path: "./assets/a (1)#é.png", alt: "A [diagram]" },
  });
  expect(applyTextChanges("/", plan.changes)).toBe(
    "![A \\[diagram\\]](assets/a%20%281%29%23%C3%A9.png)",
  );
  for (const path of [
    "../secret.png",
    "assets/../secret.png",
    "assets/",
    "/assets/a.png",
    "assets/a\\b.png",
    "assets/\u0000.png",
  ])
    expect(planBuiltinBlock("image", { ...empty, image: { path } }).kind).toBe(
      "unavailable",
    );
  expect(
    planBuiltinBlock("image", {
      ...empty,
      image: { path: "assets/a.png", alt: "two\nlines" },
    }).kind,
  ).toBe("unavailable");
});

it("validates explicit clock and language values without reading ambient time", () => {
  for (const date of ["2024-02-29", "2000-02-29", "2026-12-31"])
    expect(planBuiltinBlock("date", { ...empty, date }).kind).toBe("insert");
  for (const date of [
    "1900-02-29",
    "2026-02-29",
    "2026-13-01",
    "2026-01-00",
    "2026-04-31",
    "yesterday",
  ])
    expect(planBuiltinBlock("date", { ...empty, date }).kind).toBe(
      "unavailable",
    );
  for (const time of ["00:00", "23:59:59"])
    expect(planBuiltinBlock("time", { ...empty, time }).kind).toBe("insert");
  for (const time of ["24:00", "12:60:00", "noon"])
    expect(planBuiltinBlock("time", { ...empty, time }).kind).toBe(
      "unavailable",
    );
  expect(
    planBuiltinBlock("codeblock", { ...empty, language: "c++" }).kind,
  ).toBe("insert");
  expect(planBuiltinBlock("codeblock", { ...empty, language: "" }).kind).toBe(
    "insert",
  );
  expect(
    planBuiltinBlock("codeblock", { ...empty, language: "js\n```" }).kind,
  ).toBe("unavailable");
});

it("rejects invalid ranges and unknown blocks without producing edits", () => {
  for (const [from, to] of [
    [-1, 0],
    [0.5, 1],
    [1, 0],
    [0, 2],
    [NaN, 1],
  ])
    expect(() =>
      planBuiltinBlock("quote", { source: "/", from: from!, to: to! }),
    ).toThrow("Invalid block insertion range");
  expect(planBuiltinBlock("missing", empty).kind).toBe("unavailable");
});

it("builds TOCs from headings, ignoring properties/code and resolving duplicate anchors", () => {
  const source =
    "---\ntitle: Hidden\n---\n\n# A *title*\n\n```md\n# Hidden\n```\n\n## Child [link](https://example.com)\n\n# A title\n\n# A-title-1\n\n# বাংলা শিরোনাম";
  expect(tableOfContents(source)).toBe(
    "- [A title](#a-title)\n  - [Child link](#child-link)\n- [A title](#a-title-1)\n- [A-title-1](#a-title-1-1)\n- [বাংলা শিরোনাম](#বাংলা-শিরোনাম)",
  );
  const context = { source: "# Keep /toc", from: 7, to: 11 };
  const plan = inserted("toc", context);
  expect(applyTextChanges(context.source, plan.changes)).toBe(
    "# Keep \n\n<!-- toc -->\n- [Keep](#keep)\n<!-- /toc -->",
  );
});

it("keeps TOC labels readable for formatted/image headings and skips empty headings", () => {
  expect(
    tableOfContents(
      "# <b>Caption</b> ![icon](assets/icon.png)\n\n# !!!\n\n# !!!\n\n#\n",
    ),
  ).toBe(
    "- [Caption icon](#caption-icon)\n- [!!!](#section)\n- [!!!](#section-1)",
  );
  const plan = inserted("image", {
    ...empty,
    image: { path: "assets/diagram.png" },
  });
  expect(applyTextChanges("/", plan.changes)).toBe(
    "![Image](assets/diagram.png)",
  );
});

it("creates a three-row, three-column GFM table including its header", () => {
  const source = golden.find((fixture) => fixture.id === "table")!.text;
  const rowCells = source
    .split("\n")
    .filter((line) => !line.includes("------"))
    .map((line) => line.split("|").slice(1, -1));
  expect(rowCells).toHaveLength(3);
  expect(rowCells.every((cells) => cells.length === 3)).toBe(true);
});

it("separates gutter headings from both neighbors while retaining start-only placement", () => {
  const source = "A\n\nB";
  const plan = inserted("heading2", {
    source,
    from: 2,
    to: 2,
    separateBlock: true,
  });
  expect(applyTextChanges(source, plan.changes)).toBe("A\n\n## \n\nB");
  const metadata = inserted("frontmatter", {
    source: "\uFEFF",
    from: 1,
    to: 1,
    separateBlock: true,
  });
  expect(applyTextChanges("\uFEFF", metadata.changes)).toBe(
    "\uFEFF---\ntitle: \n---\n",
  );
});
