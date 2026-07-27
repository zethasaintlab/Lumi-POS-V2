import * as React from 'react';

/** Kartu KPI dengan garis-atas aksen menandai identitas modul. */
export interface StatCardProps {
  label: React.ReactNode;
  value: React.ReactNode;
  icon?: React.ReactNode;
  /** Warna identitas modul (bukan aksi utama). */
  tone?: 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'violet' | 'neutral';
  /** Perubahan vs periode lalu, mis. "12% vs kemarin". */
  delta?: React.ReactNode;
  deltaDir?: 'up' | 'down';
  hint?: React.ReactNode;
}

export declare function StatCard(props: StatCardProps): React.JSX.Element;
