import type { Keranjang } from './keranjang.ts';
import type { HitunganKeranjang } from './penjualan.ts';

/**
 * Kanal pesanan (FR-C7). Satu-satunya masukan per pesanan yang boleh memengaruhi
 * pajak: kasir tidak memilih TARIF, ia memilih kanal, dan `TaxCalculator`
 * meresolusi tarifnya (spec § 4 "Pajak sebagai pilihan kanal").
 */
export type Kanal = 'dine_in' | 'takeaway';

export const KANAL_BAWAAN: Kanal = 'takeaway';

export const LABEL_KANAL: Record<Kanal, string> = {
  dine_in: 'Dine in',
  takeaway: 'Takeaway',
};

/** Urutan di lembar: sama dengan label toolbar mockup, Takeaway lebih dulu. */
export const URUTAN_KANAL: readonly Kanal[] = ['takeaway', 'dine_in'];

/** Nilai tak dikenal (keranjang lama, versi lain) jatuh ke bawaan, tidak dipercaya. */
export function kanalSah(nilai: unknown): Kanal {
  return nilai === 'dine_in' || nilai === 'takeaway' ? nilai : KANAL_BAWAAN;
}

/** Kanal efektif sebuah keranjang; keranjang tanpa `kanal` (bentuk lama) = takeaway. */
export function kanalDari(k: Pick<Keranjang, 'kanal'> | { kanal?: unknown }): Kanal {
  return kanalSah((k as { kanal?: unknown }).kanal);
}

export interface RingkasanKanal {
  kanal: Kanal;
  /** Nama tarif hasil `TaxCalculator` untuk kanal ini; kosong bila keranjang tidak kena tarif. */
  namaTarif: string[];
  /** Kedua kanal memakai daftar tarif yang identik. */
  sama: boolean;
}

/**
 * Nama tarif per kanal, diambil dari rincian pajak hasil `hitungKeranjang`
 * untuk masing-masing kanal — bukan ditulis di layar dan bukan dihitung di sini
 * (invariant #7: tidak ada angka pajak di luar `TaxCalculator`).
 */
export function ringkasKanal(hasil: {
  dine_in: Pick<HitunganKeranjang, 'pajak'>;
  takeaway: Pick<HitunganKeranjang, 'pajak'>;
}): RingkasanKanal[] {
  const nama = (k: Kanal) => hasil[k].pajak.lines.map((l) => l.name);
  const sama = JSON.stringify(nama('dine_in')) === JSON.stringify(nama('takeaway'));
  return URUTAN_KANAL.map((kanal) => ({ kanal, namaTarif: nama(kanal), sama }));
}
