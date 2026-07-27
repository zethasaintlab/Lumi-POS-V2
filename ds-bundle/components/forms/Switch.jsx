import React from 'react';

/* Switch setelan on/off. Track 44px = target sentuh minimum. Selalu
   didampingi label + deskripsi (setelan tidak pernah ikon telanjang). */
export function Switch({ checked = false, onChange, disabled = false, label, ariaLabel }) {
  return (
    <label className="switch" style={disabled ? { opacity: .4, cursor: 'not-allowed' } : undefined}>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled}
        aria-label={ariaLabel || (typeof label === 'string' ? label : undefined)}
        onChange={(e) => onChange?.(e.target.checked)} />
      <span className="track" />
      <span className="thumb" />
    </label>
  );
}
