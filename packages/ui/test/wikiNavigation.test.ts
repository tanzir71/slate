import { describe, expect, it } from "vitest";
import { sheets } from "../src/sampleData";
import { resolveWikiLinkSheetId } from "../src/SlateApp";

describe("wiki-link navigation", () => {
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
