import { describe, expect, it } from "vitest";
import { createExportRegistry, createHtmlExportAdapter, type ExportDocument } from "../src/index";

const document: ExportDocument = {
  title: "Launch <Plan>",
  markdown: "# Launch <Plan>\n\nShip **calmly**.\n\n<script>bad()</script>\n",
  tags: ["release"]
};

describe("export adapters", () => {
  it("exports a themeable HTML artifact through the registry", async () => {
    const registry = createExportRegistry([createHtmlExportAdapter()]);

    const artifact = await registry.exportDocument({
      format: "html",
      document,
      theme: {
        name: "Print",
        css: ".slate-export { color: rebeccapurple; }"
      }
    });

    expect(artifact.format).toBe("html");
    expect(artifact.filename).toBe("launch-plan.html");
    expect(artifact.mimeType).toBe("text/html");
    expect(artifact.warnings).toEqual([]);
    expect(artifact.content).toContain("<h1>Launch &lt;Plan&gt;</h1>");
    expect(artifact.content).toContain("Ship <strong>calmly</strong>.");
    expect(artifact.content).toContain(".slate-export { color: rebeccapurple; }");
    expect(artifact.content).not.toContain("<script>bad()</script>");
  });

  it("rejects an unsupported export format", async () => {
    const registry = createExportRegistry([]);

    await expect(registry.exportDocument({ format: "pdf", document })).rejects.toThrow(
      "No export adapter registered for pdf"
    );
  });
});
