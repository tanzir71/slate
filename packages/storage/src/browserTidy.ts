import {
  readTidyConfiguration,
  type TidyConfiguration,
} from "@slate/core/tidy/settings";
import { decodeText } from "./browserFiles";
import type { BrowserSpace, BrowserWriteResult } from "./browserSpace";

export const spaceTidyPath = ".slate/tidy.json";
export interface TidyFile {
  readonly path: typeof spaceTidyPath;
  readonly status:
    "missing" | "valid" | "invalid" | "unsupported" | "unavailable";
  readonly source?: string;
  readonly bytes?: Uint8Array;
  readonly configuration?: TidyConfiguration;
  readonly error?: string;
}
const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);
const parse = (source: string) =>
  readTidyConfiguration(source.replace(/^\uFEFF/, ""));

/** Reading is inert. Explicit saves validate JSON and use the Space's conflict protection. */
export function createTidyFileStore(space: BrowserSpace) {
  return {
    async read(): Promise<TidyFile> {
      let bytes: Uint8Array | undefined;
      try {
        bytes = await space.files.read(spaceTidyPath);
      } catch (cause) {
        return {
          path: spaceTidyPath,
          status: "unavailable",
          error: message(cause),
        };
      }
      if (bytes === undefined)
        return { path: spaceTidyPath, status: "missing" };
      let source: string;
      try {
        const decoded = decodeText(bytes);
        source =
          bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
            ? `\uFEFF${decoded}`
            : decoded;
      } catch {
        return {
          path: spaceTidyPath,
          status: "unsupported",
          bytes,
          error:
            "This Tidy file is not valid UTF-8. Its original bytes are preserved.",
        };
      }
      try {
        return {
          path: spaceTidyPath,
          status: "valid",
          bytes,
          source,
          configuration: parse(source),
        };
      } catch (cause) {
        return {
          path: spaceTidyPath,
          status: "invalid",
          bytes,
          source,
          error: message(cause),
        };
      }
    },
    async save(
      snapshot: TidyFile,
      source: string,
    ): Promise<BrowserWriteResult> {
      if (
        snapshot.path !== spaceTidyPath ||
        snapshot.status === "unsupported" ||
        snapshot.status === "unavailable"
      )
        throw new Error("Read an editable Tidy file before saving it.");
      parse(source);
      // Save the exact proposed JSON, including future numeric spellings and whitespace.
      return space.saveSnapshot(spaceTidyPath, source, snapshot.bytes);
    },
  };
}
