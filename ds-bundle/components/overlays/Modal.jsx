import React from 'react';
import { Icon } from '../forms/Icon.jsx';

/* Modal umum (bukan aksi merusak — untuk itu pakai ConfirmDialog).
   New Customer, Add Table, dsb. Header + body (children) + footer aksi. */
export function Modal({ open = true, title, onClose, children, footer, width = 460 }) {
  /* ⛔ HOOK DI ATAS `if (!open)`, bukan di bawahnya.
     Early return sebelum hook membuat jumlah hook berubah antar render, dan
     React menjawabnya dengan membongkar seluruh pohon — persis cacat yang
     membuat back-office menjadi halaman putih saat login (31 Agustus 2026). */
  React.useEffect(() => {
    /* ⛔ Escape MENUTUP dialog.
       Sampai 31 Agustus 2026 tidak ada penanganan Escape sama sekali:
       satu-satunya jalan keluar adalah menekan ✕ atau mengklik tepat di luar
       kotak dialog. Diverifikasi di browser — Escape ditekan, dialog tetap
       terbuka. Escape adalah gerakan tutup yang universal, dan dialog yang
       mengabaikannya terasa macet, bukan terasa modal. */
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} onClick={onClose}>
      <div className="dialog" style={{ maxWidth: width }} onClick={(e) => e.stopPropagation()}>
        <div className="row between" style={{ padding: 'var(--space-4) var(--space-6)', borderBottom: '1px solid var(--border)' }}>
          <span className="t-title">{title}</span>
          {/* ⛔ 44px, bukan 36px. Aturan DS #3 menuntut target sentuh ≥ 44px,
              dan tombol tutup adalah satu-satunya jalan keluar dialog di
              perangkat sentuh — target terkecil di layar seharusnya bukan ini. */}
          <button className="btn btn-ghost" style={{ minHeight: 44, minWidth: 44, padding: 0 }} onClick={onClose} aria-label="Tutup"><Icon name="x" size={18} /></button>
        </div>
        <div className="dialog-pad stack" style={{ gap: 'var(--space-4)' }}>{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}
