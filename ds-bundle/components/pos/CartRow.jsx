import React from 'react';
import { Stepper } from '../forms/Stepper.jsx';

/* Baris keranjang. Nama + modifier + harga satuan di kiri; stepper qty +
   subtotal di kanan. Subtotal tabular. Qty 0 memicu onRemove lewat Stepper. */
function rupiah(n) {
  const s = 'Rp ' + Math.abs(n).toLocaleString('id-ID');
  return n < 0 ? '− ' + s : s;
}

export function CartRow({ name, modifiers, unitPrice, qty, onQty, onRemove }) {
  const handle = (next) => {
    if (next <= 0) onRemove?.();
    else onQty?.(next);
  };
  return (
    <div className="cart-row">
      <div className="grow stack" style={{ gap: 2 }}>
        <span className="t-body-md">{name}</span>
        {modifiers && <span className="t-caption">{modifiers}</span>}
        <span className="t-caption num">{rupiah(unitPrice)}</span>
      </div>
      <div className="stack" style={{ gap: 'var(--space-2)', alignItems: 'flex-end' }}>
        <Stepper value={qty} min={0} onChange={handle} label={name} />
        <span className="t-body-md num">{rupiah(unitPrice * qty)}</span>
      </div>
    </div>
  );
}
