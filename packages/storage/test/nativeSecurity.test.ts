import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const configPath = resolve("apps/desktop/src-tauri/tauri.conf.json");
const capabilitiesPath = resolve("apps/desktop/src-tauri/capabilities/default.json");

it("enforces a local-script desktop CSP with explicit IPC and worker sources", () => {
  const config = JSON.parse(readFileSync(configPath, "utf8")) as { app: { security: { csp: Record<string, string> } } };
  const csp = config.app.security.csp;
  expect(csp).toBeTypeOf("object");
  expect(csp).not.toBeNull();
  expect(csp["default-src"]).toBe("'self'");
  expect(csp["script-src"]).toBe("'self'");
  expect(csp["connect-src"]).toBe("'self' ipc: http://ipc.localhost");
  expect(csp["worker-src"]).toBe("'self' blob:");
  expect(csp["object-src"]).toBe("'none'");
  expect(csp["frame-src"]).toBe("'self' data:");
  expect(csp["base-uri"]).toBe("'none'");
});

it("grants no general filesystem, SQL or shell capability to the webview", () => {
  const capability = JSON.parse(readFileSync(capabilitiesPath, "utf8")) as { windows: string[]; remote?: unknown; permissions: string[] };
  expect(capability.windows).toEqual(["main"]);
  expect(capability.remote).toBeUndefined();
  expect(capability.permissions.some((permission) => /^(?:sql|fs|shell):/.test(permission))).toBe(false);
  const main = readFileSync(resolve("apps/desktop/src-tauri/src/main.rs"), "utf8");
  expect(main).not.toContain("tauri_plugin_sql::Builder");
});

it("requires main-window permissions for every registered application command", () => {
  const main = readFileSync(resolve("apps/desktop/src-tauri/src/main.rs"), "utf8");
  const handlers = main.split("tauri::generate_handler![")[1]!.split("])")[0]!;
  const commands = [...handlers.matchAll(/\w+::(\w+)/g)].map((match) => match[1]!).sort();
  const build = readFileSync(resolve("apps/desktop/src-tauri/build.rs"), "utf8");
  const declarations = build.match(/\.commands\(&\[([\s\S]*?)\]\)/)?.[1] ?? "";
  expect([...declarations.matchAll(/"(\w+)"/g)].map((match) => match[1]!).sort()).toEqual(commands);
  expect(build).toContain(".app_manifest(");
  const capability = JSON.parse(readFileSync(capabilitiesPath, "utf8")) as { local: boolean; permissions: string[] };
  expect(capability.local).toBe(true);
  expect(capability.permissions.filter((permission) => permission.startsWith("allow-")).sort()).toEqual(commands.map((command) => `allow-${command.replaceAll("_", "-")}`).sort());
});
