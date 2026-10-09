import type { HitunganKeranjang } from './penjualan.ts';

/**
 * Kanal pesanan (FR-C7): satu-satunya masukan per pesanan yang boleh memengaruhi
 * pajak. Kasir memilih KANAL, bukan tarif -- tarif tetap diresolusi
 * `TaxCalculator` (item > kategori > semua, kanal spesifik > `all`, outlet >
 * tenant). Spec kasir § 4 "Pajak sebagai pilihan kanal".
 */
export type Kanal = 'dine_in' | 'takeaway';

/** Urutan tampil di lembar Pajak. */
export const URUTAN_KANAL: readonly Kanal[] = ['takeaway', 'dine_in'];

export function labelKanal(kanal: Kanal): string {
  return kanal === 'dine_in' ? 'Dine in' : 'Takeaway';
}

export interface RingkasanKanal {
  kanal: Kanal;
  /** `TaxRate.name` dari rincian pajak hasil `hitungKeranjang` untuk kanal ini. */
  namaTarif: string[];
  /** `true` bila kedua kanal memberi daftar nama tarif yang identik. */
  sama: boolean;
}

/**
 * Ringkasan lembar Pajak dari DUA hitungan keranjang (satu per kanal).
 *
 * ⛔ Hanya NAMA yang dibaca dari rincian. Nama dan angkanya milik
 * `hitungKeranjang` -> `TaxCalculator`; berkas ini tidak menyimpan tarif apa
 * pun (invariant #7), dan nama yang diketik di sini akan menyimpang dari
 * `TaxRate.name` begitu merchant mengganti tarifnya.
 */
export function ringkasKanal(
  hasil: Record<Kanal, Pick<HitunganKeranjang, 'pajak'>>
): RingkasanKanal[] {
  const nama = (k: Kanal) => hasil[k].pajak.lines.map((l) => l.name);
  const sama = JSON.stringify(nama('dine_in')) === JSON.stringify(nama('takeaway'));
  return URUTAN_KANAL.map((kanal) => ({ kanal, namaTarif: nama(kanal), sama }));
}
