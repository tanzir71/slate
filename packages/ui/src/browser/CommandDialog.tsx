import { useEffect, useRef, useState } from "react";
import { Keyboard, Search, X } from "lucide-react";
import {
  commandAvailable,
  commandsForSurface,
  parseShortcut,
  slateCommands,
  type CommandDefinition,
  type ResolvedKeymap,
  type ShortcutProfile,
  type ShortcutOS,
} from "@slate/core";
import { commandShortcut } from "../commands";
import "../commandDialog.css";

interface CommandDialogProps {
  kind: "palette" | "shortcuts";
  keymap: ResolvedKeymap;
  os: ShortcutOS;
  editor: boolean;
  selection: boolean;
  tableColumns?: number;
  onClose: () => void;
  onCommand: (id: string) => void;
  surface?: ShortcutProfile["surface"];
  registry?: readonly CommandDefinition[];
  onCustomize?: (() => void) | undefined;
}

export function CommandDialog({
  kind,
  keymap,
  os,
  editor,
  selection,
  tableColumns = 0,
  onClose,
  onCommand,
  surface = "web",
  registry = slateCommands,
  onCustomize,
}: CommandDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [previewOS, setPreviewOS] = useState(os);
  const displayed = { ...keymap, bindings: keymap.bindings.map(binding => ({ ...binding, chord: parseShortcut(binding.shortcut, previewOS) })) };
  const shortcuts = kind === "shortcuts";
  const title = shortcuts ? "Keyboard shortcuts" : "Command palette";
  const available = commandsForSurface(surface, registry);
  const commands = available.filter((command) =>
    `${command.label} ${command.group}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );

  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    search.current?.focus();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);

  function row(id: string) {
    const command = commands.find((entry) => entry.id === id)!;
    const label = commandShortcut(id, displayed, previewOS);
    return (
      <div className="shortcutRow" key={id}>
        <span>
          {command.label}
          {id === "format.link" && <small> (with selection)</small>}
        </span>
        {label ? <kbd>{label}</kbd> : <span className="quiet">—</span>}
      </div>
    );
  }

  const columns = [
    {
      title: "Essentials",
      entries: commands.filter(
        (command) => command.group === "Workspace" || command.group === "Help",
      ),
    },
    {
      title: "Format",
      entries: commands.filter((command) =>
        /^format\.(bold|italic|strike|highlight|code|comment|link|paragraph|heading[1-6])$/.test(
          command.id,
        ),
      ),
    },
    {
      title: "Blocks & view",
      entries: commands.filter(
        (command) =>
          command.group === "View" || command.group === "Table" ||
          command.group === "Edit" ||
          /^format\.(ordered|bullet|task|quote|codeblock|toggleTask)$/.test(
            command.id,
          ),
      ),
    },
  ];

  const searchField = (
    <label className="commandSearch">
      {shortcuts ? <ShortcutAsset icon="search" /> : <Search size={16} />}
      <input
        ref={search}
        aria-label={shortcuts ? "Search shortcuts" : "Search commands"}
        placeholder={shortcuts ? `Search ${available.length} commands` : "What would you like to do?"}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
    </label>
  );

  return (
    <dialog
      ref={dialog}
      className={`commandDialog ${shortcuts ? "shortcutDialog" : "paletteDialog"}`}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <h1>
          {shortcuts ? <ShortcutAsset icon="keyboard" /> : <Keyboard size={17} />}
          {title}
        </h1>
        {shortcuts ? <div className="shortcutProfileSwitch" role="group" aria-label="Shortcut platform preview">
          <button aria-pressed={previewOS !== "mac"} onClick={() => setPreviewOS(os === "linux" ? "linux" : "windows")}>Windows · Linux</button>
          <button aria-pressed={previewOS === "mac"} onClick={() => setPreviewOS("mac")}>macOS</button>
        </div> : <span className="shortcutProfile">{os === "mac" ? "macOS" : os === "windows" ? "Windows" : "Linux"} · {surface === "web" ? "Browser" : "Desktop"}</span>}
        {shortcuts && searchField}
        {shortcuts && onCustomize && <button className="shortcutCustomize" onClick={onCustomize}>Customize</button>}
        <button aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}>
          {shortcuts ? <ShortcutAsset icon="close" /> : <X size={18} />}
        </button>
      </header>
      {!shortcuts && searchField}
      {shortcuts ? (
        <div className="shortcutColumns" role="region" aria-label="Keyboard shortcut list" tabIndex={0} onKeyDown={(event) => {
          if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.nativeEvent.isComposing) return;
          const element = event.currentTarget, maximum = Math.max(0, element.scrollHeight - element.clientHeight);
          const page = Math.max(1, element.clientHeight - 32);
          const destination = event.key === "PageDown" ? element.scrollTop + page : event.key === "PageUp" ? element.scrollTop - page
            : event.key === "Home" ? 0 : event.key === "End" ? maximum : undefined;
          if (destination === undefined) return;
          // Keep paging inside the focused shortcut region across browser engines.
          event.preventDefault(); element.scrollTop = Math.min(maximum, Math.max(0, destination));
        }}>
          {columns
            .filter((column) => column.entries.length)
            .map((column) => (
              <section key={column.title}>
                <h2>{column.title}</h2>
                {column.entries.map((command) => row(command.id))}
              </section>
            ))}
        </div>
      ) : (
        <div className="commandResults">
          {commands
            .filter(
              (command) =>
                commandAvailable(command, { editor, selection, tableColumns }) &&
                command.id !== "app.palette",
            )
            .map((command) => (
              <button key={command.id} onClick={() => onCommand(command.id)}>
                <span>{command.label}</span>
                <kbd>{commandShortcut(command.id, keymap, os)}</kbd>
              </button>
            ))}
        </div>
      )}
      {!commands.length && (
        <p className="commandEmpty">No commands match. Try another search.</p>
      )}
      <footer>
        {shortcuts ? <><span>{onCustomize ? <>Every command is rebindable. Bindings live in <code>keymap.json</code> · conflicts are flagged before you save.<span className="shortcutProfile"> · {surface === "web" ? "Browser" : "Desktop"}</span></> : `Shortcuts for this ${surface === "web" ? "Browser" : "Desktop app"}`}</span><button className="shortcutPrint" onClick={() => window.print()}><ShortcutAsset icon="print" />Print cheat sheet</button></> : <>Shortcuts for this {surface === "web" ? "browser" : "desktop app"}<span>Esc to close</span></>}
      </footer>
    </dialog>
  );
}

function ShortcutAsset({ icon }: { icon: "keyboard" | "search" | "close" | "print" }) {
  return <span className="shortcutAsset" aria-hidden="true" data-shortcut-asset={icon} />;
}
