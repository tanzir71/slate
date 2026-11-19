import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  editTidyConfiguration,
  readTidyConfiguration,
  type TidyConfiguration,
  type TidyConfigurationPatch,
} from "@slate/core/tidy/settings";
import type { TidyReport, TidyResult } from "@slate/core/tidy";
import type { BrowserSpace } from "@slate/storage/browser-space";
import type { TidyFile } from "@slate/storage/browser-tidy";
import type { NoteSaveSnapshot } from "../browser/workspaceStore";
import { createTidyWorkerClient } from "./tidyWorkerClient";

const defaults = readTidyConfiguration();
const failure = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);
const aborted = (cause: unknown) =>
  cause instanceof DOMException && cause.name === "AbortError";
interface TidyReviewOptions {
  readonly space: BrowserSpace;
  readonly source: string | undefined;
  readonly path: string | undefined;
  readonly canWrite: () => boolean;
  readonly apply: (result: TidyResult) => boolean;
  readonly subscribeNoteSaved?: (
    listener: (snapshot: NoteSaveSnapshot) => void,
  ) => () => void;
}

export function useTidyReview({
  space,
  source,
  path,
  canWrite,
  apply,
  subscribeNoteSaved,
}: TidyReviewOptions) {
  const owner = useMemo(() => ({ active: true }), [space]);
  const loader = useMemo(() => {
    let loaded:
      | Promise<
          ReturnType<
            (typeof import("@slate/storage/browser-tidy"))["createTidyFileStore"]
          >
        >
      | undefined;
    return () =>
      (loaded ??= import("@slate/storage/browser-tidy")
        .then(({ createTidyFileStore }) => createTidyFileStore(space))
        .catch((cause: unknown) => {
          loaded = undefined;
          throw cause;
        }));
  }, [space]);
  const [settings, setSettings] = useState<{ owner: object; file: TidyFile }>();
  const file = settings?.owner === owner ? settings.file : undefined;
  const [analysis, setAnalysis] = useState<{
    owner: object;
    report: TidyReport;
    configuration: TidyConfiguration;
  }>();
  const [diff, setDiff] = useState<TidyResult>();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  const [savedIntent, setSavedIntent] = useState<{
    owner: object;
    snapshot: NoteSaveSnapshot;
    configuration: TidyConfiguration | undefined;
  }>();
  const refreshId = useRef(0);
  const client = useRef<ReturnType<typeof createTidyWorkerClient> | undefined>(
    undefined,
  );
  const configuration = file?.configuration ?? defaults;
  const ready =
    source !== undefined &&
    path !== undefined &&
    (file?.status === "valid" || file?.status === "missing");
  const target = useRef({ source, path, configuration, file, canWrite, apply });
  useLayoutEffect(() => {
    target.current = { source, path, configuration, file, canWrite, apply };
  });
  useEffect(
    () =>
      subscribeNoteSaved?.((snapshot) => {
        if (snapshot.origin !== "input" && snapshot.origin !== "explicit-save")
          return;
        const current = target.current;
        if (
          current.file &&
          (current.file.status !== "valid" || !current.configuration.onSave)
        )
          return;
        // A save can precede React's commit or the initial settings read. Validate in the effect.
        setSavedIntent({
          owner,
          snapshot,
          configuration: current.file ? current.configuration : undefined,
        });
      }),
    [owner, subscribeNoteSaved],
  );
  const refresh = useCallback(async () => {
    const id = ++refreshId.current;
    const next = await (await loader()).read();
    if (owner.active && id === refreshId.current)
      setSettings((previous) =>
        previous?.owner === owner &&
        previous.file.status === next.status &&
        previous.file.source === next.source &&
        previous.file.error === next.error
          ? previous
          : { owner, file: next },
      );
  }, [loader, owner]);
  useEffect(() => {
    owner.active = true;
    void refresh().catch((cause: unknown) => {
      if (owner.active) setError(failure(cause));
    });
    return () => {
      owner.active = false;
    };
  }, [owner, refresh]);
  useEffect(() => {
    if (!ready) return;
    let current: ReturnType<typeof createTidyWorkerClient>;
    try {
      current = createTidyWorkerClient(
        new Worker(new URL("./tidy.worker.ts", import.meta.url), {
          type: "module",
        }),
      );
      client.current = current;
    } catch {
      setError("Tidy is unavailable. Try again.");
      setPending(false);
      return;
    }
    return () => {
      current.close();
      if (client.current === current) client.current = undefined;
    };
  }, [owner, ready, retry]);
  useEffect(() => {
    const current = client.current;
    if (!ready || source === undefined || !current) return;
    let active = true;
    setPending(true);
    setError("");
    setDiff(undefined);
    const timer = setTimeout(() => {
      void current
        .lint(source, configuration)
        .then((next) => {
          if (active && owner.active) {
            setAnalysis({ owner, report: next, configuration });
            setPending(false);
          }
        })
        .catch((cause: unknown) => {
          if (active && owner.active && !aborted(cause)) {
            setError(failure(cause));
            setPending(false);
          }
        });
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
      current.cancel();
    };
  }, [owner, ready, source, path, configuration, retry]);
  const currentReport =
    ready &&
    analysis?.owner === owner &&
    analysis.report.source === source &&
    analysis.configuration === configuration
      ? analysis.report
      : undefined;
  const propose = useCallback(
    async (issueIds?: readonly string[], preview = false) => {
      if (!currentReport || busy || !client.current) return;
      const captured = target.current;
      if (captured.source === undefined) return;
      setBusy(true);
      setError("");
      setNotice("");
      try {
        const result = await client.current.fix(
          captured.source,
          captured.configuration,
          issueIds,
        );
        if (!owner.active) return;
        const now = target.current;
        if (
          now.source !== captured.source ||
          now.path !== captured.path ||
          now.configuration !== captured.configuration
        )
          throw new Error(
            "The sheet or rules changed. Review the current fixes again.",
          );
        if (preview) setDiff(result);
        else {
          if (!now.canWrite())
            throw new Error(
              "This Space is read-only. Choose Use here to edit.",
            );
          if (result.changes.length && !now.apply(result))
            throw new Error(
              "The sheet changed. Review the current fixes again.",
            );
          setDiff(undefined);
          setNotice(
            result.rejected.length
              ? "Some proposals need a manual edit. Their original content was kept."
              : result.changes.length
                ? "Tidy applied. Undo restores the previous source."
                : "No safe changes to apply.",
          );
        }
      } catch (cause) {
        if (owner.active && !aborted(cause)) setError(failure(cause));
      } finally {
        if (owner.active) setBusy(false);
      }
    },
    [currentReport, busy, owner],
  );
  useEffect(() => {
    if (!savedIntent) return;
    const now = target.current;
    if (
      savedIntent.owner !== owner ||
      !owner.active ||
      savedIntent.snapshot.path !== path ||
      savedIntent.snapshot.source !== source ||
      !now.canWrite()
    ) {
      setSavedIntent(undefined);
      return;
    }
    if (!file) return;
    if (
      file.status !== "valid" ||
      !configuration.onSave ||
      (savedIntent.configuration !== undefined &&
        savedIntent.configuration !== configuration)
    ) {
      setSavedIntent(undefined);
      return;
    }
    // Autosave precedes the lint debounce. Wait for the exact source/rules report.
    if (!currentReport || busy) return;
    setSavedIntent(undefined);
    if (currentReport.issues.some((issue) => issue.changes.length))
      void propose();
  }, [
    savedIntent,
    owner,
    source,
    path,
    file,
    configuration,
    currentReport,
    busy,
    canWrite,
    propose,
  ]);
  async function saveSettings(
    sourceText: string,
    snapshot: TidyFile | undefined = file,
  ) {
    if (saving || !snapshot) return false;
    setSaving(true);
    setError("");
    try {
      if (!target.current.canWrite())
        throw new Error("This Space is read-only. Choose Use here to edit.");
      const store = await loader();
      if (!owner.active) return false;
      if (!target.current.canWrite())
        throw new Error("This Space is read-only. Choose Use here to edit.");
      const result = await store.save(snapshot, sourceText);
      await refresh();
      if (!owner.active) return false;
      if (result.conflict)
        throw new Error(
          `Settings changed outside Slate. Your proposal was kept in ${result.path}. Review the current rules again.`,
        );
      return true;
    } catch (cause) {
      if (owner.active) setError(failure(cause));
      return false;
    } finally {
      if (owner.active) setSaving(false);
    }
  }
  async function changeConfiguration(patch: TidyConfigurationPatch) {
    if (file?.status !== "valid" && file?.status !== "missing") {
      setError("Repair the Tidy settings before changing rules.");
      return;
    }
    try {
      await saveSettings(editTidyConfiguration(file.source, patch));
    } catch (cause) {
      if (owner.active) setError(failure(cause));
    }
  }
  return {
    open,
    setOpen,
    report: currentReport,
    diff,
    closeDiff: () => setDiff(undefined),
    configuration,
    file,
    pending: ready && pending,
    busy,
    saving,
    error: error || file?.error || "",
    notice,
    refresh,
    apply: (ids?: readonly string[]) => propose(ids),
    preview: () => propose(undefined, true),
    saveSettings,
    changeConfiguration,
    retry: () => {
      setRetry((value) => value + 1);
      void refresh().catch((cause: unknown) => setError(failure(cause)));
    },
  };
}
