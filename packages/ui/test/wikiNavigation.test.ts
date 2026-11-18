import { describe, expect, it } from "vitest";
import { sheets } from "../src/sampleData";
import { resolveWikiLinkSheetId } from "../src/SlateApp";

describe("wiki-link navigation", () => {
  it("resolves canonical paths for equal-titled native preview sheets", () => {
    const rows = [
      { ...sheets[0]!, id: "work", notebook: "Work", title: "Shared" },
      { ...sheets[0]!, id: "home", notebook: "Home", title: "Shared" },
    ];
    expect(resolveWikiLinkSheetId(rows, "Home/shared.md")).toBe("home");
    expect(resolveWikiLinkSheetId(rows, "./Work/shared")).toBe("work");
  });
  it("resolves wiki-link targets by title and stable id", () => {
    expect(resolveWikiLinkSheetId(sheets, "product vision")).toBe("product-vision");
    expect(
      resolveWikiLinkSheetId(
        [
          {
            ...sheets[1]!,
            id: "01J22222222222222222222222",
            title: "Renamed Product Vision"
          }
        ],
        "Product Vision",
        "01J22222222222222222222222"
      )
    ).toBe("01J22222222222222222222222");
    expect(resolveWikiLinkSheetId(sheets, "Missing Sheet")).toBeUndefined();
  });
});
