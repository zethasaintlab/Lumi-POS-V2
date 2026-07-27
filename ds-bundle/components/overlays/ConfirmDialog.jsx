import React from 'react';
import { Button } from '../forms/Button.jsx';
import { Field } from '../forms/Field.jsx';
import { Chip } from '../forms/Chip.jsx';

/* Dialog konfirmasi aksi merusak — berbeda dari dialog biasa. Void, refund,
   dan tutup sesi kas butuh PIN owner + alasan dari DAFTAR TERTUTUP. "Lainnya"
   mewajibkan catatan. Tombol konfirmasi = danger, 56px (aksi menyangkut uang),
   dan nonaktif sampai PIN & alasan terisi. */
const REASONS = ['Salah input', 'Tamu batal', 'Item habis', 'Kualitas', 'Lainnya'];

export function ConfirmDialog({
  open = true,
  title,
  description,
  detail,
  pin,
  onPin,
  reason,
  onReason,
  note,
  onNote,
  reasons = REASONS,
  pinError,
  confirmLabel = 'Konfirmasi',
  onConfirm,
  onCancel,
}) {
  if (!open) return null;
  const needsNote = reason === 'Lainnya';
  const ready = pin && pin.length >= 4 && reason && (!needsNote || (note && note.trim()));
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="dialog dialog-danger">
        <div className="dialog-pad stack" style={{ gap: 'var(--space-4)' }}>
          <div className="stack" style={{ gap: 'var(--space-1)' }}>
            <div className="t-title">{title}</div>
            {description && <div className="t-body" style={{ color: 'var(--ink-muted)' }}>{description}</div>}
          </div>

          {detail && (
            <div className="card card-pad" style={{ background: 'var(--surface-sunk)', boxShadow: 'none' }}>
              {detail}
            </div>
          )}

          <div className="stack" style={{ gap: 'var(--space-2)' }}>
            <span className="label" style={{ margin: 0 }}>Alasan <span style={{ color: 'var(--danger)' }}>*</span></span>
            <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--space-2)' }}>
              {reasons.map((r) => (
                <Chip key={r} selected={reason === r} onClick={() => onReason?.(r)}>{r}</Chip>
              ))}
            </div>
          </div>

          {needsNote && (
            <Field
              label="Catatan"
              id="cd-note"
              required
              as="textarea"
              placeholder="Wajib diisi untuk alasan Lainnya…"
              value={note || ''}
              onChange={(e) => onNote?.(e.target.value)}
            />
          )}

          <Field
            label="PIN Owner"
            id="cd-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            placeholder="••••"
            required
            error={pinError}
            value={pin || ''}
            onChange={(e) => onPin?.(e.target.value)}
          />
        </div>
        <div className="dialog-foot">
          <Button variant="ghost" fullWidth onClick={onCancel}>Batal</Button>
          <Button variant="danger" critical fullWidth disabled={!ready} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
