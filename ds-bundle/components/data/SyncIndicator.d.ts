import * as React from 'react';

/**
 * Status sinkronisasi offline-first. Tiga keadaan yang bisa dibedakan sekilas.
 * @startingPoint section="Data" subtitle="Sync ok / mengantre / gagal" viewport="700x120"
 */
export interface SyncIndicatorProps {
  /** ok = tenang · queued = mengantre + jumlah · failed = + tombol · offline-only = tampilkan alasan. */
  state: 'ok' | 'queued' | 'failed' | 'offline-only';
  /** Jumlah order menunggu/gagal (queued & failed). */
  count?: number;
  /** Handler "Coba lagi" (failed). */
  onRetry?: () => void;
  /** Alasan tidak bisa offline (offline-only), mis. "Butuh koneksi untuk data realtime". */
  reason?: string;
}

export declare function SyncIndicator(props: SyncIndicatorProps): React.JSX.Element;
