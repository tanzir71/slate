import { useEffect, useMemo, useRef, useState } from "react";
import { renderMarkdownTemplate } from "@slate/core";
import { WorkspaceDialog } from "../browser/WorkspaceDialog";
import type { TemplateBlockRequest } from "./templateSession";
import "../snippets/snippets.css";

export default function TemplateBlockPrompt({
  request,
  onClose,
}: {
  request: TemplateBlockRequest;
  onClose(): void;
}) {
  const [title, setTitle] = useState(request.context.title ?? ""),
    [date, setDate] = useState(request.context.clock?.date ?? "");
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      request.analysis.prompts.map((prompt) => [
        prompt.label,
        prompt.defaultValue ?? "",
      ]),
    ),
  );
  const [clipboard, setClipboard] = useState(request.context.clipboard ?? ""),
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
        value: renderMarkdownTemplate(request.template, {
          ...request.context,
          title,
          clipboard,
          prompts: answers,
          ...(request.context.clock
            ? { clock: { ...request.context.clock, date } }
            : {}),
        }),
        error: "",
      };
    } catch (cause) {
      return {
        value: undefined,
        error: cause instanceof Error ? cause.message : String(cause),
      };
    }
  }, [request, title, date, clipboard, answers]);
  async function readClipboard() {
    setReading(true);
    try {
      if (!navigator.clipboard?.readText)
        throw new Error("Clipboard unavailable");
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
      title={`Insert ${request.template.name}`}
      className="snippetPrompt"
      returnFocus={request.target.element}
      onClose={onClose}
    >
      <p className="quiet">Insert this template into the current sheet.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!rendered.value) return;
          try {
            if (!request.target.insert(rendered.value)) {
              setError(
                "The sheet changed or is read-only. Close this dialog and choose the template again.",
              );
              return;
            }
            onClose();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        }}
      >
        {request.analysis.variables.includes("title") && (
          <label>
            Title
            <input
              aria-label="Template title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
        )}
        {request.analysis.variables.includes("date") &&
          request.context.clock && (
            <label>
              Date
              <input
                aria-label="Template date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
          )}
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
              rows={3}
              value={clipboard}
              onChange={(event) => setClipboard(event.target.value)}
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
            {[
              ...new Set(rendered.value.issues.map(({ issue }) => issue.raw)),
            ].join(", ")}
          </p>
        )}
        <pre className="snippetPreview" aria-label="Template preview">
          {rendered.value?.content}
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
            Insert template
          </button>
        </div>
      </form>
    </WorkspaceDialog>
  );
}
