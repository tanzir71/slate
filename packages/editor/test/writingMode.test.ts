import { expect, it } from "vitest";
import { typewriterScrollTop } from "../src/writingMode";

it("places the actual caret centre at45% of the scroll viewport independently of its page offset", () => {
  expect(typewriterScrollTop(200, 100, 600, 450, 486)).toBe(298);
  expect(typewriterScrollTop(0, 0, 900, 387, 423)).toBe(0);
  expect(typewriterScrollTop(600, 80, 400, 400, 428)).toBe(754);
});
it("keeps a caret already at45% stationary and clamps scrolling above the document", () => {
  expect(typewriterScrollTop(250, 100, 600, 352, 388)).toBe(250);
  expect(typewriterScrollTop(10, 200, 600, 200, 236)).toBe(0);
});
