import { useState } from "react";
import type { BlockContext } from "@slate/core";
import { WorkspaceDialog } from "./browser/WorkspaceDialog";

export type ImportBlockImage = (
  file: File,
) => Promise<NonNullable<BlockContext["image"]>>;

export function BlockResourcePicker({
  kind,
  onImage,
  onChoose,
  onClose,
}: {
  kind: "language" | "image";
  onImage: ImportBlockImage | undefined;
  onChoose(context: Pick<BlockContext, "language" | "image">): void;
  onClose(): void;
}) {
  const [language, setLanguage] = useState("javascript");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function image(file: File) {
    if (!onImage) return;
    setBusy(true);
    try {
      onChoose({ image: await onImage(file) });
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : "The image could not be saved. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <WorkspaceDialog
      title={kind === "language" ? "Code language" : "Insert image"}
      onClose={onClose}
      busy={busy}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onChoose({ language });
        }}
      >
        {kind === "language" ? (
          <label>
            Language
            <input
              aria-label="Code language"
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              pattern="[a-zA-Z0-9_+#.\-]{0,48}"
              list="slate-code-languages"
              autoComplete="off"
            />
            <datalist id="slate-code-languages">
              {[
                "javascript",
                "typescript",
                "python",
                "rust",
                "go",
                "json",
                "html",
                "css",
                "bash",
                "markdown",
                "sql",
              ].map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
            <small>Leave empty for plain text.</small>
          </label>
        ) : (
          <label>
            Choose an image
            <input
              aria-label="Image file"
              type="file"
              accept="image/*"
              disabled={busy}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void image(file);
              }}
            />
            <small>
              The original image is copied into this Space’s assets folder.
            </small>
          </label>
        )}
        {error && <p role="alert">{error}</p>}
        {busy && <p role="status">Saving image…</p>}
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          {kind === "language" && (
            <button type="submit" className="primaryButton">
              Insert code block
            </button>
          )}
        </footer>
      </form>
    </WorkspaceDialog>
  );
}
