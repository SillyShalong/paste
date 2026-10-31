import { useEffect, useRef } from "react";

/// In-panel confirmation popover. Replaces native confirm() dialogs, which
/// steal focus from the panel and trip the auto-hide-on-blur behavior.
export default function ConfirmPopover({
  message,
  confirmLabel,
  onConfirm,
  onDismiss,
}: {
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onDismiss();
    };
    // Capture phase so Escape closes the popover BEFORE the global keydown
    // handler can hide the whole panel.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onDismiss();
      }
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        onConfirm();
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onConfirm, onDismiss]);

  return (
    <div className="confirm-pop" ref={ref} onMouseDown={(e) => e.stopPropagation()}>
      <span className="confirm-msg">{message}</span>
      <button
        className="confirm-yes"
        onClick={() => {
          onConfirm();
        }}
      >
        {confirmLabel}
      </button>
      <button className="confirm-no" onClick={onDismiss}>
        Cancel
      </button>
    </div>
  );
}
