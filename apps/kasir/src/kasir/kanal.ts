import type { HitunganKeranjang } from './penjualan.ts';

/**
 * Kanal pesanan (FR-C7): satu-satunya masukan per pesanan yang memengaruhi
 * tarif pajak. Kasir memilih KANAL, tidak pernah tarif — `TaxCalculator`
 * meresolusi tarifnya (`docs/superpowers/specs/2026-09-28-kasir-design.md` § 4).
 *
 * ⛔ Murni, dan tanpa satu pun angka pajak (invariant #7): nama tarif datang
 * dari hasil `hitungKeranjang`, bukan dari sini.
 */
export type Kanal = 'dine_in' | 'takeaway';

export const KANAL_BAWAAN: Kanal = 'takeaway';

/** Urutan tampil di lembar Pajak, dan namanya. */
export const DAFTAR_KANAL: readonly Kanal[] = ['takeaway', 'dine_in'];
export const NAMA_KANAL: Record<Kanal, string> = { takeaway: 'Takeaway', dine_in: 'Dine in' };

/** Nilai asing (keranjang tersimpan versi lain) menjadi bawaan, tidak dibawa mentah ke jalur pajak. */
export function kanalSah(nilai: unknown): Kanal {
  return nilai === 'dine_in' || nilai === 'takeaway' ? nilai : KANAL_BAWAAN;
}

export interface RingkasanKanal {
  kanal: Kanal;
  /** Nama tarif hasil resolusi `TaxCalculator` untuk kanal ini, urutan baris rincian. Kosong = tanpa pajak. */
  namaTarif: string[];
  /** `true` bila kedua kanal memberi daftar tarif yang identik. */
  sama: boolean;
}

export function ringkasKanal(
  hasil: Record<Kanal, Pick<HitunganKeranjang, 'pajak'>>
): RingkasanKanal[] {
  const nama = (k: Kanal) => hasil[k].pajak.lines.map((l) => l.name);
  const sama = JSON.stringify(nama('dine_in')) === JSON.stringify(nama('takeaway'));
  return DAFTAR_KANAL.map((kanal) => ({ kanal, namaTarif: nama(kanal), sama }));
}
