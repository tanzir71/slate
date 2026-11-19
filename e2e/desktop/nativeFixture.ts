import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const config = JSON.parse(readFileSync(resolve("apps/desktop/src-tauri/tauri.conf.json"), "utf8")) as { app: { security: { csp: Record<string, string> } } };
const csp = Object.entries(config.app.security.csp).map(([directive, sources]) => `${directive} ${sources}`).join("; ");

/** Explicit IPC disk fixture; production never imports these notes. Raw bytes survive reload. */
export async function nativeFixture(page: Page, initial: Record<string, string> = {
  "product/strategy/principles.md": "# Principles\n\nWords on disk.",
  "product/strategy/product-vision.md": "# Product Vision\n\nA place for ideas.",
}) {
  // Apply the production policy to the compiled HTTP fixture. Tauri also adds
  // its generated bootstrap hashes/nonces when serving the native application.
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() !== "document") { await route.continue(); return; }
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": csp } });
  });
  await page.addInitScript((notes) => {
    const prefix = (scope: unknown) => `native-file:${String(scope)}:`;
    if (!localStorage.getItem("native-fixture-ready")) {
      for (const [path, source] of Object.entries(notes)) localStorage.setItem(prefix("space") + path, JSON.stringify(Array.from(new TextEncoder().encode(source))));
      localStorage.setItem("native-fixture-ready", "true");
    }
    const read = (scope: unknown, path: unknown): number[] | null => JSON.parse(localStorage.getItem(prefix(scope) + String(path)) ?? "null") as number[] | null;
    const write = (scope: unknown, path: string, bytes: number[]) => {
      localStorage.setItem(prefix(scope) + path, JSON.stringify(bytes));
      if (/\.md$/i.test(path)) localStorage.setItem("native-test:" + path, new TextDecoder("utf-8", { ignoreBOM: true }).decode(new Uint8Array(bytes)));
      else if (/\.png$/i.test(path)) localStorage.setItem("native-asset:" + path, JSON.stringify(bytes));
    };
    const callbacks = new Map<number, (value: unknown) => void>();
    const listeners = new Map<number, { event: string; callback: number }>();
    let sequence = 0;
    let rows: { entry: { id: string; path: string; title: string; tags: string[]; links: string[]; words: number; updatedAt?: string }; body: string; contentHash: string }[] = [];
    Reflect.set(window, "__NATIVE_FIXTURE__", {
      indexBodies: () => rows.map((row) => row.body),
      emit(event: string, payload: unknown) { for (const [id, listener] of listeners) if (listener.event === event) callbacks.get(listener.callback)?.({ event, id, payload }); },
    });
    Reflect.set(window, "__TAURI_EVENT_PLUGIN_INTERNALS__", { unregisterListener: (_event: string, id: number) => listeners.delete(id) });
    Reflect.set(window, "__TAURI_INTERNALS__", {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback(callback: (value: unknown) => void) { const id = ++sequence; callbacks.set(id, callback); return id; },
      unregisterCallback(id: number) { callbacks.delete(id); },
      async invoke(command: string, args: Record<string, unknown> = {}) {
        const path = String(args.path), scope = args.scope;
        if (command === "plugin:event|listen") { const id = ++sequence; listeners.set(id, { event: String(args.event), callback: Number(args.handler) }); return id; }
        if (command === "plugin:event|unlisten") { listeners.delete(Number(args.eventId)); return null; }
        if (command === "plugin:window|destroy") { localStorage.setItem("native-destroyed", "true"); return null; }
        if (command === "workspace_watch_status") return [];
        if (command === "list_workspace_files") return Object.keys(localStorage).filter((key) => key.startsWith(prefix(scope))).map((key) => key.slice(prefix(scope).length)).filter((name) => args.includePrivate || !name.startsWith(".slate/")).sort();
        if (command === "read_workspace_file") {
          if (localStorage.getItem("native-fail-read")) throw { kind: "permission", message: "Access denied. Your files were kept." };
          return read(scope, path);
        }
        if (command === "create_workspace_file") {
          if (read(scope, path) !== null) return false;
          write(scope, path, args.bytes as number[]); return true;
        }
        if (command === "save_workspace_file") {
          if (localStorage.getItem("native-fail-save")) throw { kind: "permission", message: "Disk is read-only" };
          const current = read(scope, path), base = args.baseBytes as number[] | null;
          const same = current === null ? base === null : base !== null && current.toString() === base.toString();
          const target = same ? path : path + ".conflict.md";
          write(scope, target, args.bytes as number[]);
          return { status: same ? "written" : "conflict-copy", path: target };
        }
        if (command === "move_workspace_file" || command === "trash_workspace_file") {
          const from = command === "move_workspace_file" ? String(args.from) : path;
          const to = command === "move_workspace_file" ? String(args.to) : ".slate/trash/1/" + path;
          const source = read(scope, from);
          if (source === null || source.toString() !== (args.baseBytes as number[]).toString() || read(scope, to) !== null) throw { kind: "conflict", message: "Source or destination changed" };
          write(scope, to, source); localStorage.removeItem(prefix(scope) + from);
          return command === "move_workspace_file" ? null : to;
        }
        if (command === "replace_workspace_index") {
          if (localStorage.getItem("native-fail-index")) throw { kind: "io", message: "Cache unavailable" };
          rows = args.rows as typeof rows; return null;
        }
        if (command === "search_workspace_index") {
          const query = String(args.query).toLowerCase();
          return rows.filter((row) => !query || `${row.entry.title} ${row.body} ${row.entry.tags.join(" ")}`.toLowerCase().includes(query)).map((row) => row.entry.path);
        }
        throw new Error(`Unexpected native command: ${command}`);
      },
    });
  }, initial);
}
