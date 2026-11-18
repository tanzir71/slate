import { createElement, useMemo, type ReactNode } from "react";
import { parseMarkdownPreview, type MarkdownPreviewNode } from "@slate/core";

function renderNode(node: MarkdownPreviewNode, key: number): ReactNode {
  const children = node.children?.map(renderNode);
  switch (node.type) {
    case "root":
      return children;
    case "text":
      return node.value;
    case "paragraph":
      return <p key={key}>{children}</p>;
    case "heading":
      return createElement(`h${node.depth ?? 1}`, { key }, children);
    case "strong":
      return <strong key={key}>{children}</strong>;
    case "emphasis":
      return <em key={key}>{children}</em>;
    case "delete":
      return <del key={key}>{children}</del>;
    case "inlineCode":
      return <code key={key}>{node.value}</code>;
    case "code":
      return (
        <pre key={key}>
          <code>{node.value}</code>
        </pre>
      );
    case "blockquote":
      return <blockquote key={key}>{children}</blockquote>;
    case "list":
      return node.ordered ? (
        <ol key={key}>{children}</ol>
      ) : (
        <ul key={key}>{children}</ul>
      );
    case "listItem":
      return (
        <li key={key}>
          {node.checked != null && (
            <input
              aria-label="Task"
              type="checkbox"
              checked={node.checked}
              disabled
            />
          )}
          {children}
        </li>
      );
    case "thematicBreak":
      return <hr key={key} />;
    case "break":
      return <br key={key} />;
    case "table":
      return (
        <table key={key}>
          <thead>{renderRow(node.children?.[0], 0, true)}</thead>
          <tbody>
            {node.children
              ?.slice(1)
              .map((row, index) => renderRow(row, index, false))}
          </tbody>
        </table>
      );
    case "link":
      return (
        <a key={key} role="link" aria-disabled="true" tabIndex={-1}>
          {children}
        </a>
      );
    case "image":
      return <span key={key}>Image: {node.alt}</span>;
    case "html":
      return <code key={key}>{node.value}</code>;
    default:
      return children ?? node.value;
  }
}
function renderRow(
  node: MarkdownPreviewNode | undefined,
  key: number,
  header: boolean,
) {
  return (
    <tr key={key}>
      {node?.children?.map((cell, index) =>
        createElement(
          header ? "th" : "td",
          { key: index },
          cell.children?.map(renderNode),
        ),
      )}
    </tr>
  );
}

export function BlockPreview({ markdown }: { markdown: string }) {
  const tree = useMemo(() => parseMarkdownPreview(markdown), [markdown]);
  return <div className="blockRenderedPreview">{renderNode(tree, 0)}</div>;
}
