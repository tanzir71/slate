import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createGzip } from "node:zlib";

const host = "127.0.0.1";

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".avif", "image/avif"],
  [".wasm", "application/wasm"],
  [".woff2", "font/woff2"],
  [".txt", "text/plain; charset=utf-8"],
  [".xml", "application/xml; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
]);

export function createStaticFileServer(rootPath, mount = "") {
  const root = resolve(rootPath);
  return createServer(async (request, response) => {
    let target;
    try {
      const requestUrl = new URL(request.url ?? "/", `http://${host}`);
      target = await resolveTarget(
        root,
        mount && requestUrl.pathname.startsWith(`${mount}/`)
          ? requestUrl.pathname.slice(mount.length)
          : requestUrl.pathname,
      );
    } catch {
      response.writeHead(400).end("Invalid path");
      return;
    }

    if (!target) { response.writeHead(404).end("Not found"); return; }

    if (target !== root && !target.startsWith(`${root}${sep}`)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    response.setHeader(
      "Content-Type",
      contentTypes.get(extname(target)) ?? "application/octet-stream",
    );
    const compressed = /\bgzip\b/.test(request.headers["accept-encoding"] ?? "") && /\.(?:html|css|js|json|svg|xml|txt)$/.test(target);
    if (compressed) { response.setHeader("Content-Encoding", "gzip"); response.setHeader("Vary", "Accept-Encoding"); }
    const stream = createReadStream(target)
      .on("error", () => {
        response.writeHead(404);
        response.end("Not found");
      });
    if (compressed) stream.pipe(createGzip()).pipe(response);
    else stream.pipe(response);
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.argv[3] ?? 4173);
  const server = createStaticFileServer(
    process.argv[2] ?? "apps/web/dist",
    process.argv[4] ?? "",
  );
  server.listen(port, host, () => {
    console.log(
      `Slate static server ready at http://${host}:${server.address().port}`,
    );
  });
}

async function resolveTarget(root, pathname) {
  const decoded = decodeURIComponent(pathname);
  const candidate = resolve(
    root,
    `.${decoded === "/" ? "/index.html" : decoded}`,
  );

  try {
    const info = await stat(candidate);
    if (info.isFile()) {
      return candidate;
    }
    if (info.isDirectory()) {
      return join(candidate, "index.html");
    }
  } catch {
    return undefined;
  }

  return undefined;
}
