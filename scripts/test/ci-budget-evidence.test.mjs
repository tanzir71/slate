import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const workflow = (
  await readFile(
    new URL("../../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  )
).replaceAll("\r\n", "\n");
const blocks = workflow.split(/^ {6}- /m).slice(1);
function step(name) {
  const block = blocks.find((block) => block.startsWith(`name: ${name}\n`));
  assert.ok(block, `Missing CI step: ${name}`);
  return Object.fromEntries(
    block
      .split("\n")
      .map((line) => line.trim().match(/^([\w-]+): (.+)$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2]]),
  );
}
const tidy = step("Verify Tidy worker budgets (Linux reference)");
const following = [
  [
    step("Verify block menu latency in fresh browsers (Linux reference)"),
    "pnpm perf:menu",
  ],
  [
    step("Verify typing budgets in fresh browsers (Linux reference)"),
    "pnpm perf:typing",
  ],
];

function runs(
  step,
  {
    os = "ubuntu-latest",
    outcome = "success",
    failed = false,
    cancelled = false,
  } = {},
) {
  const expression = step.if.replace(/^\$\{\{\s*|\s*\}\}$/g, "");
  // Actions adds success() unless the condition explicitly checks a status function.
  // These workflow conditions use the shared Boolean/string expression subset.
  if (
    !/\b(?:always|success|failure|cancelled)\(/.test(expression) &&
    (failed || cancelled)
  )
    return false;
  return runInNewContext(
    expression,
    {
      matrix: { os },
      steps: { [tidy.id]: { outcome } },
      always: () => true,
      success: () => !failed && !cancelled,
      failure: () => failed,
      cancelled: () => cancelled,
    },
    { timeout: 100 },
  );
}

test("Linux CI measures menu and typing after a failed worker budget or earlier budget", () => {
  for (const [step] of following) {
    assert.equal(
      runs(step, { outcome: "failure", failed: true }),
      true,
      `${step.name}: worker failure must retain subsequent evidence`,
    );
    assert.equal(
      runs(step, { outcome: "success", failed: true }),
      true,
      `${step.name}: another budget failure must not suppress this budget`,
    );
  }
});

test("remaining Linux budgets require an executed worker gate and honor cancellation and host scope", () => {
  assert.ok(tidy.id, "The worker gate must expose its execution outcome");
  assert.equal(
    runs(tidy, { failed: true }),
    false,
    "The first budget must still require preceding verification to pass",
  );
  for (const [step] of following) {
    assert.equal(runs(step), true);
    for (const outcome of ["", "skipped", "cancelled"])
      assert.equal(runs(step, { outcome }), false);
    assert.equal(runs(step, { cancelled: true }), false);
    for (const os of ["macos-latest", "windows-latest"])
      assert.equal(runs(step, { os, outcome: "failure", failed: true }), false);
  }
});

test("all Linux budgets remain mandatory, sequential, unfiltered release blockers", () => {
  const commands = [[tidy, "pnpm perf:tidy"], ...following];
  let previous = -1;
  for (const [step, command] of commands) {
    assert.equal(step.run, command);
    assert.notEqual(step["continue-on-error"], "true");
    const position = workflow.indexOf(`name: ${step.name}`);
    assert.ok(position > previous);
    previous = position;
  }
});
