import * as React from 'react';

/** Keadaan kosong / first-run. Tawarkan jalan keluar, bukan grid kosong. */
export interface EmptyStateProps {
  icon?: React.ReactNode;
  title?: React.ReactNode;
  body?: React.ReactNode;
  /** Tombol CTA, mis. "Tambah produk pertama". */
  action?: React.ReactNode;
  /** Jam berjalan (KDS tanpa order) — membuktikan layar hidup, bukan hang. */
  clock?: React.ReactNode;
}

export declare function EmptyState(props: EmptyStateProps): React.JSX.Element;
