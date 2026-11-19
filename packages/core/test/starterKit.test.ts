import { expect, it } from "vitest";
import { starterKitRoot } from "../src/starterKit";

it("chooses one fresh root across notes, non-Markdown files, case variants and reserved notebooks", () => {
  expect(starterKitRoot("Work", ["Inbox/old.md"])).toBe("Work");
  expect(
    starterKitRoot(
      "Work",
      ["work/empty.md", "Work (1)/asset.png", "WORK (2)"],
      ["Work (3)/Meetings"],
    ),
  ).toBe("Work (4)");
  expect(starterKitRoot("Work", ["Work (2)/keep.md"], ["Work"])).toBe(
    "Work (1)",
  );
  expect(starterKitRoot("Work", ["Workshop/note.md"])).toBe("Work");
  expect(starterKitRoot("লেখা", [], ["লেখা/প্রথম"])).toBe("লেখা (1)");
});
it.each([
  "",
  ".slate",
  "..",
  "Work/Child",
  "Work\\Child",
  "Work/",
  " Work",
  "Work.",
  "CON",
  "x\n",
  "x".repeat(256),
])("refuses an unsafe kit root %j before producing paths", (name) => {
  expect(() => starterKitRoot(name, [])).toThrow();
});
it("does not mutate its occupied paths and checks a suffixed component's byte limit", () => {
  const paths = ["Work/old.md"];
  starterKitRoot("Work", paths);
  expect(paths).toEqual(["Work/old.md"]);
  expect(() => starterKitRoot("x".repeat(255), ["x".repeat(255)])).toThrow();
});
