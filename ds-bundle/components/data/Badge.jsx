import React from 'react';

/* Badge status. Status TIDAK PERNAH warna saja — `children` (teks) wajib,
   `icon` opsional (dipakai di KDS untuk keterbacaan di bawah glare).
   Warna semantik hanya untuk status, tidak pernah dekoratif. */
export function Badge({ tone = 'neutral', icon, children, className = '', ...rest }) {
  const cls = ['badge', `badge-${tone}`, className].filter(Boolean).join(' ');
  return (
    <span className={cls} {...rest}>
      {icon}
      {children}
    </span>
  );
}
