import React from 'react';
import { Badge } from '../data/Badge.jsx';
import { Icon } from '../forms/Icon.jsx';
import { Button } from '../forms/Button.jsx';

/* Tiket KDS. Dibaca dari 2 meter di dalam .kds-scale (semua teks ×1.6).
   Nomor order = display, nama item = title. Fulfillment dilacak PER ITEM
   (checkbox), status order diturunkan darinya ("1 dari 2 item selesai").
   Keterlambatan ditandai border + ikon + teks, bukan warna saja. */
export function Ticket({
  code, orderNo, orderType, waited, late = false,
  items, doneCount, primaryLabel, onPrimary, status,
}) {
  return (
    <article className="ticket" data-late={late}>
      <div className="ticket-head">
        <span className="t-display num">{code}</span>
        <div style={{ textAlign: 'right' }}>
          <div className="t-body-md num">{waited}</div>
          <div className="t-caption">{orderNo} · {orderType}</div>
        </div>
      </div>
      <div className="ticket-items">
        {items.map((it, i) => (
          <div key={i} className={`item${it.done ? ' done' : ''}`}>
            <span className="qty t-title num">{it.qty}×</span>
            <div>
              <div className="t-title">{it.name}</div>
              {it.note && <div className="t-caption">{it.note}</div>}
            </div>
          </div>
        ))}
      </div>
      <div className="ticket-foot stack" style={{ gap: 'var(--space-2)' }}>
        {late && (
          <Badge tone="warning" icon={<Icon name="alert" size={14} />}>Lewat 10 menit</Badge>
        )}
        {status === 'ready' && (
          <Badge tone="success" icon={<Icon name="check" size={14} />}>Siap diantar</Badge>
        )}
        {typeof doneCount === 'number' && (
          <span className="t-caption">{doneCount} dari {items.length} item selesai</span>
        )}
        {primaryLabel && (
          <Button
            variant={status === 'processing' ? 'secondary' : 'primary'}
            fullWidth
            onClick={onPrimary}
          >
            {primaryLabel}
          </Button>
        )}
      </div>
    </article>
  );
}
