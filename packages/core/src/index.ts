import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { parse as parseYaml } from "yaml";

export * from "./commands.js";
export * from "./workspacePreferences.js";
export * from "./textChanges.js";
export * from "./blocks.js";
export * from "./blockSearch.js";
export * from "./editorPreferences.js";

export type SheetId = string;

export type GoalType = "words" | "characters" | "readingTimeMinutes";

export interface GoalDefinition {
  type: GoalType;
  target: number;
}

export interface GoalProgress extends GoalDefinition {
  current: number;
  complete: boolean;
}

export interface Tag {
  path: string;
  parts: string[];
  source: "frontmatter" | "body";
}

export interface WikiLink {
  raw: string;
  target: string;
  display: string;
  targetId: SheetId | undefined;
}

export interface SheetStats {
  words: number;
  characters: number;
  readingTimeMinutes: number;
}

export interface SheetDocument {
  id: SheetId;
  path: string;
  title: string;
  raw: string;
  body: string;
  frontmatter: Record<string, unknown>;
  tags: Tag[];
  links: WikiLink[];
  stats: SheetStats;
  goal: GoalProgress | undefined;
  createdAt: Date | undefined;
  updatedAt: Date | undefined;
}

export interface Backlink {
  fromId: SheetId;
  fromTitle: string;
  linkText: string;
  raw: string;
}

export interface FilterContext {
  now?: Date;
}

interface FrontmatterParts {
  data: Record<string, unknown>;
  body: string;
}

