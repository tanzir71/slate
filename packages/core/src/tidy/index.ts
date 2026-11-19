export { contentProjection, preservesContent } from "./projection.js";
export { guardFix, type GuardedTidyFix } from "./guard.js";
export { lint, fix } from "./engine.js";
export {
  readTidyConfiguration,
  writeTidyConfiguration,
  enabledTidyRules,
  tidyRuleIds,
  type TidyConfiguration,
  type TidyPreset,
  type TidyRuleId,
} from "./configuration.js";
export type { TidyIssue, TidyReport, TidyResult } from "./types.js";
