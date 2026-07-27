import React from 'react';
import { Icon } from '../forms/Icon.jsx';

/* Modal umum (bukan aksi merusak — untuk itu pakai ConfirmDialog).
   New Customer, Add Table, dsb. Header + body (children) + footer aksi. */
export function Modal({ open = true, title, onClose, children, footer, width = 460 }) {
  if (!open) return null;
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} onClick={onClose}>
      <div className="dialog" style={{ maxWidth: width }} onClick={(e) => e.stopPropagation()}>
        <div className="row between" style={{ padding: 'var(--space-4) var(--space-6)', borderBottom: '1px solid var(--border)' }}>
          <span className="t-title">{title}</span>
          <button className="btn btn-ghost" style={{ minHeight: 36, minWidth: 36, padding: 0 }} onClick={onClose} aria-label="Tutup"><Icon name="x" size={18} /></button>
        </div>
        <div className="dialog-pad stack" style={{ gap: 'var(--space-4)' }}>{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}
