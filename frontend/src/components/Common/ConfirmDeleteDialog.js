import React, { useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import './ConfirmDeleteDialog.css';

export default function ConfirmDeleteDialog({
  open,
  title = 'Delete this item?',
  highlight = 'Selected item',
  description = 'This action cannot be undone.',
  confirmLabel = 'Delete',
  loadingLabel = 'Deleting...',
  cancelLabel = 'Cancel',
  loading = false,
  onClose,
  onConfirm
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !loading) {
        onClose?.();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [loading, onClose, open]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="app-confirm-modal-backdrop"
      onClick={() => {
        if (!loading) onClose?.();
      }}
    >
      <section
        className="app-confirm-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="app-confirm-modal-head">
          <div className="app-confirm-modal-icon" aria-hidden="true">
            <DeleteOutlineRoundedIcon fontSize="small" />
          </div>

          <div className="app-confirm-modal-copy">
            <h4 id={titleId}>{title}</h4>
            {highlight ? <p className="app-confirm-modal-highlight">{highlight}</p> : null}
            {description ? <p className="app-confirm-modal-desc">{description}</p> : null}
          </div>
        </div>

        <div className="app-confirm-modal-actions">
          <button
            type="button"
            className="app-confirm-modal-btn secondary"
            onClick={onClose}
            disabled={loading}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="app-confirm-modal-btn danger"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? loadingLabel : confirmLabel}
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}
