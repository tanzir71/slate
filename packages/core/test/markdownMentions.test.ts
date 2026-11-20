import { expect, it } from "vitest";
import { applyTextChanges, planMarkdownMentionLinks, scanMarkdownMentionText, findMarkdownMentions } from "../src/index";

const target = { id: "01KAGFJ5X90000000000000000", path: "Work/Launch plan.md", title: "Launch plan" };
const mentions = (source: string, title = target.title) => findMarkdownMentions(scanMarkdownMentionText(source), title);

it("finds whole literal Unicode words in prose with raw UTF-16 offsets and preserves matched case", () => {
  const source = "\uFEFF---\r\ntitle: Launch plan\n---\r\n\r\n🚀 LAUNCH PLAN and launch plan. Not prelaunch plan or Launch planning.\r\n";
  const ranges = mentions(source);
  expect(ranges.map(range => source.slice(range.from, range.to))).toEqual(["LAUNCH PLAN", "launch plan"]);
  expect(ranges[0]!.from).toBe(source.indexOf("LAUNCH PLAN"));
  expect(mentions("বাংলা বাংলাx xবাংলা বাংলা।", "বাংলা")).toHaveLength(2);
  expect(mentions("𐐀বাংলা বাংলা𐐀", "বাংলা")).toHaveLength(0);
});

it("skips metadata, code, links, images, references, HTML and existing or unfinished wiki links", () => {
  const source = [
    "---", "title: Launch plan", "---", "", "Launch plan", "", "`Launch plan`", "", "~~~md", "Launch plan", "~~~", "",
    "    Launch plan", "", "[Launch plan](https://example.test/Launch-plan)", "", "![Launch plan](asset.png)", "",
    "[Launch plan][ref]", "", "[ref]: /Launch-plan \"Launch plan\"", "", "[[Launch plan]] [[other|Launch plan]] [[other|**Launch plan**]]", "",
    "[[Launch plan", "", "<div>", "Launch plan", "</div>", "", "<span>Launch plan</span>", "", "<!-- Launch plan -->", "", "Launch plan",
  ].join("\r\n");
  expect(mentions(source).map(range => source.slice(range.from, range.to))).toEqual(["Launch plan", "Launch plan"]);
});

it("keeps ordinary emphasis/list/table/quote text eligible without spanning formatting syntax or entities", () => {
  const source = "**Launch plan**\n\n- Launch plan\n\n> Launch plan\n\n| Title |\n| --- |\n| Launch plan |\n\nLaunch *plan*\n\nLaunch&nbsp;plan\n";
  expect(mentions(source)).toHaveLength(4);
  expect(mentions("[Launch plan](url) and Launch plan")).toHaveLength(1);
  expect(mentions("before <span>Launch plan</span> Launch plan after")).toHaveLength(1);
});

it("handles regex punctuation literally and protects escaped wiki openings", () => {
  expect(mentions("C++ C-- C++17", "C++")).toHaveLength(2);
  expect(mentions("\\[[Launch plan]] and [[Launch plan]]")).toHaveLength(0);
  expect(mentions("\\\\[[Launch plan]]")).toHaveLength(0);
  expect(mentions("Nothing", "")).toHaveLength(0);
  expect(mentions("Launch\nplan", "Launch\nplan")).toHaveLength(0);
});

it("creates canonical path links with each original display label and changes no other bytes", () => {
  const source = "\uFEFF# Kept\r\n\r\nLAUNCH PLAN\n\nLaunch plan\r\n";
  const plan = planMarkdownMentionLinks(scanMarkdownMentionText(source), target)!;
  expect(plan.changes).toHaveLength(2);
  expect(plan.output).toBe("\uFEFF# Kept\r\n\r\n[[Work/Launch plan.md|LAUNCH PLAN]]\n\n[[Work/Launch plan.md|Launch plan]]\r\n");
  expect(applyTextChanges(plan.source, plan.changes)).toBe(plan.output);
  expect(mentions(plan.output)).toHaveLength(0);
});

it("refuses a title that cannot be represented without changing its display and leaves nonmatches unchanged", () => {
  expect(planMarkdownMentionLinks(scanMarkdownMentionText("Other words"), target)!.changes).toEqual([]);
  expect(planMarkdownMentionLinks(scanMarkdownMentionText("Title]"), { ...target, title: "Title]" })).toBeUndefined();
  expect(planMarkdownMentionLinks(scanMarkdownMentionText("Launch plan"), { ...target, id: "invalid", path: "../invalid.md" })).toBeUndefined();
});
