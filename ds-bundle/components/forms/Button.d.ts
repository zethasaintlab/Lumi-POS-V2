import * as React from 'react';

/**
 * Tombol aksi. Aksen dibatasi < 5% area layar: hanya satu `primary` per layar.
 * @startingPoint section="Forms" subtitle="Tombol 4 varian + ukuran kritis 56px" viewport="700x160"
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = satu aksi utama (aksen). danger = aksi merusak. */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  /** 56px tinggi untuk aksi yang menyangkut uang. Default false (44px). */
  critical?: boolean;
  fullWidth?: boolean;
}

export declare function Button(props: ButtonProps): React.JSX.Element;
