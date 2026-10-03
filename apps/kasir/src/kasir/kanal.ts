import type { HitunganKeranjang } from './penjualan.ts';
import type { Keranjang } from './keranjang.ts';

/**
 * Kanal pesanan (FR-C7). Murni: tanpa React, database, maupun waktu.
 *
 * ⛔ TIDAK ADA angka pajak di berkas ini (invariant #7). Yang ditampilkan
 * lembar Pajak adalah NAMA tarif dari hasil `hitungKeranjang` — yang
 * memutuskan tarif mana berlaku tetap `calculateTax`, bukan layar.
 */
export type Kanal = 'dine_in' | 'takeaway';

export const LABEL_KANAL: Record<Kanal, string> = {
  takeaway: 'Takeaway',
  dine_in: 'Dine in',
};

/** Urutan tampil di lembar: Takeaway dulu (bawaan), lalu Dine in. */
export const URUTAN_KANAL: readonly Kanal[] = ['takeaway', 'dine_in'];

/**
 * Kanal sebuah keranjang. Keranjang bentuk lama (tanpa `kanal`) = `takeaway`,
 * tidak pernah `undefined` yang akan terikat ke `order.channel` sebagai NULL.
 */
export function kanalDari(keranjang: Pick<Keranjang, 'kanal'>): Kanal {
  return keranjang.kanal === 'dine_in' ? 'dine_in' : 'takeaway';
}

export interface RingkasanKanal {
  kanal: Kanal;
  namaTarif: string[];
  /** `true` bila daftar nama tarif kedua kanal identik. */
  sama: boolean;
}

export function ringkasKanal(
  hasil: Record<Kanal, Pick<HitunganKeranjang, 'pajak'>>
): RingkasanKanal[] {
  const nama = (k: Kanal) => hasil[k].pajak.lines.map((l) => l.name);
  const sama = JSON.stringify(nama('dine_in')) === JSON.stringify(nama('takeaway'));
  return URUTAN_KANAL.map((kanal) => ({ kanal, namaTarif: nama(kanal), sama }));
}
