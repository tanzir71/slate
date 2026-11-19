import { expect, it } from "vitest";
import { lint } from "@slate/core/tidy";
import { tidyPreviews } from "../src/tidy/tidyPreviews";

it("shows the actual individual edit with original Unicode/CRLF line coordinates", () => {
  const source = "বাংলা 🙂\r\n#   Title\r\n";
  const previews = tidyPreviews(lint(source), 100);
  const heading = previews.find((item) => item.issue.rule === "heading-space");
  expect(heading).toMatchObject({
    before: "#   Title",
    after: "# Title",
    issue: { line: 2 },
  });
});
it("bounds large-line excerpts around the issue and respects the requested visible limit", () => {
  const source = "x".repeat(100_000) + "\tword\n";
  const report = lint(source);
  const preview = tidyPreviews(report, 1)[0]!;
  expect(preview.before.length).toBeLessThanOrEqual(182);
  expect(preview.before).toContain("word");
  expect(preview.before.startsWith("…")).toBe(true);
  expect(preview.after).toContain(" word");
  expect(tidyPreviews(report, 0)).toEqual([]);
});
it("keeps manual and multiline proposals descriptive instead of displaying an invented local diff", () => {
  const report = lint(
    "### Heading\n\n```\nliteral\n```\n\na|b\n---|---\nxx|y\n",
  );
  const previews = tidyPreviews(report, 100);
  expect(
    previews.find((item) => item.issue.rule === "fence-language")?.after,
  ).toBeUndefined();
  expect(
    previews.find((item) => item.issue.rule === "table-align")?.after,
  ).toBeUndefined();
});
