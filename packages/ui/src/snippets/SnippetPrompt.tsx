import { useEffect, useMemo, useRef, useState } from "react";
import { renderSnippetTemplate } from "@slate/core";
import { WorkspaceDialog } from "../browser/WorkspaceDialog";
import type { PreparedSnippet } from "./snippetSession";
import "./snippets.css";

export default function SnippetPrompt({
  request,
  onClose,
}: {
  request: PreparedSnippet;
  onClose(): void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      request.analysis.prompts.map((prompt) => [
        prompt.label,
        prompt.defaultValue ?? "",
      ]),
    ),
  );
  const [clipboard, setClipboard] = useState(""),
    [error, setError] = useState(""),
    [reading, setReading] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const rendered = useMemo(() => {
    try {
      return {
        value: renderSnippetTemplate(request.template, {
          ...request.context,
          prompts: answers,
          clipboard,
        }),
        error: "",
      };
    } catch (cause) {
      return {
        value: undefined,
        error: cause instanceof Error ? cause.message : String(cause),
      };
    }
  }, [request, answers, clipboard]);
  async function readClipboard() {
    setReading(true);
    try {
      if (!navigator.clipboard?.readText)
        throw new Error(
          "Clipboard access is unavailable. Paste its text below.",
        );
      const value = await navigator.clipboard.readText();
      if (alive.current) {
        setClipboard(value);
        setError("");
      }
    } catch {
      if (alive.current)
        setError("Clipboard access is unavailable. Paste its text below.");
    } finally {
      if (alive.current) setReading(false);
    }
  }
  return (
    <WorkspaceDialog
      title={`Insert ${request.definition.name}`}
      className="snippetPrompt"
      returnFocus={request.target.element}
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!rendered.value) return;
          if (!request.target.insert(rendered.value)) {
            setError(
              "The sheet changed or is read-only. Close this dialog and choose the snippet again.",
            );
            return;
          }
          onClose();
        }}
      >
        {request.analysis.prompts.map((prompt) => (
          <label key={prompt.label}>
            {prompt.label}
            <input
              value={answers[prompt.label] ?? ""}
              onChange={(event) =>
                setAnswers((current) => ({
                  ...current,
                  [prompt.label]: event.target.value,
                }))
              }
            />
          </label>
        ))}
        {request.analysis.variables.includes("clipboard") && (
          <label>
            Clipboard text
            <textarea
              aria-label="Clipboard text"
              value={clipboard}
              onChange={(event) => setClipboard(event.target.value)}
              rows={3}
            />
            <button
              type="button"
              disabled={reading}
              onClick={() => {
                void readClipboard();
              }}
            >
              {reading ? "Reading…" : "Read clipboard"}
            </button>
          </label>
        )}
        {(error || rendered.error) && (
          <p role="alert">{error || rendered.error}</p>
        )}
        {!!rendered.value?.issues.length && (
          <p role="status">
            Unresolved variables remain literal:{" "}
            {[...new Set(rendered.value.issues.map((issue) => issue.raw))].join(
              ", ",
            )}
          </p>
        )}
        <pre className="snippetPreview" aria-label="Snippet preview">
          {rendered.value?.text}
        </pre>
        <div className="dialogActions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="primaryButton"
            disabled={!rendered.value}
          >
            Insert snippet
          </button>
        </div>
      </form>
    </WorkspaceDialog>
  );
}
