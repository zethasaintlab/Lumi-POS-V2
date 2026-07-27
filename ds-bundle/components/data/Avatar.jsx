import React from 'react';

/* Avatar inisial. Ukuran bebas; default aksen-soft. Dipakai di sidebar
   user, profil karyawan, baris customer. */
export function Avatar({ name = '', size = 36, tone }) {
  const initials = name.split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
  const style = { width: size, height: size, fontSize: Math.round(size * 0.4) };
  if (tone) { style.background = `var(--${tone}-soft)`; style.color = `var(--${tone})`; }
  return <span className="avatar" style={style} aria-hidden="true">{initials}</span>;
}
