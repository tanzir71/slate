import { expect, it } from "vitest";
import {
  analyzeTemplateVariables,
  renderTemplateText,
  type TemplateContext,
} from "../src/templateVariables";

const context: TemplateContext = {
  title: "Café & Ideas",
  clock: { date: "2026-11-18", time: "13:05:09.125", offsetMinutes: 360 },
  id: "01JA8EXAMPLE",
  space: "My writing",
  notebook: "product/meetings",
  selection: "Keep **these** words.",
  clipboard: "Exact clipboard\n🙂",
};

it.each([
  ["title", "Café & Ideas"],
  ["id", "01JA8EXAMPLE"],
  ["space", "My writing"],
  ["notebook", "product/meetings"],
  ["selection", "Keep **these** words."],
  ["clipboard", "Exact clipboard\n🙂"],
  ["date", "2026-11-18"],
  ["time", "13:05"],
  ["date:YYYY/MM/DD", "2026/11/18"],
  ["time:h:mm:ss A", "1:05:09 PM"],
  ["date:dddd, MMMM Do YYYY", "Wednesday, November 18th 2026"],
  ["date:GGGG-[W]WW", "2026-W47"],
  ["date:Q Qo DDD DDDD", "4 4th 322 322"],
  ["time:HH:mm:ss.SSS Z ZZ", "13:05:09.125 +06:00 +0600"],
  ["date:YYYY年MM月DD日", "2026年11月18日"],
  ["title|slug", "cafe-ideas"],
  ["title|upper", "CAFÉ & IDEAS"],
  ["title|upper|lower", "café & ideas"],
])("renders %s using only supplied context", (variable, expected) => {
  expect(renderTemplateText("{{" + variable + "}}", context)).toEqual({
    text: expected,
    issues: [],
  });
});

it("keeps Unicode marks in non-Latin slugs and never returns path separators", () => {
  expect(
    renderTemplateText("{{title|slug}}", { title: "বাংলা লেখা / Notes 🙂" })
      .text,
  ).toBe("বাংলা-লেখা-notes");
  expect(
    renderTemplateText("{{title|slug}}", { title: "../../Report: Q4?" }).text,
  ).toBe("report-q4");
});

it("places the first cursor in UTF-16 output coordinates and removes subsequent markers", () => {
  expect(
    renderTemplateText("🙂 {{title|upper}} {{cursor}}Keep{{cursor}}", context),
  ).toEqual({
    text: "🙂 CAFÉ & IDEAS Keep",
    cursor: "🙂 CAFÉ & IDEAS ".length,
    issues: [],
  });
  expect(renderTemplateText("{{cursor}}", {})).toEqual({
    text: "",
    cursor: 0,
    issues: [],
  });
});

it("collects prompts once, uses the first default consistently and applies filters after values", () => {
  const source =
    "{{prompt:Project|First}} {{prompt:Owner}} {{prompt:Project|Other|upper}} {{clipboard}}";
  const analysis = analyzeTemplateVariables(source);
  expect(analysis.prompts).toEqual([
    { label: "Project", defaultValue: "First" },
    { label: "Owner" },
  ]);
  expect(analysis.variables).toEqual(["prompt", "clipboard"]);
  expect(
    renderTemplateText(source, { clipboard: "", prompts: { Owner: "Sam" } }),
  ).toEqual({
    text: "First Sam FIRST ",
    issues: [],
  });
  expect(
    renderTemplateText("{{prompt:Project|First|slug}}", {
      prompts: { Project: "New Launch" },
    }).text,
  ).toBe("new-launch");
});

it("distinguishes an explicit empty prompt from a missing required answer", () => {
  expect(
    renderTemplateText("{{prompt:Owner}}", { prompts: { Owner: "" } }),
  ).toEqual({ text: "", issues: [] });
  expect(renderTemplateText("{{prompt:Owner|}}", {})).toEqual({
    text: "",
    issues: [],
  });
  const result = renderTemplateText("{{prompt:Owner}}", {});
  expect(result.text).toBe("{{prompt:Owner}}");
  expect(result.issues).toEqual([
    expect.objectContaining({
      kind: "missing-value",
      variable: "prompt",
      from: 0,
      to: 16,
    }),
  ]);
});

