import { expect, it } from "vitest";
import {
  notebookTemplate,
  readWorkspacePreferences,
  withNotebookTemplate,
} from "../src/workspacePreferences";

it("keeps notebook defaults optional for existing version-1 preferences", () => {
  const preferences = readWorkspacePreferences();
  expect(preferences.notebookTemplates).toBeUndefined();
  expect(notebookTemplate(preferences, "Work")).toBeUndefined();
});
it("retains exact notebook references, Unicode, unknown IDs and unrelated preferences", () => {
  const value = {
    version: 1,
    notebookTemplates: {
      Work: "builtin:meeting-notes",
      "বাংলা/নোট": ".slate/templates/Custom note.md",
      Later: "future:template",
    },
    future: { keep: true },
  };
  const preferences = readWorkspacePreferences(value);
  expect(notebookTemplate(preferences, "Work")).toBe("builtin:meeting-notes");
  expect(notebookTemplate(preferences, "Work/Child")).toBeUndefined();
  expect(notebookTemplate(preferences, "বাংলা/নোট")).toBe(
    ".slate/templates/Custom note.md",
  );
  expect(preferences.future).toEqual({ keep: true });
  expect(preferences.notebookTemplates).not.toBe(value.notebookTemplates);
});
it("sets and removes one default without mutating other settings or its input", () => {
  const original = readWorkspacePreferences({
    version: 1,
    pinned: ["note.md"],
    notebookTemplates: { Work: "builtin:prd", Home: "builtin:daily-note" },
    future: true,
  });
  const changed = withNotebookTemplate(
    original,
    "Work",
    ".slate/templates/kickoff.md",
  );
  expect(notebookTemplate(changed, "Work")).toBe(".slate/templates/kickoff.md");
  expect(notebookTemplate(original, "Work")).toBe("builtin:prd");
  const removed = withNotebookTemplate(changed, "Work", undefined);
  expect(removed.notebookTemplates).toEqual({ Home: "builtin:daily-note" });
  expect(removed.pinned).toEqual(["note.md"]);
  expect(removed.future).toBe(true);
});
it("does not interpret inherited properties as template references", () => {
  const preferences = readWorkspacePreferences({
    version: 1,
    notebookTemplates: {},
  });
  expect(notebookTemplate(preferences, "constructor")).toBeUndefined();
  expect(notebookTemplate(preferences, "__proto__")).toBeUndefined();
  const changed = withNotebookTemplate(
    preferences,
    "__proto__",
    "builtin:readme",
  );
  expect(notebookTemplate(changed, "__proto__")).toBe("builtin:readme");
  expect(Object.getPrototypeOf(changed.notebookTemplates)).toBe(
    Object.prototype,
  );
  expect(
    notebookTemplate(
      withNotebookTemplate(changed, "__proto__", undefined),
      "__proto__",
    ),
  ).toBeUndefined();
});
it.each([null, [], "builtin:prd", { Work: 42 }, { Work: "" }])(
  "rejects malformed default maps without replacing them: %j",
  (notebookTemplates) => {
    expect(() =>
      readWorkspacePreferences({ version: 1, notebookTemplates }),
    ).toThrow(/notebookTemplates/);
  },
);
it.each(["../outside", ".slate/templates", "Work\\Child", "Work/", "/Work"])(
  "refuses a noncanonical notebook path when setting a default: %s",
  (notebook) => {
    expect(() =>
      withNotebookTemplate(readWorkspacePreferences(), notebook, "builtin:prd"),
    ).toThrow();
  },
);
it("rejects an empty reference and supports a Space-root default", () => {
  expect(() =>
    withNotebookTemplate(readWorkspacePreferences(), "Work", ""),
  ).toThrow();
  const preferences = withNotebookTemplate(
    readWorkspacePreferences(),
    "",
    "builtin:readme",
  );
  expect(notebookTemplate(preferences, "")).toBe("builtin:readme");
});
