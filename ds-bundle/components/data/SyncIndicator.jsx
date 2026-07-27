import React from 'react';
import { Icon } from '../forms/Icon.jsx';

/* Indikator sync — tiga keadaan yang harus bisa dibedakan sekilas, karena
   aplikasi ini offline-first dan sebagian besar waktunya bukan di state
   normal:
     ok      → tenang, tidak menarik perhatian.
     queued  → warning + JUMLAH ("Offline · 3 menunggu").
     failed  → danger + jumlah + TOMBOL tindakan ("Gagal kirim (2) · Coba lagi").
   Fungsi yang memang tidak bisa offline menampilkan ALASANNYA, bukan spinner. */
export function SyncIndicator({ state, count, onRetry, reason }) {
  if (state === 'ok') {
    return (
      <span className="sync sync-ok" role="status">
        <span className="dot" /> Tersinkron
      </span>
    );
  }
  if (state === 'queued') {
    return (
      <span className="sync sync-queued" role="status" title={`${count} order menunggu dikirim`}>
        <Icon name="wifi-off" size={14} /> Offline · {count} menunggu
      </span>
    );
  }
  if (state === 'offline-only') {
    return (
      <span className="sync sync-queued" role="status" title={reason}>
        <Icon name="wifi-off" size={14} /> {reason || 'Butuh koneksi'}
      </span>
    );
  }
  // failed
  return (
    <span className="sync sync-failed" role="status" style={{ gap: 'var(--space-2)' }}>
      <span className="row" style={{ gap: 'var(--space-1)' }}>
        <span className="dot" /> Gagal kirim ({count})
      </span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="btn btn-danger"
          style={{ minHeight: 28, padding: '0 var(--space-2)', fontSize: 'var(--text-caption)' }}
        >
          <Icon name="refresh" size={13} /> Coba lagi
        </button>
      )}
    </span>
  );
}
