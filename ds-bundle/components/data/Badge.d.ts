import * as React from 'react';

/**
 * Label status. Teks wajib (status tak pernah dikodekan warna saja);
 * ikon opsional untuk KDS.
 * @startingPoint section="Data" subtitle="Badge 5 tone status" viewport="700x120"
 */
export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** accent/success/warning/danger hanya untuk status, tidak pernah dekoratif. */
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
  /** Ikon opsional; wajib di KDS. */
  icon?: React.ReactNode;
  children: React.ReactNode;
}

export declare function Badge(props: BadgeProps): React.JSX.Element;
