import * as React from 'react';

/** Chip pilihan tunggal (kategori, rentang waktu). Terpilih = aksen. */
export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
}

export declare function Chip(props: ChipProps): React.JSX.Element;
