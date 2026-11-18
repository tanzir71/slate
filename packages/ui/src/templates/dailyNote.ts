import {
  carryOverTasks,
  planTemplateFile,
  readMarkdownTemplate,
} from "@slate/core";
import source from "./builtins/daily-note.md?raw";
import { captureTemplateContext } from "./templateSession";

/** Daily creation shares the gallery's actual Markdown source and renderer. */
export function planDailyNote(space: string, date: Date, previous: string) {
  const context = captureTemplateContext(
    space,
    "Daily",
    carryOverTasks(previous),
    date,
  );
  return planTemplateFile(readMarkdownTemplate(source, "Daily note"), context);
}
