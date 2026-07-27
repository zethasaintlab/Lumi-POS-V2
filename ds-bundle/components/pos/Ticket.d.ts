import * as React from 'react';

export interface TicketItem {
  qty: number;
  name: string;
  note?: string;
  done?: boolean;
}

/** Tiket order di Kitchen Display; dibaca dari 2 meter dalam .kds-scale. */
export interface TicketProps {
  /** Nomor meja / takeaway, mis. "A04", "TA-7". */
  code: string;
  /** Nomor order, mis. "ORD-0231". */
  orderNo: string;
  orderType: string;
  /** Durasi tunggu, mis. "12m 04s". */
  waited: string;
  /** > 10 menit → border + ikon + teks peringatan. */
  late?: boolean;
  items: TicketItem[];
  /** Jumlah item selesai → "N dari M item selesai". */
  doneCount?: number;
  /** Status turunan untuk badge/aksi. */
  status?: 'queued' | 'processing' | 'ready';
  primaryLabel?: React.ReactNode;
  onPrimary?: () => void;
}

export declare function Ticket(props: TicketProps): React.JSX.Element;
