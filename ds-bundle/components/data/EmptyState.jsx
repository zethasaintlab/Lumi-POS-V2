import React from 'react';

/* Keadaan kosong — setiap komponen wajib punya ini, bukan grid kosong.
   `action` menawarkan jalan keluar ("Tambah produk pertama"). Untuk KDS
   tanpa order, sertakan `clock` (jam berjalan) agar terbukti layar hidup,
   bukan hang. */
export function EmptyState({ icon, title, body, action, clock }) {
  return (
    <div className="empty">
      {icon && <div style={{ color: 'var(--border-strong)' }}>{icon}</div>}
      {title && <div className="t-title" style={{ color: 'var(--ink-muted)' }}>{title}</div>}
      {body && <div className="t-body" style={{ maxWidth: '32ch' }}>{body}</div>}
      {clock && <div className="t-display num" style={{ color: 'var(--ink-subtle)', marginTop: 'var(--space-2)' }}>{clock}</div>}
      {action && <div style={{ marginTop: 'var(--space-2)' }}>{action}</div>}
    </div>
  );
}
