import { parseLaunchActionParameters } from "@slate/core";
import type { LaunchRequestData } from "../browser/LaunchActions";

/** Native URI syntax stays in the platform adapter; Core receives only decoded fields. */
export function parseNativeLaunchURL(uri: string): LaunchRequestData {
  let params = new URLSearchParams();
  try {
    const url = new URL(uri);
    if (!["slate:", "slate-preview:"].includes(url.protocol) || url.username || url.password || url.port || url.hash ||
        url.pathname !== "" && url.pathname !== "/" || !["new", "open", "append", "search"].includes(url.hostname)) {
      throw Error("Use a Slate desktop new, open, append or search link.");
    }
    params = new URLSearchParams(url.searchParams);
    if (params.has("action")) throw Error("The desktop link already names its action.");
    params.append("action", url.hostname);
    const action = parseLaunchActionParameters(params);
    if (!action || action.kind === "open-files") throw Error("Opening a sheet needs its relative Markdown path.");
    return { action, params, error: "", files: [], id: 0 };
  } catch (cause) {
    return { action: undefined, params, error: cause instanceof Error ? cause.message : "This desktop link is invalid. Your files were kept.", files: [], id: 0 };
  }
}
