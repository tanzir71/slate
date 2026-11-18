import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import {
  Table2,
  Heading1,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Code2,
  Hash,
  Link2,
  Image,
  CalendarDays,
  Clock,
  Minus,
  Braces,
  FileText,
} from "lucide-react";
import type { BlockDefinition } from "@slate/core";
import type { BlockMenuAnchor } from "./blockMenuController";
import { BlockPreview } from "./BlockPreview";

const icons = {
  table: Table2,
  heading1: Heading1,
  heading2: Heading1,
  heading3: Heading1,
  bullet: List,
  ordered: ListOrdered,
  task: ListTodo,
  quote: Quote,
  codeblock: Code2,
  tag: Hash,
  wiki: Link2,
  embed: Link2,
  image: Image,
  date: CalendarDays,
  time: Clock,
  divider: Minus,
  frontmatter: Braces,
};

export function BlockMenu({
  anchor,
  results,
  active,
  markdown,
  listId,
  onSelect,
  onInsert,
  onKey,
  previewRef,
  previewing,
}: {
  anchor: BlockMenuAnchor;
  results: readonly BlockDefinition[];
  active: BlockDefinition | undefined;
  markdown: string;
  listId: string;
  onSelect(id: string): void;
  onInsert(id: string): void;
  onKey(event: KeyboardEvent): void;
  previewRef: React.RefObject<HTMLElement | null>;
  previewing: boolean;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({
    left: anchor.rect.left,
    top: anchor.rect.bottom + 8,
  });
  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const place = () => {
      const bounds = element.getBoundingClientRect();
      const viewport = window.visualViewport;
      const x = viewport?.offsetLeft ?? 0;
      const y = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      setPosition({
        left: Math.max(
          x + 8,
          Math.min(anchor.rect.left, x + width - bounds.width - 8),
        ),
        top: Math.max(
          y + 8,
          Math.min(
            anchor.rect.bottom + 8 + bounds.height <= y + height - 8
              ? anchor.rect.bottom + 8
              : anchor.rect.top - bounds.height - 8,
            y + height - bounds.height - 8,
          ),
        ),
      });
    };
    place();
    window.visualViewport?.addEventListener("resize", place);
    window.addEventListener("resize", place);
    const observer = new ResizeObserver(place);
    observer.observe(element);
    return () => {
      window.visualViewport?.removeEventListener("resize", place);
      window.removeEventListener("resize", place);
      observer.disconnect();
    };
  }, [anchor]);
  useLayoutEffect(() => {
    menu.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [active?.id]);
  return createPortal(
    <div
      ref={menu}
      className="slateBlockMenu"
      data-preview={previewing}
      role="dialog"
      aria-label="Insert block"
      style={position}
      onKeyDown={onKey}
    >
      <div className="blockMenuBody">
        <div
          className="blockMenuResults"
          id={listId}
          role="listbox"
          tabIndex={0}
          aria-label="Blocks"
        >
          {!results.length && (
            <p className="blockMenuEmpty">No blocks match “{anchor.query}”.</p>
          )}
          {results.map((block, index) => {
            const Icon = icons[block.id as keyof typeof icons] ?? FileText;
            return (
              <div key={block.id}>
                {(index === 0 || results[index - 1]?.group !== block.group) && (
                  <div className="blockMenuGroup" role="presentation">
                    {block.group}
                  </div>
                )}
                <button
                  type="button"
                  role="option"
                  tabIndex={-1}
                  id={`${listId}-${block.id}`}
                  aria-selected={active?.id === block.id}
                  className="blockMenuOption"
                  onPointerDown={(event) => event.preventDefault()}
                  onPointerMove={() => onSelect(block.id)}
                  onClick={() => onInsert(block.id)}
                >
                  <span className="blockMenuIcon">
                    <Icon size={16} strokeWidth={1.75} />
                  </span>
                  <span>
                    <strong>{block.label}</strong>
                    <small>{block.description}</small>
                  </span>
                </button>
              </div>
            );
          })}
        </div>
        <section
          ref={previewRef}
          className="blockMenuPreview"
          tabIndex={-1}
          aria-label="Block preview"
        >
          {active && (
            <>
              <header>
                <strong>{active.label}</strong>
                <span>GFM</span>
              </header>
              <small>MARKDOWN</small>
              <pre className="blockMarkdownPreview">
                <code>{markdown}</code>
              </pre>
              <small>PREVIEW</small>
              <BlockPreview markdown={markdown} />
            </>
          )}
        </section>
      </div>
      <footer>
        <span>
          <kbd>↑↓</kbd> navigate
        </span>
        <span>
          <kbd>Enter</kbd> insert
        </span>
        <span>
          <kbd>Tab</kbd> preview
        </span>
        <span>
          <kbd>Esc</kbd> close
        </span>
      </footer>
    </div>,
    document.body,
  );
}
