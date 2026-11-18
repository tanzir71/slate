import { useCallback, useMemo, useRef, useState } from "react";
import {
  createSmartPaste,
  type PasteNotice,
  type SmartPasteOptions,
} from "@slate/editor";
import "./pasteNotice.css";

interface PendingPaste extends PasteNotice {
  readonly id: number;
}

export function useSmartPaste({
  richText = true,
  links = true,
  images = true,
  tables = true,
  importImage,
}: Omit<SmartPasteOptions, "importImage"> & {
  importImage?: SmartPasteOptions["importImage"];
}) {
  const [pending, setPending] = useState<readonly PendingPaste[]>([]);
  const sequence = useRef(0);
  const receive = useCallback((notice: PasteNotice) => {
    const item = { ...notice, id: ++sequence.current };
    setPending((previous) => [...previous, item]);
  }, []);
  const dismiss = useCallback((id: number) => {
    setPending((previous) => previous.filter((notice) => notice.id !== id));
  }, []);
  const extension = useMemo(
    () =>
      createSmartPaste({
        richText,
        links,
        images,
        tables,
        ...(importImage ? { importImage } : {}),
        onNotice: receive,
      }),
    [richText, links, images, tables, importImage, receive],
  );
  return {
    extension,
    notices: pending.map((notice) => (
      <div className="pasteNotice" role="status" key={notice.id}>
        <span>{notice.message}</span>
        {notice.retry && (
          <button
            type="button"
            onClick={() => {
              if (notice.retry?.()) dismiss(notice.id);
            }}
          >
            Retry paste
          </button>
        )}
        <button
          type="button"
          aria-label="Dismiss paste notice"
          onClick={() => dismiss(notice.id)}
        >
          Dismiss
        </button>
      </div>
    )),
  };
}
