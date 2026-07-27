import React from 'react';
import { Icon } from './Icon.jsx';

/* Stepper qty. Tiap tombol tetap 44×44px meski komponennya ringkas —
   tombol kecil di dalam keranjang tetap harus bisa ditekan tangan basah.
   Berhenti di `min` (default 0); di 0 tombol kurang nonaktif, bukan hilang. */
export function Stepper({ value, min = 0, max = 999, onChange, label = 'item', disabled = false }) {
  const dec = () => !disabled && value > min && onChange?.(value - 1);
  const inc = () => !disabled && value < max && onChange?.(value + 1);
  return (
    <div className="stepper" role="group" aria-label={`Jumlah ${label}`}>
      <button type="button" onClick={dec} disabled={disabled || value <= min} aria-label={`Kurangi ${label}`}>
        <Icon name="minus" size={20} />
      </button>
      <span className="num" aria-live="polite">{value}</span>
      <button type="button" onClick={inc} disabled={disabled || value >= max} aria-label={`Tambah ${label}`}>
        <Icon name="plus" size={20} />
      </button>
    </div>
  );
}
