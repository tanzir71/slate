import { describe, expect, it } from "vitest";
import { checkThemeContrast, contrastRatio, resolveTheme, themeColors, themeDeclarations } from "../src/themes";

describe("paper and graphite themes", () => {
  it("meets WCAG AA for the handover's text/surface pairs in both themes", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBe(21);
    expect(contrastRatio("#FFFFFF", "#000000")).toBe(21);
    expect(contrastRatio("#93918B", "#1B1B1A")).toBeGreaterThan(4.5);
    expect(checkThemeContrast()).toEqual([]);
  });

  it("uses system appearance only when the user selected System", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("exports each theme as CSS variables with exactly the same token names", () => {
    expect(Object.keys(themeColors.dark).sort()).toEqual(Object.keys(themeColors.light).sort());
    expect(themeDeclarations("light")).toContain("--bg-canvas:#FFFFFF");
    expect(themeDeclarations("dark")).toContain("--bg-canvas:#1B1B1A");
    expect(themeDeclarations("dark").split(";")).toHaveLength(Object.keys(themeColors.dark).length);
    expect(() => contrastRatio("white", "#000000")).toThrow("six-digit color");
  });
});