const frontmatterPattern = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const wikiLinkPattern = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
const bodyTagPattern = /(^|[\s([>])#([A-Za-z0-9][A-Za-z0-9_-]*(?:\/[A-Za-z0-9][A-Za-z0-9_-]*)*)/g;
const ulidLikePattern = /^(?:id:)?01[0-9A-HJKMNP-TV-Z]{24}$/i;

export function parseSheet(raw: string, path: string): SheetDocument {
  const { data, body } = parseFrontmatter(raw);
  const stats = computeStats(body);
  const id = readString(data.id) ?? stableLocalId(path);
  const title = readString(data.title) ?? readFirstHeading(body) ?? basenameWithoutExtension(path);
  const tags = extractTags(data, body);
  const links = extractWikiLinks(body);
  const goalDefinition = readGoalDefinition(data.goal);
  const goal = goalDefinition ? computeGoal(goalDefinition, stats) : undefined;

  return {
    id,
    path,
    title,
    raw,
    body,
    frontmatter: data,
    tags,
    links,
    stats,
    goal,
    createdAt: readDate(data.created),
    updatedAt: readDate(data.updated)
  };
}

export function serializeSheet(sheet: SheetDocument): string {
  return sheet.raw;
}

export function parseMarkdownAst(markdown: string): unknown {
  return unified().use(remarkParse).use(remarkGfm).parse(markdown);
}

export function buildBacklinkIndex(sheets: SheetDocument[]): Map<SheetId, Backlink[]> {
  const byId = new Map<SheetId, SheetDocument>();
  const byTitle = new Map<string, SheetDocument>();

  for (const sheet of sheets) {
    byId.set(sheet.id, sheet);
    byTitle.set(normalizeTitle(sheet.title), sheet);
  }

  const index = new Map<SheetId, Backlink[]>();
  for (const sheet of sheets) {
    index.set(sheet.id, []);
  }

  for (const source of sheets) {
    for (const link of source.links) {
      const target = link.targetId
        ? byId.get(link.targetId)
        : byTitle.get(normalizeTitle(link.target));
      if (!target || target.id === source.id) {
        continue;
      }

      const existing = index.get(target.id) ?? [];
      existing.push({
        fromId: source.id,
        fromTitle: source.title,
        linkText: link.display,
        raw: link.raw
      });
      index.set(target.id, existing);
    }
  }

  return index;
}

export function evaluateSmartFilter(
  sheet: SheetDocument,
  query: string,
  context: FilterContext = {}
): boolean {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return true;
  }

  const orGroups = splitBoolean(trimmed, "OR");
  return orGroups.some((group) =>
    splitBoolean(group, "AND").every((term) => evaluateFilterTerm(sheet, term, context))
  );
}

export function computeStats(markdown: string): SheetStats {
  const plain = markdown
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(wikiLinkPattern, (_match: string, target: string, display: string | undefined) => {
      return display ?? target;
    })
    .replace(bodyTagPattern, (_match: string, prefix: string, tag: string) => {
      return `${prefix}${tag.replaceAll("/", " ")}`;
    })
    .replace(/[#>*_`~=\-[\]()!?.:,;]/g, " ");

  const words = plain.match(/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?/g) ?? [];
  const characters = plain.replace(/\s/g, "").length;

  return {
    words: words.length,
    characters,
    readingTimeMinutes: Math.max(1, Math.ceil(words.length / 225))
  };
}

export function extractWikiLinks(markdown: string): WikiLink[] {
  return Array.from(markdown.matchAll(wikiLinkPattern), (match) => {
    const rawTarget = (match[1] ?? "").trim();
    const display = (match[2] ?? rawTarget).trim();
    const normalizedId = normalizeTargetId(rawTarget);

    return {
      raw: match[0],
      target: normalizedId ?? rawTarget,
      display,
      targetId: normalizedId
    };
  });
}

export function extractTags(data: Record<string, unknown>, body: string): Tag[] {
  const tags: Tag[] = [];
  const seen = new Set<string>();

  for (const tag of readFrontmatterTags(data.tags)) {
    addTag(tags, seen, tag, "frontmatter");
  }

  for (const match of body.matchAll(bodyTagPattern)) {
    addTag(tags, seen, match[2] ?? "", "body");
  }

  return tags;
}

function parseFrontmatter(raw: string): FrontmatterParts {
  const match = raw.match(frontmatterPattern);
  if (!match) {
    return { data: {}, body: raw };
  }

  const parsed = parseYaml(match[1] ?? "");
  return {
    data: isRecord(parsed) ? parsed : {},
    body: raw.slice(match[0].length)
  };
}

function readFrontmatterTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => (typeof item === "string" ? [item] : []));
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  return [];
}

function addTag(tags: Tag[], seen: Set<string>, value: string, source: Tag["source"]): void {
  const path = normalizeTag(value);
  if (!path || seen.has(path)) {
    return;
  }

  seen.add(path);
  tags.push({ path, parts: path.split("/"), source });
}

function normalizeTag(value: string): string {
  return value.trim().replace(/^#/, "").replace(/^\/+|\/+$/g, "").toLowerCase();
}

function readGoalDefinition(value: unknown): GoalDefinition | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const type = value.type;
  const target = value.target;
  if (!isGoalType(type) || typeof target !== "number" || !Number.isFinite(target)) {
    return undefined;
  }

  return { type, target };
}

function computeGoal(goal: GoalDefinition, stats: SheetStats): GoalProgress {
  const current =
    goal.type === "words"
      ? stats.words
      : goal.type === "characters"
        ? stats.characters
        : stats.readingTimeMinutes;

  return {
    ...goal,
    current,
    complete: current >= goal.target
  };
}

function evaluateFilterTerm(
  sheet: SheetDocument,
  rawTerm: string,
  context: FilterContext
): boolean {
  const term = rawTerm.trim();
  if (term.length === 0) {
    return true;
  }

  const [field, ...rest] = term.split(":");
  const value = rest.join(":").trim();
  const normalizedField = field?.trim().toLowerCase();

  if (normalizedField === "tag") {
    const expected = normalizeTag(value);
    return sheet.tags.some((tag) => tag.path === expected || tag.path.startsWith(`${expected}/`));
  }

  if (normalizedField === "text") {
    return `${sheet.title}\n${sheet.body}`.toLowerCase().includes(value.toLowerCase());
  }

  if (normalizedField === "goal") {
    if (value === "complete") {
      return sheet.goal?.complete === true;
    }
    if (value === "incomplete") {
      return sheet.goal ? !sheet.goal.complete : true;
    }
    return false;
  }

  if (normalizedField === "modified") {
    return evaluateRelativeDate(sheet.updatedAt, value, context.now ?? new Date());
  }

  return `${sheet.title}\n${sheet.body}`.toLowerCase().includes(term.toLowerCase());
}

function evaluateRelativeDate(date: Date | undefined, expression: string, now: Date): boolean {
  if (!date) {
    return false;
  }

  const match = expression.match(/^([<>])(\d+)d$/i);
  if (!match) {
    return false;
  }

  const direction = match[1];
  const days = Number(match[2]);
  const ageMs = now.getTime() - date.getTime();
  const ageDays = ageMs / (24 * 60 * 60 * 1000);

  return direction === "<" ? ageDays < days : ageDays > days;
}

function splitBoolean(query: string, operator: "AND" | "OR"): string[] {
  return query
    .split(new RegExp(`\\s+${operator}\\s+`, "i"))
    .map((part) => part.trim())
    .filter(Boolean);
}

function readFirstHeading(body: string): string | undefined {
  const heading = body.match(/^#\s+(.+)$/m);
  return heading?.[1]?.trim();
}

function basenameWithoutExtension(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const basename = normalized.slice(normalized.lastIndexOf("/") + 1);
  return basename.replace(/\.[^.]+$/, "");
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase();
}

function normalizeTargetId(target: string): SheetId | undefined {
  if (!ulidLikePattern.test(target)) {
    return undefined;
  }

  return target.replace(/^id:/i, "").toUpperCase();
}

function stableLocalId(path: string): SheetId {
  let hash = 0x811c9dc5;
  for (const char of path) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `local_${(hash >>> 0).toString(36).padStart(7, "0")}`;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readDate(value: unknown): Date | undefined {
  if (!(typeof value === "string" || value instanceof Date)) {
    return undefined;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGoalType(value: unknown): value is GoalType {
  return value === "words" || value === "characters" || value === "readingTimeMinutes";
}
