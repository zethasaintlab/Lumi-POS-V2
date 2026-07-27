import * as React from 'react';

/**
 * Dialog konfirmasi aksi merusak (void, refund, tutup sesi kas).
 * Wajib PIN owner + alasan dari daftar tertutup; "Lainnya" wajib catatan.
 * @startingPoint section="Overlays" subtitle="Konfirmasi void/refund + PIN + alasan" viewport="700x520"
 */
export interface ConfirmDialogProps {
  open?: boolean;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Ringkasan yang diaksi (mis. item + total). */
  detail?: React.ReactNode;
  pin?: string;
  onPin?: (v: string) => void;
  reason?: string;
  onReason?: (v: string) => void;
  note?: string;
  onNote?: (v: string) => void;
  /** Daftar alasan tertutup. Default: Salah input · Tamu batal · Item habis · Kualitas · Lainnya. */
  reasons?: string[];
  pinError?: React.ReactNode;
  confirmLabel?: React.ReactNode;
  onConfirm?: () => void;
  onCancel?: () => void;
}

export declare function ConfirmDialog(props: ConfirmDialogProps): React.JSX.Element | null;
