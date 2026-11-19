import { expect, it } from "vitest";
import {
  enabledTidyRules,
  readTidyConfiguration,
  tidyRuleIds,
  writeTidyConfiguration,
} from "../src/tidy/configuration";

it("enables the complete Slate rules while keeping bare URLs and on-save opt-in", () => {
  const config = readTidyConfiguration();
  expect(config).toEqual({
    version: 1,
    preset: "slate",
    rules: {},
    keepHardBreaks: true,
    onSave: false,
  });
  expect(enabledTidyRules(config).size).toBe(tidyRuleIds.length - 1);
  expect(enabledTidyRules(config).has("bare-urls")).toBe(false);
});
it("offers GitHub conventions and a whitespace-only Minimal preset with warnings", () => {
  const github = enabledTidyRules(
    readTidyConfiguration('{"version":1,"preset":"github"}'),
  );
  expect(github.has("list-marker")).toBe(true);
  expect(github.has("yaml-style")).toBe(false);
  expect(github.has("table-align")).toBe(false);
  const minimal = enabledTidyRules(
    readTidyConfiguration('{"version":1,"preset":"minimal"}'),
  );
  expect([...minimal]).toEqual([
    "heading-increment",
    "fence-language",
    "trailing-space",
    "no-hard-tabs",
    "multiple-blanks",
    "final-newline",
    "table-columns",
  ]);
});
it("retains future metadata and explicit rule overrides across a JSON round trip", () => {
  const config = readTidyConfiguration(
    '{"version":1,"preset":"minimal","onSave":true,"keepHardBreaks":false,"future":{"a":1},"rules":{"list-marker":true,"trailing-space":false,"future-rule":{"x":2}}}',
  );
  expect(enabledTidyRules(config).has("list-marker")).toBe(true);
  expect(enabledTidyRules(config).has("trailing-space")).toBe(false);
  expect(readTidyConfiguration(writeTidyConfiguration(config))).toEqual(config);
});
it.each([
  "[]",
  "null",
  '{"version":2}',
  '{"version":1,"preset":"other"}',
  '{"version":1,"rules":[]}',
  '{"version":1,"rules":null}',
  '{"version":1,"preset":null}',
  '{"version":1,"rules":{"list-marker":1}}',
  '{"version":1,"onSave":"yes"}',
  '{"version":1,"keepHardBreaks":0}',
  "{broken",
])(
  "rejects invalid configuration without substituting a writeable default (%s)",
  (source) => {
    expect(() => readTidyConfiguration(source)).toThrow();
  },
);
