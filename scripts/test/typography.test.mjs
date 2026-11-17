import { test } from "node:test";
import assert from "node:assert/strict";
import stylelint from "stylelint";
import plugin from "../stylelint-no-ui-italics.mjs";

async function warnings(code) {
  const result = await stylelint.lint({ code, config: { plugins: [plugin], rules: { "slate/no-ui-italics": true } } });
  return result.results.flatMap((item) => item.warnings);
}

test("rejects italic chrome, marketing, empty states and shorthand", async () => {
  for (const code of [".empty {font-style: italic}", ".hero {font: italic 80px Newsreader}", ".menu {font-style: oblique 10deg}", ".cm-content-toolbar {font-style: italic}", ".cm-content em, .menu {font-style: italic}", ".cm-content + .menu {font-style: italic}"]) {
    assert.equal((await warnings(code)).length, 1, code);
  }
});

test("allows upright UI, real editor/read emphasis and an italic font-face", async () => {
  const code = ".menu {font-weight: 600; font-style: normal} .cm-content em, .read-view em {font-style: italic} .cm-content {em {font-style: italic}} @font-face {font-family: Newsreader; font-style: italic; src: url(local.woff2)}";
  assert.deepEqual(await warnings(code), []);
});
