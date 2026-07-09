export type ExportFormat = "pdf" | "docx" | "html" | "epub";

export interface ExportDocument {
  title: string;
  markdown: string;
  id?: string;
  path?: string;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ExportTheme {
  name: string;
  css?: string;
  variables?: Record<string, string>;
}

export interface ExportRequest {
  format: ExportFormat;
  document: ExportDocument;
  theme?: ExportTheme;
  filename?: string;
}

export interface ExportArtifact {
  format: ExportFormat;
  filename: string;
  mimeType: string;
  content: string | Uint8Array;
  warnings: string[];
}

export interface ExportAdapter {
  format: ExportFormat;
  exportDocument(request: ExportRequest): Promise<ExportArtifact>;
}

export interface ExportRegistry {
  formats(): ExportFormat[];
  exportDocument(request: ExportRequest): Promise<ExportArtifact>;
}

export function createExportRegistry(adapters: ExportAdapter[]): ExportRegistry {
  const byFormat = new Map<ExportFormat, ExportAdapter>();

  for (const adapter of adapters) {
    if (byFormat.has(adapter.format)) {
      throw new Error(`Duplicate export adapter registered for ${adapter.format}`);
    }
    byFormat.set(adapter.format, adapter);
  }

  return {
    formats() {
      return Array.from(byFormat.keys()).sort();
    },
    async exportDocument(request) {
      const adapter = byFormat.get(request.format);
      if (!adapter) {
        throw new Error(`No export adapter registered for ${request.format}`);
      }
      return adapter.exportDocument(request);
    }
  };
}

export function createHtmlExportAdapter(): ExportAdapter {
  return {
    format: "html",
    async exportDocument(request) {
      return {
        format: "html",
        filename: request.filename ?? `${slugify(request.document.title)}.html`,
        mimeType: "text/html",
        content: renderHtmlDocument(request.document, request.theme),
        warnings: []
      };
    }
  };
}

function renderHtmlDocument(document: ExportDocument, theme: ExportTheme | undefined): string {
  const title = escapeHtml(document.title);
  const themeCss = renderThemeCss(theme);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
${baseCss}
${themeCss}
  </style>
</head>
<body>
  <article class="slate-export">
${renderMarkdownBlocks(document.markdown)}
  </article>
</body>
</html>
`;
}

const baseCss = `.slate-export {
  max-width: 72ch;
  margin: 0 auto;
  padding: 48px 24px;
  color: var(--slate-export-text, #18212f);
  font: 18px/1.65 var(--slate-export-font, Georgia, "Times New Roman", serif);
}

.slate-export h1,
.slate-export h2,
.slate-export h3 {
  line-height: 1.2;
}

.slate-export code {
  font-family: var(--slate-export-mono, "SF Mono", "Cascadia Code", monospace);
}`;

function renderThemeCss(theme: ExportTheme | undefined): string {
  if (!theme) {
    return "";
  }

  const variables = Object.entries(theme.variables ?? {})
    .map(([name, value]) => `  --${name.replace(/^--/, "")}: ${value};`)
    .join("\n");
  const variableBlock = variables ? `.slate-export {\n${variables}\n}` : "";

  return [variableBlock, theme.css ?? ""].filter(Boolean).join("\n");
}

function renderMarkdownBlocks(markdown: string): string {
  return markdown
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map(renderBlock)
    .join("\n");
}

function renderBlock(block: string): string {
  const heading = block.match(/^(#{1,3})\s+(.+)$/);
  if (heading?.[1] && heading[2]) {
    const level = heading[1].length;
    return `    <h${level}>${renderInline(heading[2])}</h${level}>`;
  }

  const lines = block.split(/\r?\n/);
  if (lines.every((line) => line.startsWith("- "))) {
    const items = lines.map((line) => `      <li>${renderInline(line.slice(2))}</li>`).join("\n");
    return `    <ul>\n${items}\n    </ul>`;
  }

  return `    <p>${renderInline(lines.join(" "))}</p>`;
}

function renderInline(markdown: string): string {
  return escapeHtml(markdown)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, display: string | undefined) => {
      return display ?? target;
    });
}

function slugify(title: string): string {
  return (
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "untitled"
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
