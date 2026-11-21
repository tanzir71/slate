import { expect, it } from "vitest";
import { renderMath } from "../src/mathRender";
import type { RichRenderRequest } from "../src/richPreviewProtocol";
const request = (body: string, display = false): RichRenderRequest => ({ id: 7, kind: "math", body, display, theme: "light" });

it.each([false, true])("renders real KaTeX MathML with readable fractions and original TeX annotation (display %s)", display => {
  const result = renderMath(request(String.raw`\frac{a_1}{b^2}`, display));
  expect(result.id).toBe(7); expect("result" in result).toBe(true);
  if (!("result" in result)) throw Error(result.error);
  expect(result.result.html).toContain("<math"); expect(result.result.html).toContain("<mfrac>");
  expect(result.result.html).toContain('<annotation encoding="application/x-tex">');
  expect(result.result.html.includes('display="block"')).toBe(display);
});

it.each([String.raw`\href{javascript:alert(1)}{click}`, String.raw`\includegraphics{https://images.invalid/a.png}`, String.raw`\htmlClass{unsafe}{x}`])("keeps untrusted TeX from producing active links, images or arbitrary HTML: %s", body => {
  const result = renderMath(request(body));
  if ("result" in result) expect(result.result.html).not.toMatch(/<(?:a|img|script|iframe)\b|\son\w+=/i);
  else expect(result.error).toBe("Math preview unavailable");
});

it("bounds recursive macros, oversized input and malformed formulas with a source fallback", () => {
  for (const body of [String.raw`\def\loop{\loop}\loop`, "x".repeat(20_001), String.raw`\frac{`])
    expect(renderMath(request(body))).toEqual({ id: 7, error: "Math preview unavailable" });
});

it("does not allow a macro definition to escape into the next formula", () => {
  expect(renderMath(request(String.raw`\gdef\slateleak{x}\slateleak`))).toHaveProperty("result");
  expect(renderMath(request(String.raw`\slateleak`))).toEqual({ id: 7, error: "Math preview unavailable" });
});
