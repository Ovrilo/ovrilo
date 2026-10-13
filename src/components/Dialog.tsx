import { type ReactNode, useEffect, useRef } from "react";

/**
 * Native modal dialog: focus trapping and backdrop are handled by the platform. The parent closes it by
 * unmounting; Escape calls `onClose`. Programmatic close() in cleanup must not call `onClose`, otherwise
 * React StrictMode's effect re-run would immediately dismiss the dialog.
 */
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2>{title}</h2>
      {children}
    </dialog>
  );
}
