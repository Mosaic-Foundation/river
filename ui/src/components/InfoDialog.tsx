// A small modal explainer on the native <dialog> (spec F1's Sample explainer; the visitor's
// Follow note). showModal() traps focus and closes on Escape; on close, focus goes back to the
// control that opened it (check 3).
import { useEffect, useId, useRef } from "react";

export interface InfoDialogProps {
  /** The control that opened the dialog, or null when closed. */
  trigger: HTMLElement | null;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  testId?: string;
  /** The closing button's label (default "Got it"). */
  closeLabel?: string;
}

export function InfoDialog({ trigger, title, children, onClose, testId, closeLabel = "Got it" }: InfoDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const open = trigger !== null;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="info-dialog"
      aria-labelledby={titleId}
      data-testid={testId}
      onClose={() => {
        onClose();
        trigger?.focus();
      }}
      onClick={(e) => {
        // A click on the backdrop (the dialog element itself, outside its content) closes it.
        if (e.target === e.currentTarget) e.currentTarget.close();
      }}
    >
      <div className="info-dialog-body">
        <h2 id={titleId} className="info-dialog-title">
          {title}
        </h2>
        {children}
        <button type="button" className="button button-primary" autoFocus onClick={() => ref.current?.close()}>
          {closeLabel}
        </button>
      </div>
    </dialog>
  );
}
