import {
  readMarkdownTemplate,
  templateOutputPath,
  templateSlug,
  type MarkdownTemplate,
} from "@slate/core";
import { decodeText, safeBrowserPath } from "./browserFiles";
import { listWorkspaceDirectory } from "./fileIO";
import type { BrowserSpace, BrowserWriteResult } from "./browserSpace";

const directory = ".slate/templates/";

export interface SpaceTemplateRecord {
  readonly path: string;
  readonly source: string | undefined;
  readonly template: MarkdownTemplate | undefined;
  readonly error: string | undefined;
}

const fallbackName = (path: string) =>
  path.split("/").at(-1)!.replace(/\.md$/i, "");
const isTemplatePath = (path: string) =>
  path.startsWith(directory) && /\.md$/i.test(path);

/** A broken template stays visible and repairable; reading never changes its bytes. */
export async function readSpaceTemplates(
  space: BrowserSpace,
): Promise<SpaceTemplateRecord[]> {
  const paths = (await listWorkspaceDirectory(space.files, directory.slice(0, -1))).filter(isTemplatePath).sort();
  const records = await Promise.all(
    paths.map(async (path): Promise<SpaceTemplateRecord | undefined> => {
      let source: string | undefined;
      try {
        const bytes = await space.files.read(path);
        if (bytes === undefined) return undefined;
        source = decodeText(bytes);
        return {
          path,
          source,
          template: readMarkdownTemplate(source, fallbackName(path)),
          error: undefined,
        };
      } catch (error) {
        return {
          path,
          source,
          template: undefined,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
  return records.filter(
    (record): record is SpaceTemplateRecord => record !== undefined,
  );
}

export interface SaveSpaceTemplateOptions {
  readonly path?: string;
  readonly baseContent?: string | undefined;
}

/** New copies use numbered filenames; edits retain external changes as conflict copies. */
export async function saveSpaceTemplate(
  space: BrowserSpace,
  source: string,
  options: SaveSpaceTemplateOptions = {},
): Promise<BrowserWriteResult> {
  const path =
    options.path === undefined ? undefined : safeBrowserPath(options.path);
  if (path !== undefined && !isTemplatePath(path))
    throw new Error("Choose a Markdown file inside .slate/templates/.");
  const template = readMarkdownTemplate(
    source,
    path === undefined ? "Untitled" : fallbackName(path),
  );
  if (path !== undefined) return space.save(path, source, options.baseContent);
  const name = templateOutputPath(
    "",
    "template-" + (templateSlug(template.name) || "untitled"),
  );
  const created = await space.create(directory + name, source);
  return { ...created, conflict: false };
}
