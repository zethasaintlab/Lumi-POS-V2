import type { Kanal, Keranjang } from './keranjang.ts';
import type { HitunganKeranjang } from './penjualan.ts';

/**
 * Kanal pesanan (FR-C7) — murni. Tidak ada angka pajak di berkas ini
 * (invariant #7): nama tarif datang dari rincian pajak hasil `hitungKeranjang`,
 * yang meresolusinya lewat `TaxCalculator`.
 *
 * Kasir memilih KANAL, bukan tarif: memilih tarif langsung melompati resolusi
 * item > kategori > semua dan kanal > semua (FR-C6). Dine in tidak pernah
 * menyiratkan biaya layanan — `service_charge_amount` tetap nol (G-TANPA-LAYANAN).
 */

export const LABEL_KANAL: Record<Kanal, string> = {
  takeaway: 'Takeaway',
  dine_in: 'Dine in',
};

/** Urutan tampil di lembar: Takeaway (bawaan) lebih dulu. */
export const URUTAN_KANAL: readonly Kanal[] = ['takeaway', 'dine_in'];

/**
 * Kanal efektif sebuah keranjang. Keranjang dari sebelum kanal ada (dan nilai
 * tak dikenal) dibaca `takeaway`, bawaan lama — satu tempat, dipakai K-03, K-06,
 * dan jalur tulis supaya ketiganya tidak pernah berbeda soal tarif.
 */
export function kanalPesanan(k: Pick<Keranjang, 'kanal'>): Kanal {
  return k.kanal === 'dine_in' ? 'dine_in' : 'takeaway';
}

export interface RingkasanKanal {
  kanal: Kanal;
  /** Nama tarif (`TaxRate.name`) yang berlaku untuk kanal ini; kosong = tanpa pajak. */
  namaTarif: string[];
  /** Kedua kanal memakai daftar tarif yang identik. */
  sama: boolean;
}

export function ringkasKanal(
  hasil: Record<Kanal, Pick<HitunganKeranjang, 'pajak'>>
): RingkasanKanal[] {
  const nama = (k: Kanal) => hasil[k].pajak.lines.map((l) => l.name);
  const sama =
    nama('takeaway').length === nama('dine_in').length &&
    nama('takeaway').every((n, i) => n === nama('dine_in')[i]);
  return URUTAN_KANAL.map((kanal) => ({ kanal, namaTarif: nama(kanal), sama }));
}
