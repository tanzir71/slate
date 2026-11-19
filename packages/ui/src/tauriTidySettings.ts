import { readTidyConfiguration } from "@slate/core/tidy/settings";
import { decodeText, encodeText } from "@slate/storage/browser-files";
import type { TidyFile } from "@slate/storage/browser-tidy";
import { invokeTauri, type TauriInvoke } from "./tauriAutosave";
import { nativeFileError } from "@slate/storage/tauri-files";

const path: TidyFile["path"] = ".slate/tidy.json";
const message = (cause: unknown) =>
  nativeFileError(cause).message;
const parse = (source: string) =>
  readTidyConfiguration(source.replace(/^\uFEFF/, ""));
function byteArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every(
      (byte: unknown) =>
        typeof byte === "number" &&
        Number.isInteger(byte) &&
        byte >= 0 &&
        byte <= 255,
    )
  );
}
function saveResult(
  value: unknown,
): value is { status: "written" | "conflict-copy"; path: string } {
  if (
    typeof value !== "object" ||
    value === null ||
    !("path" in value) ||
    typeof value.path !== "string" ||
    !("status" in value)
  )
    return false;
  return value.status === "written"
    ? value.path === path
    : value.status === "conflict-copy" &&
        /^\.slate\/tidy \(conflicted copy [\w .-]+\)\.json$/.test(value.path);
}

/** The native commands select their fixed Space/path; neither method accepts a filesystem path. */
export function createTauriTidySettingsStore({
  invoke = invokeTauri,
}: { invoke?: TauriInvoke } = {}) {
  return {
    async read(): Promise<TidyFile> {
      let bytes: Uint8Array;
      try {
        const reply = await invoke<unknown>("read_tidy_settings");
        if (reply === null) return { path, status: "missing" };
        if (!byteArray(reply))
          throw new Error("Invalid native Tidy settings response");
        bytes = new Uint8Array(reply);
      } catch (cause) {
        return { path, status: "unavailable", error: message(cause) };
      }
      let source: string;
      try {
        const decoded = decodeText(bytes);
        source =
          bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
            ? `\uFEFF${decoded}`
            : decoded;
      } catch {
        return {
          path,
          status: "unsupported",
          bytes,
          error:
            "This Tidy file is not valid UTF-8. Its original bytes are preserved.",
        };
      }
      try {
        return {
          path,
          status: "valid",
          source,
          bytes,
          configuration: parse(source),
        };
      } catch (cause) {
        return {
          path,
          status: "invalid",
          source,
          bytes,
          error: message(cause),
        };
      }
    },
    async save(snapshot: TidyFile, source: string) {
      if (
        snapshot.path !== path ||
        snapshot.status === "unsupported" ||
        snapshot.status === "unavailable"
      )
        throw new Error("Read an editable Tidy file before saving it.");
      parse(source);
      const result = await invoke<unknown>("write_tidy_settings", {
        bytes: Array.from(encodeText(source)),
        baseBytes: snapshot.bytes ? Array.from(snapshot.bytes) : null,
      }).catch((cause: unknown) => { throw nativeFileError(cause); });
      if (!saveResult(result))
        throw new Error("Invalid native Tidy save response");
      return {
        path: result.path,
        content: source,
        conflict: result.status === "conflict-copy",
      };
    },
  };
}
