import * as React from 'react';

/** Satu baris item di keranjang: nama, modifier, qty stepper, subtotal. */
export interface CartRowProps {
  name: string;
  /** Modifier/catatan, mis. "Extra shot · Less ice". */
  modifiers?: React.ReactNode;
  unitPrice: number;
  qty: number;
  onQty?: (next: number) => void;
  /** Dipanggil saat qty turun ke 0. */
  onRemove?: () => void;
}

export declare function CartRow(props: CartRowProps): React.JSX.Element;
