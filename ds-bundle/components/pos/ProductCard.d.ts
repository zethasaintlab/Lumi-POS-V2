import * as React from 'react';

/**
 * Kartu produk di grid katalog kasir. Tinggi tetap 96px (density).
 * @startingPoint section="POS" subtitle="Kartu produk 96px + state habis" viewport="700x220"
 */
export interface ProductCardProps {
  name: string;
  sku?: string;
  /** Harga dalam rupiah bulat (tanpa desimal). Diformat otomatis. */
  price: number;
  available?: boolean;
  onAdd?: () => void;
}

export declare function ProductCard(props: ProductCardProps): React.JSX.Element;
