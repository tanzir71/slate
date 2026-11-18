import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import "../workspaceDialog.css";

export function WorkspaceDialog({
  title,
  onClose,
  children,
  busy = false,
  className = "",
  returnFocus,
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
  busy?: boolean;
  className?: string;
  returnFocus?: HTMLElement | undefined;
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
      const focus = returnFocus ?? invoker.current;
      if (focus instanceof HTMLElement && focus.isConnected) focus.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`workspaceDialog ${className}`.trim()}
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
