import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export function WorkspaceDialog({
  title,
  onClose,
  children,
  busy = false,
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
  busy?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const invoker = useRef(document.activeElement);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    element
      ?.querySelector<HTMLElement>("[autofocus], input, select, textarea")
      ?.focus();
    return () => {
      element?.close();
      if (invoker.current instanceof HTMLElement && invoker.current.isConnected)
        invoker.current.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="workspaceDialog"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button aria-label={`Close ${title}`} disabled={busy} onClick={onClose}>
          <X size={17} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
