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
    type Row = { entry: { id: string; path: string; title: string; tags: string[]; links: string[]; words: number; updatedAt?: string }; body: string; contentHash: string };
    const indexes = new Map<string, Row[]>();
    type Ticket = { id: string; url: string; phase: "pending" | "started" | "applied"; spaceId?: string; claim?: string; fileName?: string };
    type FileTarget = { space: { id: string; name: string; path: string | null }; path: string };
    type Inbox = { revision: number; current: Ticket | null; queued: Ticket[]; completed?: string };
    const readInbox = (): Inbox => JSON.parse(localStorage.getItem("native-launch-inbox") ?? '{"revision":0,"current":null,"queued":[]}') as Inbox;
    const launchSnapshot = (inbox: Inbox) => ({ revision: inbox.revision, current: inbox.current ? { id: inbox.current.id, url: inbox.current.url, phase: inbox.current.phase, spaceId: inbox.current.spaceId ?? null, fileName: inbox.current.fileName } : null, waiting: inbox.queued.length, error: null });
    const workspaceReads: { command: string; spaceId: string; scope: unknown; path: string }[] = [];
    const emit = (event: string, payload: unknown) => { for (const [id, listener] of listeners) if (listener.event === event) callbacks.get(listener.callback)?.({ event, id, payload }); };
    const publish = (inbox: Inbox) => { localStorage.setItem("native-launch-inbox", JSON.stringify(inbox)); const snapshot = launchSnapshot(inbox); emit("slate://launch-changed", snapshot); return snapshot; };
    Reflect.set(window, "__NATIVE_FIXTURE__", {
      indexBodies: (spaceId = "native-default") => (indexes.get(spaceId) ?? []).map((row) => row.body),
      emit,
      workspaceReads: () => workspaceReads.slice(),
      openFiles(files: FileTarget[]) {
        const inbox = readInbox(), targets = JSON.parse(localStorage.getItem("native-os-file-targets") ?? "{}") as Record<string, FileTarget>;
        for (const target of files) {
          const ticket: Ticket = { id: crypto.randomUUID(), url: "", phase: "pending", fileName: target.path.split("/").pop()! };
          targets[ticket.id] = target;
          if (!inbox.current && !inbox.queued.length) inbox.current = ticket; else inbox.queued.push(ticket);
          inbox.revision++;
        }
        localStorage.setItem("native-os-file-targets", JSON.stringify(targets)); publish(inbox);
      },
      launch(url: string) {
        if (new URL(url).protocol !== "slate:") return;
        const inbox = readInbox(), ticket: Ticket = { id: crypto.randomUUID(), url, phase: "pending" };
        if (!inbox.current && !inbox.queued.length) inbox.current = ticket; else inbox.queued.push(ticket);
        inbox.revision += 1; publish(inbox);
      },
    });
    Reflect.set(window, "__TAURI_EVENT_PLUGIN_INTERNALS__", { unregisterListener: (_event: string, id: number) => listeners.delete(id) });
    Reflect.set(window, "isTauri", true);
    Reflect.set(window, "__TAURI_INTERNALS__", {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback(callback: (value: unknown) => void) { const id = ++sequence; callbacks.set(id, callback); return id; },
      unregisterCallback(id: number) { callbacks.delete(id); },
      async invoke(command: string, args: Record<string, unknown> = {}) {
        const path = String(args.path), spaceId = String(args.spaceId ?? "native-default");
        const spaceScope = spaceId === "native-default" ? "space" : "folder:" + spaceId;
        const scope = args.scope === "space" ? spaceScope : args.scope;
        if (["list_workspace_files", "read_workspace_file"].includes(command)) {
          workspaceReads.push({ command, spaceId, scope: args.scope, path });
          if (spaceId === "native-default" && args.scope === "space" && localStorage.getItem("native-default-unavailable")) throw { kind: "io", message: "Default Space unavailable" };
        }
        if (command === "plugin:event|listen") { const id = ++sequence; listeners.set(id, { event: String(args.event), callback: Number(args.handler) }); return id; }
        if (command === "plugin:event|unlisten") { listeners.delete(Number(args.eventId)); return null; }
        if (command === "plugin:window|destroy") { localStorage.setItem("native-destroyed", "true"); return null; }
        if (command === "plugin:window|is_maximized") return localStorage.getItem("native-maximized") === "true";
        if (["plugin:window|minimize", "plugin:window|toggle_maximize", "plugin:window|start_dragging", "plugin:window|close"].includes(command)) {
          const actions = JSON.parse(localStorage.getItem("native-window-actions") ?? "[]") as string[];
          actions.push(command); localStorage.setItem("native-window-actions", JSON.stringify(actions));
          if (localStorage.getItem("native-fail-window") === command) throw new Error("Window action unavailable");
          if (command === "plugin:window|toggle_maximize") {
            localStorage.setItem("native-maximized", String(localStorage.getItem("native-maximized") !== "true"));
            emit("tauri://resize", { width: 1440, height: 900 });
          }
          if (command === "plugin:window|close") emit("tauri://close-requested", null);
          return null;
        }
        if (command === "workspace_watch_status") return [];
        if (command === "set_capture_space") {
          localStorage.setItem("native-capture-space", spaceId);
          return { shortcutError: localStorage.getItem("native-capture-shortcut-error"), lastError: null };
        }
        if (command === "capture_status") return { shortcutError: null, lastError: null };
        if (command === "open_native_capture") {
          const state = JSON.parse(localStorage.getItem("native-capture-state") ?? '{"activeDraft":null,"lastCompleted":null}') as { activeDraft: unknown; lastCompleted: unknown };
          if (!state.activeDraft) {
            const spaces = JSON.parse(localStorage.getItem("native-spaces") ?? '[{"id":"native-default","name":"Slate"}]') as { id: string; name: string }[];
            const selected = spaces.find(space => space.id === spaceId);
            if (!selected) throw Error("Unknown Space");
            state.activeDraft = { id: crypto.randomUUID(), spaceId, spaceName: selected.name, text: "", pending: false, revision: 0 };
            localStorage.setItem("native-capture-state", JSON.stringify(state));
          }
          return null;
        }
        if (command === "pending_native_launches") return launchSnapshot(readInbox());
        if (command === "resolve_native_file") {
          const inbox = readInbox(), current = inbox.current;
          if (!current?.fileName || current.id !== args.id) throw { kind: "io", message: "This native file request is no longer active" };
          if (localStorage.getItem("native-file-unavailable")) throw { kind: "io", message: "The original file is unavailable. Your folders were kept." };
          const targets = JSON.parse(localStorage.getItem("native-os-file-targets") ?? "{}") as Record<string, FileTarget>;
          const target = targets[current.id]; if (!target) throw Error("Native file target unavailable");
          const fileScope = target.space.id === "native-default" ? "space" : "folder:" + target.space.id;
          if (read(fileScope, target.path) === null) throw Error("The original file is unavailable. Your folders were kept.");
          const spaces = JSON.parse(localStorage.getItem("native-spaces") ?? '[{"id":"native-default","name":"Slate","path":null}]') as FileTarget["space"][];
          const existing = spaces.find(space => space.id === target.space.id);
          if (existing && existing.path !== target.space.path) throw Error("This file belongs to its original Space");
          if (!existing) { spaces.push(target.space); localStorage.setItem("native-spaces", JSON.stringify(spaces)); }
          const url = new URL("slate://open"); url.searchParams.set("space", target.space.id); url.searchParams.set("path", target.path);
          if (current.url !== url.toString()) { current.url = url.toString(); current.spaceId = target.space.id; inbox.revision++; publish(inbox); }
          return { space: target.space, path: target.path, url: url.toString() };
        }
        if (["bind_native_launch", "begin_native_launch", "apply_native_launch", "review_native_launch", "complete_native_launch", "next_native_launch"].includes(command)) {
          const inbox = readInbox(), current = inbox.current, id = String(args.id), claim = String(args.claim);
          if (command === "next_native_launch") {
            if (current) throw { kind: "io", message: "Finish the current request first" };
            inbox.current = inbox.queued.shift() ?? null; inbox.revision += 1; return publish(inbox);
          }
          if (command === "complete_native_launch" && inbox.completed === id) return launchSnapshot(inbox);
          if (!current || current.id !== id) throw { kind: "io", message: "Request is no longer active" };
          if (command === "bind_native_launch") {
            if (current.fileName) throw Error("Native file roots come only from the host request");
            const target = String(args.spaceId);
            if (current.spaceId === target) return launchSnapshot(inbox);
            if (current.spaceId || current.phase !== "pending") throw { kind: "io", message: "Request belongs to its original Space" };
            current.spaceId = target;
          } else if (command === "complete_native_launch") {
            if (localStorage.getItem("native-fail-complete")) throw { kind: "io", message: "Finishing unavailable" };
            inbox.completed = id; inbox.current = null;
          } else if (command === "begin_native_launch") {
            if (current.phase === "started" && current.claim === claim) return launchSnapshot(inbox);
            if (current.phase !== "pending") throw { kind: "io", message: "Review the interrupted request" };
            if (current.fileName) localStorage.setItem("native-associated-begins", String(Number(localStorage.getItem("native-associated-begins")) + 1));
            current.phase = "started"; current.claim = claim;
          } else if (command === "apply_native_launch") {
            if (localStorage.getItem("native-fail-applied")) throw { kind: "io", message: "Finishing unavailable" };
            if (current.claim !== claim || !["started", "applied"].includes(current.phase)) throw { kind: "io", message: "Request belongs to another review" };
            if (current.phase === "applied") return launchSnapshot(inbox);
            current.phase = "applied";
          } else {
            if (current.phase !== "started") throw { kind: "io", message: "Only an interrupted request can be reviewed again" };
            current.phase = "pending"; delete current.claim;
          }
          inbox.revision += 1; const result = publish(inbox);
          if (command === "begin_native_launch" && localStorage.getItem("native-fail-begin-after-claim")) {
            localStorage.removeItem("native-fail-begin-after-claim"); throw { kind: "io", message: "Review reply unavailable" };
          }
          return result;
        }
        if (command === "list_native_spaces") {
          if (localStorage.getItem("native-fail-catalog")) throw { kind: "io", message: "Spaces list is invalid. Your folders were kept." };
          return JSON.parse(localStorage.getItem("native-spaces") ?? '[{"id":"native-default","name":"Slate","path":null}]') as unknown;
        }
        if (command === "pick_native_space") return JSON.parse(localStorage.getItem("native-picked-space") ?? "null") as unknown;
        if (command === "read_workspace_file_info") {
          if (localStorage.getItem("native-fail-info")) throw { kind: "permission", message: "File information unavailable" };
          const bytes = read(spaceScope, path); if (bytes === null) throw { kind: "io", message: "This sheet no longer exists" };
          return { absolutePath: (spaceId === "native-default" ? "C:\\Slate test Space\\" : "C:\\Chosen notes\\") + path.replaceAll("/", "\\"), bytes: bytes.length, modifiedAt: Date.UTC(2026, 10, 20), revealLabel: "Show in Explorer" };
        }
        if (command === "reveal_workspace_file") {
          if (localStorage.getItem("native-fail-reveal")) throw { kind: "io", message: "File manager unavailable" };
          if (read(spaceScope, path) === null) throw { kind: "io", message: "This sheet no longer exists" };
          localStorage.setItem("native-revealed", path); return null;
        }
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
          indexes.set(spaceId, args.rows as Row[]); return null;
        }
        if (command === "search_workspace_index") {
          const query = String(args.query).toLowerCase();
          return (indexes.get(spaceId) ?? []).filter((row) => !query || `${row.entry.title} ${row.body} ${row.entry.tags.join(" ")}`.toLowerCase().includes(query)).map((row) => row.entry.path);
        }
        throw new Error(`Unexpected native command: ${command}`);
      },
    });
  }, initial);
}
