import { describe, expect, it } from "vitest";
import { placeSelectionToolbar } from "../src/selectionGeometry";

const viewport = { left: 0, right: 390, top: 0, bottom: 844 };
const size = { width: 320, height: 38 };
describe("selection toolbar placement", () => {
  it("centres above the selection and clamps within both viewport edges", () => {
    expect(
      placeSelectionToolbar(
        { left: 80, right: 140, top: 150, bottom: 175 },
        size,
        viewport,
      ),
    ).toEqual({ left: 8, top: 104 });
    expect(
      placeSelectionToolbar(
        { left: 340, right: 380, top: 150, bottom: 175 },
        size,
        viewport,
      ),
    ).toEqual({ left: 62, top: 104 });
  });
  it("uses the space below a selection near the top", () => {
    const rect = { left: 20, right: 200, top: 12, bottom: 36 };
    expect(placeSelectionToolbar(rect, size, viewport)).toEqual({
      left: 8,
      top: 44,
    });
  });
  it("hides when neither side fits, or the viewport is narrower than the toolbar", () => {
    expect(
      placeSelectionToolbar(
        { left: 10, right: 200, top: 20, bottom: 820 },
        size,
        viewport,
      ),
    ).toBeUndefined();
    expect(
      placeSelectionToolbar(
        { left: 10, right: 20, top: 100, bottom: 120 },
        { width: 400, height: 38 },
        viewport,
      ),
    ).toBeUndefined();
    expect(
      placeSelectionToolbar(
        { left: 10, right: 20, top: -100, bottom: -80 },
        size,
        viewport,
      ),
    ).toBeUndefined();
    expect(
      placeSelectionToolbar(
        { left: 10, right: 20, top: 900, bottom: 920 },
        size,
        viewport,
      ),
    ).toBeUndefined();
  });
  it("respects the visible viewport after mobile keyboard/zoom offsets", () => {
    const visible = { left: 50, right: 440, top: 300, bottom: 650 };
    const rect = { left: 60, right: 120, top: 320, bottom: 345 };
    expect(placeSelectionToolbar(rect, size, visible)).toEqual({
      left: 58,
      top: 353,
    });
  });
});
