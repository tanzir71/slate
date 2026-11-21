type PlainNode =
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "root" | "paragraph" | "list" | "listItem"; readonly children: readonly unknown[] };

const fields = new Map<PlainNode["type"], ReadonlySet<string>>([
  ["root", new Set(["type", "children", "position"])],
  ["paragraph", new Set(["type", "children", "position"])],
  ["text", new Set(["type", "value", "position"])],
  ["list", new Set(["type", "ordered", "start", "spread", "children", "position"])],
  ["listItem", new Set(["type", "checked", "spread", "children", "position"])],
]);
const enumerable = (value: object, key: string) => Object.prototype.propertyIsEnumerable.call(value, key);

function ordinaryArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype &&
    value.constructor === Array && value.map === Array.prototype.map;
}
function plainNode(value: unknown): value is PlainNode {
  if (!value || typeof value !== "object" || Array.isArray(value) || !enumerable(value, "type")) return false;
  const node = value as Record<string, unknown>;
  if (typeof node.type !== "string") return false;
  const allowed = fields.get(node.type as PlainNode["type"]);
  if (!allowed) return false;
  for (const key of Object.keys(node)) if (!allowed.has(key)) return false;
  if (node.type === "text") return enumerable(node, "value") && typeof node.value === "string";
  if (!enumerable(node, "children") || !ordinaryArray(node.children)) return false;
  if (node.type === "list" && (!enumerable(node, "ordered") || node.ordered !== false || !enumerable(node, "start") || node.start !== null)) return false;
  return node.type !== "listItem" || enumerable(node, "checked") && node.checked === null;
}

/** Exact serialized-AST semantics for ordinary unordered lists/paragraphs only.
 * Unknown fields, shapes, types or custom arrays retain the complete projection.
 * Position and list spread are ignored by that existing proof too.
 */
export function comparePlainTidyAst(left: unknown, right: unknown): boolean | undefined {
  if (!plainNode(left) || !plainNode(right)) return;
  if (left.type !== right.type) return false;
  if (left.type === "text") return right.type === "text" && left.value.replace(/\s+/gu, " ") === right.value.replace(/\s+/gu, " ");
  if (right.type === "text") return false;
  if (left.children.length !== right.children.length) return false;
  for (let index = 0; index < left.children.length; index++) {
    const equal = comparePlainTidyAst(left.children[index], right.children[index]);
    if (equal !== true) return equal;
  }
  return true;
}
