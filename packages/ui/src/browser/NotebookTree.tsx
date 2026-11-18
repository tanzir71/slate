import { ChevronDown, ChevronRight, Folder } from "lucide-react";

interface NotebookNode {
  path: string;
  name: string;
  children: NotebookNode[];
}
function notebookTree(paths: readonly string[]): NotebookNode[] {
  const roots: NotebookNode[] = [];
  const nodes = new Map<string, NotebookNode>();
  for (const path of paths) {
    const parts = path.split("/");
    for (let index = 0; index < parts.length; index++) {
      const current = parts.slice(0, index + 1).join("/");
      if (nodes.has(current)) continue;
      const node = { path: current, name: parts[index]!, children: [] };
      nodes.set(current, node);
      const parent = nodes.get(parts.slice(0, index).join("/"));
      (parent?.children ?? roots).push(node);
    }
  }
  return roots;
}

interface NotebookTreeProps {
  paths: readonly string[];
  sheetPaths: readonly string[];
  selected: string;
  collapsed: ReadonlySet<string>;
  onToggle(path: string): void;
  onSelect(path: string): void;
  onMove(path: string, notebook: string): void;
  onTemplate?: ((path: string) => void) | undefined;
}
export function NotebookTree(props: NotebookTreeProps) {
  return (
    <ul className="notebookTree">
      {notebookTree(props.paths).map((node) => (
        <NotebookBranch key={node.path} node={node} depth={0} {...props} />
      ))}
    </ul>
  );
}
function NotebookBranch({
  node,
  depth,
  ...props
}: NotebookTreeProps & { node: NotebookNode; depth: number }) {
  const open = !props.collapsed.has(node.path);
  const count = props.sheetPaths.filter((path) =>
    path.startsWith(`${node.path}/`),
  ).length;
  return (
    <li>
      <div
        className={`notebookBranch ${props.selected === node.path ? "selected" : ""}`}
        style={{ paddingInlineStart: 6 + depth * 16 }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          const path = event.dataTransfer.getData("slate/sheet-path");
          if (path) {
            event.preventDefault();
            event.stopPropagation();
            props.onMove(path, node.path);
          }
        }}
      >
        {node.children.length ? (
          <button
            className="notebookDisclosure"
            aria-label={`${open ? "Collapse" : "Expand"} ${node.path}`}
            aria-expanded={open}
            onClick={() => props.onToggle(node.path)}
          >
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="notebookDisclosure" />
        )}
        <button
          className="notebookLabel"
          aria-label={`Notebook ${node.path}`}
          title={node.path}
          aria-current={props.selected === node.path ? "page" : undefined}
          aria-description={props.onTemplate ? "Press Shift F10 to set a default template for this notebook." : undefined}
          onClick={() => props.onSelect(node.path)}
          onContextMenu={(event) => {
            if (!props.onTemplate) return;
            event.preventDefault(); event.currentTarget.focus(); props.onTemplate(node.path);
          }}
          onKeyDown={(event) => {
            if (props.onTemplate && (event.key === "ContextMenu" || event.key === "F10" && event.shiftKey)) {
              event.preventDefault(); event.stopPropagation(); props.onTemplate(node.path);
            }
          }}
        >
          <Folder size={16} />
          <span>{node.name}</span>
          <small>{count}</small>
        </button>
      </div>
      {open && !!node.children.length && (
        <ul>
          {node.children.map((child) => (
            <NotebookBranch
              key={child.path}
              node={child}
              depth={depth + 1}
              {...props}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
