import React from 'react';

/* Tombol Lumi. Varian menandai peran, ukuran menandai risiko.
   `critical` = 56px untuk aksi yang menyangkut uang (Bayar, Tutup Kas,
   konfirmasi void) — kasir berdiri, satu tangan, tangan sering basah.
   Aksen dibatasi < 5% area: hanya SATU tombol `primary` per layar. */
export function Button({
  variant = 'secondary',
  critical = false,
  fullWidth = false,
  type = 'button',
  className = '',
  children,
  ...rest
}) {
  const cls = [
    'btn',
    `btn-${variant}`,
    critical ? 'btn-critical' : '',
    className,
  ].filter(Boolean).join(' ');
  const style = fullWidth ? { width: '100%', ...(rest.style || {}) } : rest.style;
  return (
    <button type={type} className={cls} {...rest} style={style}>
      {children}
    </button>
  );
}
