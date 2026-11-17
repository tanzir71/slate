import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const uiRequire = createRequire(resolve(root, "packages/ui/package.json"));
const { createElement } = uiRequire("react");
const { renderToStaticMarkup } = uiRequire("react-dom/server");
const icons = uiRequire("lucide-react");
const names = {
  globe: "Globe",
  arrow: "ArrowUpRight",
  check: "Check",
  command: "Command",
  folder: "Folder",
  file: "FileText",
  search: "Search",
  download: "Download",
  shield: "ShieldCheck",
  layers: "Layers",
  capture: "Feather",
  chevron: "ChevronDown",
  menu: "Menu",
  code: "Code2",
  archive: "Archive",
  arrowRight: "ArrowRight",
  github: "GitFork",
};
const directory = resolve(root, "docs/assets/icons");
await mkdir(directory, { recursive: true });
for (const [name, component] of Object.entries(names)) {
  const svg = renderToStaticMarkup(
    createElement(icons[component], {
      size: 20,
      strokeWidth: 1.75,
      color: "#6B6964",
      "aria-hidden": true,
    }),
  );
  await writeFile(resolve(directory, `${name}.svg`), svg);
}
console.log("Prepared local marketing icons from the shared Lucide library.");
