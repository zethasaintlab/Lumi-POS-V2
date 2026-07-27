import React from 'react';

/* Kartu — pembeda visual utama adalah border, bukan bayangan. Kafe terang;
   bayangan tebal hilang di bawah glare. `pad` menambah padding standar. */
export function Card({ pad = true, className = '', children, ...rest }) {
  const cls = ['card', pad ? 'card-pad' : '', className].filter(Boolean).join(' ');
  return <div className={cls} {...rest}>{children}</div>;
}
