import { useLayoutEffect, useState, type RefObject } from "react";
import {
  Bold,
  Italic,
  Strikethrough,
  Code2,
  Link2,
  Highlighter,
  MessageSquare,
} from "lucide-react";
import {
  resolveCommandKeymap,
  slateCommands,
  type ResolvedKeymap,
} from "@slate/core";
import { commandShortcut, shortcutOS } from "./commands";
import { placeSelectionToolbar, type ToolbarRect } from "./selectionGeometry";
import "./selectionToolbar.css";

const inlineActions = [
  { id: "format.bold", icon: Bold },
  { id: "format.italic", icon: Italic },
  { id: "format.strike", icon: Strikethrough },
  { id: "format.code", icon: Code2 },
  { id: "format.link", icon: Link2 },
  { id: "format.highlight", icon: Highlighter },
  { id: "format.comment", icon: MessageSquare },
] as const;
const blockActions = slateCommands.filter((command) =>
  /^format\.(paragraph|heading[1-6]|ordered|bullet|task|quote|codeblock)$/.test(
    command.id,
  ),
);

interface SelectionToolbarProps {
  rect: ToolbarRect;
  toolbarRef: RefObject<HTMLDivElement | null>;
  keymap: ResolvedKeymap | undefined;
  onCommand: (id: string) => void;
  onEscape: () => void;
}

export function SelectionToolbar({
  rect,
  toolbarRef,
  keymap,
  onCommand,
  onEscape,
}: SelectionToolbarProps) {
  const [position, setPosition] = useState<{ left: number; top: number }>();
  const os = shortcutOS();
  const resolved = keymap ?? resolveCommandKeymap({ os, surface: "web" });
  useLayoutEffect(() => {
    const element = toolbarRef.current;
    if (!element) return;
    const measure = () => {
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0;
      const top = viewport?.offsetTop ?? 0;
      setPosition(
        placeSelectionToolbar(rect, element.getBoundingClientRect(), {
          left,
          top,
          right: left + (viewport?.width ?? window.innerWidth),
          bottom: top + (viewport?.height ?? window.innerHeight),
        }),
      );
    };
    measure();
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure);
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(measure);
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("scroll", measure);
    };
  }, [rect, toolbarRef]);

  return (
    <div
      ref={toolbarRef}
      role="toolbar"
      aria-label="Selection formatting"
      className="selectionToolbar"
      style={{
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        visibility: position ? "visible" : "hidden",
      }}
      onPointerDown={(event) => {
        if (event.target instanceof Element && event.target.closest("button"))
          event.preventDefault();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onEscape();
        }
        if (
          event.target instanceof HTMLSelectElement ||
          !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
        )
          return;
        const items = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>("button, select"),
        );
        const index = items.indexOf(event.target as HTMLElement);
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : (index + (event.key === "ArrowRight" ? 1 : items.length - 1)) %
                items.length;
        event.preventDefault();
        items[next]?.focus();
      }}
    >
      {inlineActions.map(({ id, icon: Icon }) => {
        const command = slateCommands.find((entry) => entry.id === id)!;
        const shortcut = commandShortcut(id, resolved, os);
        return (
          <button
            type="button"
            key={id}
            aria-label={command.label}
            title={`${command.label}${shortcut ? ` (${shortcut})` : ""}`}
            onClick={() => onCommand(id)}
          >
            <Icon size={16} />
          </button>
        );
      })}
      <span className="selectionToolbarDivider" aria-hidden="true" />
      <select
        aria-label="Turn selection into"
        title="Turn into"
        value=""
        onChange={(event) => onCommand(event.target.value)}
      >
        <option value="" disabled>
          Turn into
        </option>
        {blockActions.map((command) => (
          <option key={command.id} value={command.id}>
            {command.label}
          </option>
        ))}
      </select>
    </div>
  );
}
