import * as React from 'react';

/**
 * Input teks dengan label & state error. `size="lg"` untuk nominal uang.
 * @startingPoint section="Forms" subtitle="Input + label + error + prefix Rp" viewport="700x180"
 */
export interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: React.ReactNode;
  /** md = 44px (default). lg = 56px, angka besar rata kanan (nominal uang). */
  size?: 'md' | 'lg';
  /** Teks error; merahkan border + tampilkan pesan + set aria-invalid. */
  error?: React.ReactNode;
  /** Penanda di dalam field, mis. "Rp". */
  prefix?: React.ReactNode;
  /** 'textarea' untuk catatan multi-baris. */
  as?: 'input' | 'textarea';
  required?: boolean;
}

export declare function Field(props: FieldProps): React.JSX.Element;
