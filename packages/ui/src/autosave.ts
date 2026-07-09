export interface AutosaveWriteOptions {
  baseContent?: string;
}

export interface AutosaveWriteResult {
  status: "written" | "conflict-copy";
  path: string;
  savedContent?: string;
}

export interface SheetAutosaveWriter {
  writeSheet(path: string, content: string, options: AutosaveWriteOptions): Promise<AutosaveWriteResult>;
}

export interface AutosaveScheduleInput {
  path: string;
  content: string;
  baseContent: string;
}

export interface AutosaveController {
  schedule(input: AutosaveScheduleInput): void;
  flush(): Promise<void>;
  dispose(): Promise<void>;
}

export interface AutosaveControllerOptions {
  writer: SheetAutosaveWriter;
  delayMs?: number;
}

export function createAutosaveController({
  writer,
  delayMs = 700
}: AutosaveControllerOptions): AutosaveController {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: AutosaveScheduleInput | undefined;
  let inFlight: Promise<void> = Promise.resolve();
  const lastSavedByPath = new Map<string, string>();

  async function savePending(): Promise<void> {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }

    const next = pending;
    pending = undefined;
    if (!next) {
      return inFlight;
    }

    return queueWrite(next);
  }

  function queueWrite(next: AutosaveScheduleInput): Promise<void> {
    const save = inFlight.then(async () => {
      const result = await writer.writeSheet(next.path, next.content, {
        baseContent: lastSavedByPath.get(next.path) ?? next.baseContent
      });
      if (result.status === "written") {
        lastSavedByPath.set(next.path, result.savedContent ?? next.content);
      }
    });
    inFlight = save.catch(() => undefined);
    return save;
  }

  return {
    schedule(input) {
      pending = input;
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        void savePending().catch(() => undefined);
      }, delayMs);
    },

    flush() {
      return savePending();
    },

    dispose() {
      return savePending();
    }
  };
}

export function createBrowserDraftAutosaveWriter(storageKey = "slate.autosave"): SheetAutosaveWriter {
  return {
    async writeSheet(path, content) {
      const store = readDraftStore(storageKey);
      store[path] = content;
      globalThis.localStorage?.setItem(storageKey, JSON.stringify(store));
      return { status: "written", path, savedContent: content };
    }
  };
}

function readDraftStore(storageKey: string): Record<string, string> {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    return isStringRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}
