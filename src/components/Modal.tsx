import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  /** Tailwind max-width class for the panel, e.g. "max-w-lg". */
  maxWidth?: string;
  /** Extra classes for the panel (e.g. a dark lightbox style). */
  panelClassName?: string;
  /** Hide the built-in close button (for fully custom headers). */
  hideCloseButton?: boolean;
}

/**
 * Shared accessible modal dialog:
 * role="dialog" + aria-modal, ESC to close, click on overlay to close,
 * focuses the panel on open and restores focus on close, locks body scroll.
 */
const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  children,
  maxWidth = 'max-w-lg',
  panelClassName = '',
  hideCloseButton = false,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<Element | null>(null);
  const titleId = useRef(`modal-title-${Math.random().toString(36).slice(2, 9)}`);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement;
    // Focus the panel so keyboard/screen-reader users land inside the dialog
    const t = window.setTimeout(() => panelRef.current?.focus(), 0);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.clearTimeout(t);
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
      const el = restoreFocusRef.current;
      if (el instanceof HTMLElement) el.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId.current}
        tabIndex={-1}
        className={`animate-fade-in-up w-full ${maxWidth} rounded-lg border border-journal-200 bg-white shadow-xl outline-none ${panelClassName}`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-journal-100 px-5 py-4">
          <h3 id={titleId.current} className="m-0 text-lg font-serif font-bold text-journal-900">
            {title}
          </h3>
          {!hideCloseButton && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="rounded p-1 text-journal-500 transition-colors hover:bg-journal-50 hover:text-journal-800"
            >
              <X size={20} />
            </button>
          )}
        </div>
        <div className="max-h-[75vh] overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body
  );
};

export default Modal;
