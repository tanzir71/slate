import { expect, it } from "vitest";
import * as fc from "fast-check";
import {
  editTidyConfiguration,
  readTidyConfiguration,
  type TidyConfigurationPatch,
} from "../src/tidy/index";

it("edits only known JSON tokens, preserving BOM, CRLF and unknown numeric spellings", () => {
  const source =
    '\uFEFF{\r\n  "version": 1,\r\n  "future": [9007199254740993, -0, 1e400],\r\n  "rules": {"future-rule":{"keep":"a \\" } ] value"}}\r\n}\r\n';
  const output = editTidyConfiguration(source, {
    preset: "github",
    onSave: true,
    keepHardBreaks: false,
    rules: { "heading-space": false, "bare-urls": true },
  });
  expect(output.startsWith("\uFEFF")).toBe(true);
  expect(output).toContain('"future": [9007199254740993, -0, 1e400]');
  expect(output).toContain('"future-rule":{"keep":"a \\" } ] value"}');
  expect(output.replace(/\r\n/g, "")).not.toContain("\n");
  expect(readTidyConfiguration(output.slice(1))).toMatchObject({
    preset: "github",
    onSave: true,
    keepHardBreaks: false,
    rules: {
      "heading-space": false,
      "bare-urls": true,
      "future-rule": { keep: 'a " } ] value' },
    },
  });
});

it.each(["\n", "\r\n", "\r"])(
  "adds rules to a multiline empty object while retaining %j endings",
  (eol) => {
    const source = ["{", '  "version": 1,', '  "rules": {', "  }", "}"].join(
      eol,
    );
    const output = editTidyConfiguration(source, {
      rules: { "table-align": false, "bare-urls": true },
    });
    expect(readTidyConfiguration(output).rules).toEqual({
      "table-align": false,
      "bare-urls": true,
    });
    expect(output.replaceAll(eol, "")).not.toMatch(/[\r\n]/);
  },
);

it("locates escaped keys and changes the last duplicate property without rewriting earlier text", () => {
  const source =
    '{"version":1,"preset":"github","future":[{"x":"} ] \\""}],"\\u0070reset":"slate","rules":{"heading-space":true,"heading-space":false}}';
  const output = editTidyConfiguration(source, {
    preset: "minimal",
    rules: { "heading-space": true },
  });
  expect(output).toBe(
    source
      .replace('"\\u0070reset":"slate"', '"\\u0070reset":"minimal"')
      .replace('"heading-space":false', '"heading-space":true'),
  );
  expect(readTidyConfiguration(output)).toMatchObject({
    preset: "minimal",
    rules: { "heading-space": true },
  });
});

it("leaves unchanged requests byte-identical and creates explicit defaults only for missing source", () => {
  const source =
    ' \n{ "version":1, "onSave":false, "preset":"slate", "rules":{} }\t';
  expect(editTidyConfiguration(source, {})).toBe(source);
  expect(editTidyConfiguration(source, { rules: {} })).toBe(source);
  expect(
    editTidyConfiguration(source, { preset: "slate", onSave: false }),
  ).toBe(source);
  expect(
    readTidyConfiguration(
      editTidyConfiguration(undefined, { rules: { "heading-space": false } }),
    ),
  ).toMatchObject({ onSave: false, rules: { "heading-space": false } });
});

it.each([
  "{broken",
  '{"version":2}',
  '{"version":1,"rules":null}',
  '{"version":1,"onSave":null}',
])("refuses to patch unreadable configuration: %s", (source) => {
  expect(() => editTidyConfiguration(source, { onSave: true })).toThrow();
});

it.each([
  { future: true },
  { onSave: "yes" },
  { preset: "future" },
  { rules: null },
  { rules: [] },
  { rules: { "heading-space": "no" } },
  { rules: { "future-rule": false } },
])(
  "rejects invalid configuration changes without returning rewritten source: %j",
  (patch) => {
    expect(() =>
      editTidyConfiguration(
        '{"version":1,"future":9007199254740993}',
        patch as unknown as TidyConfigurationPatch,
      ),
    ).toThrow();
  },
);

it("preserves arbitrary future JSON values while independently overriding requested conventions", () => {
  fc.assert(
    fc.property(
      fc.jsonValue(),
      fc.boolean(),
      fc.constantFrom("slate", "github", "minimal"),
      (future, enabled, preset) => {
        const raw = JSON.stringify(future);
        const expected: unknown = JSON.parse(raw);
        const source =
          '{"version":1,"future":' +
          raw +
          ',"rules":{"future-rule":' +
          raw +
          "}}";
        const output = editTidyConfiguration(source, {
          preset,
          rules: { "table-align": enabled },
          onSave: enabled,
        });
        const parsed = JSON.parse(output) as {
          future: unknown;
          rules: Record<string, unknown>;
          preset: string;
          onSave: boolean;
        };
        expect(parsed.future).toEqual(expected);
        expect(parsed.rules["future-rule"]).toEqual(expected);
        expect(output).toContain('"future":' + raw);
        expect(output).toContain('"future-rule":' + raw);
        expect(parsed.preset).toBe(preset);
        expect(parsed.onSave).toBe(enabled);
        expect(parsed.rules["table-align"]).toBe(enabled);
        expect(
          editTidyConfiguration(output, {
            preset,
            rules: { "table-align": enabled },
            onSave: enabled,
          }),
        ).toBe(output);
      },
    ),
    { seed: 20261119, numRuns: 300 },
  );
});
