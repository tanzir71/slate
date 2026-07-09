import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";

const root = resolve(process.argv[2] ?? "apps/web/dist");
const port = Number(process.argv[3] ?? 4173);
const host = "127.0.0.1";

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".webmanifest", "application/manifest+json; charset=utf-8"]
]);

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`);
  const target = await resolveTarget(requestUrl.pathname);

  if (!target.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  response.setHeader("Content-Type", contentTypes.get(extname(target)) ?? "application/octet-stream");
  createReadStream(target)
    .on("error", () => {
      response.writeHead(404);
      response.end("Not found");
    })
    .pipe(response);
});

server.listen(port, host, () => {
  console.log(`Slate static server ready at http://${host}:${port}`);
});

async function resolveTarget(pathname) {
  const decoded = decodeURIComponent(pathname);
  const candidate = resolve(root, `.${decoded === "/" ? "/index.html" : decoded}`);

  try {
    const info = await stat(candidate);
    if (info.isFile()) {
      return candidate;
    }
    if (info.isDirectory()) {
      return join(candidate, "index.html");
    }
  } catch {
    return join(root, "index.html");
  }

  return join(root, "index.html");
}
