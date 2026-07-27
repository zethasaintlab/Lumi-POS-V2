import React from 'react';
import { Badge } from '../data/Badge.jsx';

/* Kartu produk grid kasir. Tinggi 96px diturunkan dari density: min 12
   kartu tanpa scroll di 1024×768 (bukan selera). Nama di-truncate; habis
   diredupkan + badge "Habis" (state, bukan warna saja). */
function rupiah(n) {
  return 'Rp ' + n.toLocaleString('id-ID');
}

export function ProductCard({ name, sku, price, available = true, onAdd }) {
  return (
    <button
      type="button"
      className="product-card"
      data-out={!available}
      onClick={available ? onAdd : undefined}
      aria-disabled={!available}
    >
      <span className="t-body-md truncate" style={{ width: '100%' }}>{name}</span>
      {sku && <span className="t-caption">{sku}</span>}
      <span className="grow" />
      <span className="row between" style={{ width: '100%' }}>
        <span className="t-body-md num">{rupiah(price)}</span>
        {!available && <Badge tone="danger">Habis</Badge>}
      </span>
    </button>
  );
}
