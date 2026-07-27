import * as React from 'react';

/** Modal umum (form/detail). Untuk aksi merusak pakai ConfirmDialog. */
export interface ModalProps {
  open?: boolean;
  title?: React.ReactNode;
  onClose?: () => void;
  children?: React.ReactNode;
  /** Baris tombol footer. */
  footer?: React.ReactNode;
  width?: number;
}

export declare function Modal(props: ModalProps): React.JSX.Element | null;
