import type { BlockUsage } from "@slate/core";

export function readBlockUsage(raw: string | null): Record<string, BlockUsage> {
  try {
    const parsed: unknown = JSON.parse(raw ?? "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, BlockUsage] => {
        const value: unknown = entry[1];
        return (
          !!value &&
          typeof value === "object" &&
          "count" in value &&
          "lastUsed" in value &&
          typeof value.count === "number" &&
          Number.isFinite(value.count) &&
          value.count >= 0 &&
          typeof value.lastUsed === "number" &&
          Number.isFinite(value.lastUsed) &&
          value.lastUsed >= 0
        );
      }),
    );
  } catch {
    return {};
  }
}
