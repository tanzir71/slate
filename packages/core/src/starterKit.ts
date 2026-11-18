import { templateOutputPath } from "./templatePath.js";

/** Reserve a new top-level notebook without claiming any existing folder or file. */
export function starterKitRoot(
  name: string,
  paths: readonly string[],
  notebooks: readonly string[] = [],
): string {
  const validate = (root: string) => {
    if (
      root.includes("/") ||
      root.includes("\\") ||
      templateOutputPath(root, "Overview") !== root + "/Overview.md"
    )
      throw new Error("Choose one portable top-level notebook name.");
  };
  validate(name);
  const occupied = new Set(
    [...paths, ...notebooks].map((path) =>
      path.replaceAll("\\", "/").split("/")[0]!.toLowerCase(),
    ),
  );
  let root = name,
    number = 1;
  while (occupied.has(root.toLowerCase())) {
    root = name + " (" + number++ + ")";
    validate(root);
  }
  return root;
}
