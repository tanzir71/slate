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
  headerActions,
  initialFocus,
  closeIcon,
  headerContent,
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
  busy?: boolean;
  className?: string;
  returnFocus?: HTMLElement | undefined;
  headerActions?: ReactNode;
  initialFocus?: { readonly current: HTMLElement | null };
  closeIcon?: ReactNode;
  headerContent?: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const invoker = useRef(document.activeElement);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    (initialFocus?.current ?? element?.querySelector<HTMLElement>("[autofocus], input, select, textarea"))?.focus();
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
      {headerContent ?? <header>
        <h2>{title}</h2>
        {headerActions}
        <button aria-label={`Close ${title}`} disabled={busy} onClick={onClose}>
          {closeIcon ?? <X size={17} />}
        </button>
      </header>}
      {children}
    </dialog>
  );
}
