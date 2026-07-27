import React from 'react';

/* Chip pilihan tunggal dalam satu grup — kategori katalog, rentang waktu
   laporan. Terpilih = aksen penuh. Tinggi 44px (target sentuh). Pakai di
   dalam grup horizontal yang bisa di-scroll. */
export function Chip({ selected = false, children, className = '', ...rest }) {
  return (
    <button
      type="button"
      className={['chip', className].filter(Boolean).join(' ')}
      aria-pressed={selected}
      {...rest}
    >
      {children}
    </button>
  );
}
