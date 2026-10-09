import type { Kanal } from './keranjang.ts';
import type { HitunganKeranjang } from './penjualan.ts';

/**
 * Ringkasan kanal untuk lembar Pajak K-03. Murni.
 *
 * ⛔ Nama tarif diambil dari rincian pajak hasil `hitungKeranjang` (yang
 * memanggil `TaxCalculator`), tidak pernah diketik di layar, dan tidak ada
 * angka pajak di berkas ini (invariant #7). Kasir tidak memilih TARIF —
 * itu melompati resolusi FR-C6; ia memilih KANAL (FR-C7), dan tarif mengikuti.
 */

export interface RingkasKanal {
  kanal: Kanal;
  /** Nama tarif yang berlaku untuk kanal ini, urutan sama dengan struk. Kosong = tidak ada pajak. */
  namaTarif: string[];
  /** Daftar nama tarif identik dengan kanal lainnya. */
  sama: boolean;
}

export const LABEL_KANAL: Record<Kanal, string> = {
  takeaway: 'Takeaway',
  dine_in: 'Dine in',
};

export function ringkasKanal(hasil: {
  dine_in: Pick<HitunganKeranjang, 'pajak'>;
  takeaway: Pick<HitunganKeranjang, 'pajak'>;
}): RingkasKanal[] {
  const nama = (k: Kanal) => hasil[k].pajak.lines.map((l) => l.name);
  const takeaway = nama('takeaway');
  const dineIn = nama('dine_in');
  const sama = takeaway.length === dineIn.length && takeaway.every((n, i) => n === dineIn[i]);
  return [
    { kanal: 'takeaway', namaTarif: takeaway, sama },
    { kanal: 'dine_in', namaTarif: dineIn, sama },
  ];
}