it("accepts literal pipes in prompt labels/defaults through a backslash escape", () => {
  expect(
    renderTemplateText("{{prompt:Choice\\|label|A\\|B|lower}}", {}),
  ).toEqual({ text: "a|b", issues: [] });
});

it("does not execute or recursively expand supplied values", () => {
  expect(
    renderTemplateText("{{title}}", {
      title: "{{id}} $(Get-Content secret) <script>kept</script>",
      id: "no",
    }),
  ).toEqual({
    text: "{{id}} $(Get-Content secret) <script>kept</script>",
    issues: [],
  });
  const prompts = Object.create(null) as Record<string, string>;
  prompts.__proto__ = "Safe own value";
  expect(renderTemplateText("{{prompt:__proto__}}", { prompts }).text).toBe(
    "Safe own value",
  );
  expect(renderTemplateText("{{prompt:constructor}}", {}).issues[0]?.kind).toBe(
    "missing-value",
  );
});

it("keeps unknown variables and filters verbatim with exact source locations", () => {
  const source = "🙂 {{future}} / {{title|mystery}} / {{prompt:}}";
  const result = renderTemplateText(source, context);
  expect(result.text).toBe(source);
  expect(
    result.issues.map(({ kind, raw, from, to }) => [
      kind,
      raw,
      source.slice(from, to),
    ]),
  ).toEqual([
    ["unknown-variable", "{{future}}", "{{future}}"],
    ["unknown-filter", "{{title|mystery}}", "{{title|mystery}}"],
    ["invalid-variable", "{{prompt:}}", "{{prompt:}}"],
  ]);
});

it("keeps a nested or malformed expression intact instead of evaluating its inner token", () => {
  const source = "{{future:{{title}}}} / {{prompt:Name|{{id}}}}";
  const result = renderTemplateText(source, context);
  expect(result.text).toBe(source);
  expect(result.issues).toHaveLength(2);
  expect(result.issues.every(({ kind }) => kind === "invalid-variable")).toBe(
    true,
  );
});

it("keeps missing values and invalid clock/format data instead of silently writing blanks", () => {
  for (const [source, values] of [
    ["{{title}}", {}],
    ["{{clipboard}}", {}],
    ["{{date}}", {}],
    ["{{date}}", { clock: { date: "2026-02-30", time: "10:00" } }],
    ["{{time}}", { clock: { date: "2026-11-18", time: "24:00" } }],
    [
      "{{time}}",
      { clock: { date: "2026-11-18", time: "13:05", offsetMinutes: 9999 } },
    ],
    ["{{date:YYYY-J}}", context],
    ["{{date:YYYY-[unclosed}}", context],
  ] as const) {
    const result = renderTemplateText(source, values);
    expect(result.text).toBe(source);
    expect(result.issues).toHaveLength(1);
  }
  expect(renderTemplateText("{{selection}}", {})).toEqual({
    text: "",
    issues: [],
  });
});

it.each([
  ["2021-01-01", "2020-W53 Friday"],
  ["2024-02-29", "2024-W09 Thursday"],
  ["2020-12-31", "2020-W53 Thursday"],
  ["2024-12-30", "2025-W01 Monday"],
  ["0099-01-01", "0099-W01 Thursday"],
])(
  "formats calendar/ISO week boundaries for %s without local timezone rollover",
  (date, expected) => {
    expect(
      renderTemplateText("{{date:GGGG-[W]WW dddd}}", {
        clock: { date, time: "00:00" },
      }).text,
    ).toBe(expected);
  },
);

it("formats offset-aware Unix time, midnight, milliseconds, escaped literals and ordinal endings", () => {
  const values = {
    clock: { date: "1970-01-01", time: "06:00:00.1", offsetMinutes: 360 },
  };
  expect(
    renderTemplateText("{{time:X x h hh H HH S SS SSS A a [at]}}", values).text,
  ).toBe("0 100 6 06 6 06 1 10 100 AM am at");
  expect(
    renderTemplateText("{{time:h:mm A}}", {
      clock: { date: "2026-11-18", time: "00:05" },
    }).text,
  ).toBe("12:05 AM");
  expect(
    renderTemplateText("{{date:Do}}", {
      clock: { date: "2026-11-11", time: "00:00" },
    }).text,
  ).toBe("11th");
});
