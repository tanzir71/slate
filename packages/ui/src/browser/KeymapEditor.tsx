import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import {
  editKeymapSource,
  readKeymapSource,
  resetKeymapSource,
  resolveCommandKeymap,
  type ShortcutProfile,
} from "@slate/core";
import { commandShortcut, workspaceCommands } from "../commands";
import { WorkspaceDialog } from "./WorkspaceDialog";
import type { WorkspaceStore } from "./workspaceStore";
import {
  keymapPath,
  loadKeymapFile,
  saveKeymapFile,
  type KeymapFile,
} from "./keymapFile";
import "../keymapEditor.css";

export default function KeymapEditor({
  store,
  profile,
  onClose,
  onSaved,
}: {
  store: WorkspaceStore;
  profile: ShortcutProfile;
  onClose(): void;
  onSaved(source: Uint8Array): void;
}) {
  const owned = useStore(store.api, (state) => state.owned);
  const [base, setBase] = useState<KeymapFile>(),
    [source, setSource] = useState(""),
    [query, setQuery] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [json, setJson] = useState(false);
  const saving = useRef(false),
    generation = useRef(0);
  const commands = workspaceCommands(profile.surface);
  const defaults = resolveCommandKeymap(profile, undefined, commands);
  let configuration: ReturnType<typeof readKeymapSource> | undefined;
  let issues: string[] = [];
  try {
    configuration = readKeymapSource(source);
    issues = resolveCommandKeymap(profile, configuration, commands).issues.map(
      (issue) =>
        `${commands.find((command) => command.id === issue.commandId)?.label ?? issue.commandId}: ${issue.message}`,
    );
  } catch (cause) {
    issues = [cause instanceof Error ? cause.message : String(cause)];
  }
  async function load() {
    const current = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const file = await loadKeymapFile(store);
      if (current !== generation.current) return;
      setBase(file);
      setSource(file.source);
      try {
        readKeymapSource(file.source);
        setJson(false);
      } catch {
        setJson(true);
      }
    } catch (cause) {
      if (current === generation.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [store]);
  function change(id: string, shortcut: string | null | undefined) {
    setSource(editKeymapSource(source, id, shortcut));
    setError("");
  }
  async function save() {
    if (!base || !owned || busy || saving.current || issues.length) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await saveKeymapFile(store, base, source, profile);
      if (result.conflict)
        setError(
          `The keymap changed elsewhere. Your proposal is preserved in ${result.path}. Reload the disk copy to review it.`,
        );
      else onSaved(new TextEncoder().encode(source));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <WorkspaceDialog
      title="Customize shortcuts"
      className="keymapEditor"
      busy={busy}
      onClose={onClose}
    >
      <p>
        Shortcuts for{" "}
        {profile.os === "mac"
          ? "macOS"
          : profile.os === "windows"
            ? "Windows"
            : "Linux"}{" "}
        · {profile.surface === "web" ? "Browser" : "Desktop"}. Saved in this
        Space’s <code>{keymapPath}</code>. Use Mod for Ctrl on Windows/Linux and
        Command on macOS.
      </p>
      {!owned && (
        <p role="status">
          This Space is read-only. Choose Use here in the workspace to edit
          shortcuts.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <fieldset disabled={!base || !owned || busy}>
        {base && !base.readable ? (
          <>
            <p role="alert">
              This keymap is not valid UTF-8. Its original bytes are kept until
              you explicitly save a replacement.
            </p>
            <button
              onClick={() => {
                setBase({ ...base, readable: true });
                setSource(
                  JSON.stringify(readKeymapSource(undefined), null, 2) + "\n",
                );
              }}
            >
              Replace unreadable keymap with defaults
            </button>
          </>
        ) : (
          <>
            <div className="keymapEditorTools">
              <label>
                Search commands
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <button aria-pressed={json} onClick={() => setJson(!json)}>
                {json ? "Show command fields" : "Edit JSON"}
              </button>
              <button
                disabled={!configuration}
                onClick={() => {
                  setSource(resetKeymapSource(source));
                  setError("");
                }}
              >
                Restore all defaults
              </button>
            </div>
            {json || !configuration ? (
              <label>
                Keymap JSON
                <textarea
                  spellCheck={false}
                  rows={16}
                  value={source}
                  onChange={(event) => {
                    setSource(event.target.value);
                    setError("");
                  }}
                />
              </label>
            ) : (
              <div className="keymapEditorRows">
                {commands
                  .filter((command) =>
                    `${command.label} ${command.group} ${command.id}`
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                  )
                  .map((command) => {
                    const custom = Object.hasOwn(
                        configuration!.bindings,
                        command.id,
                      ),
                      value = configuration!.bindings[command.id];
                    const fallback =
                      defaults.bindings.find(
                        (binding) => binding.command.id === command.id,
                      )?.shortcut ?? "";
                    return (
                      <div className="keymapEditorRow" key={command.id}>
                        <label>
                          {command.label}
                          <input
                            aria-label={`Shortcut for ${command.label}`}
                            placeholder={
                              commandShortcut(
                                command.id,
                                defaults,
                                profile.os,
                              ) || "Unassigned"
                            }
                            value={custom ? (value ?? "") : fallback}
                            onChange={(event) =>
                              change(
                                command.id,
                                event.target.value.trim() || null,
                              )
                            }
                          />
                        </label>
                        <button
                          aria-label={`Unbind ${command.label}`}
                          onClick={() => change(command.id, null)}
                        >
                          Unbind
                        </button>
                        <button
                          aria-label={`Restore ${command.label}`}
                          disabled={!custom}
                          onClick={() => change(command.id, undefined)}
                        >
                          Default
                        </button>
                      </div>
                    );
                  })}
              </div>
            )}
            {!!base && !!issues.length && (
              <ul role="alert" aria-label="Shortcut conflicts">
                {issues.map((issue, index) => (
                  <li key={index}>{issue}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </fieldset>
      <footer>
        <button disabled={busy} onClick={() => void load()}>
          Reload disk copy
        </button>
        <span />
        <button disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          className="primaryButton"
          disabled={busy || !owned || !base?.readable || issues.length > 0}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save shortcuts"}
        </button>
      </footer>
    </WorkspaceDialog>
  );
}
