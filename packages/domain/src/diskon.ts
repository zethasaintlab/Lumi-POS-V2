import { periksaAlasan } from './alasan.ts';
import { SKALA_TARIF } from './numeric.ts';

/**
 * Diskon tingkat order dan otorisasi step-up. FR-B8 & FR-B9, `spec-b:267`.
 *
 * ## ⛔ Sebelum ini, `order_discount` SELALU NOL
 *
 * Kolomnya ada sejak F0 dan `computeOrderTotals` sudah menghitungnya sejak
 * Modul C — tapi `POST /orders` menulis nol ke sana, jadi tidak ada satu pun
 * jalan bagi merchant untuk memberi diskon. Berkas ini aturannya.
 *
 * ## ⛔ Aturan step-up ada di DOMAIN, bukan di handler
 *
 * AC FR-B8 menuntutnya berjalan di kasir, dan kasir bekerja OFFLINE. Aturan
 * yang hanya hidup di server berarti perangkat offline menerapkan diskon
 * 90% tanpa satu pun PIN, lalu server menolaknya berjam-jam kemudian — saat
 * uangnya sudah diterima dan pelanggannya sudah pulang.
 *
 * Server tetap memeriksanya lagi. Klien memutuskan APA YANG DITANYAKAN ke
 * manajer; server memutuskan apa yang DISIMPAN.
 */

/**
 * Alasan diskon — daftar TERTUTUP (`spec-b:293`).
 *
 * Kosakatanya diambil apa adanya dari spec; free text tidak dapat diagregasi
 * menjadi laporan fraud, dan laporan exception FR-G5 memakainya.
 */
export const ALASAN_DISKON = [
  'promo_berjalan',
  'karyawan',
  'pelanggan_langganan',
  'kompensasi_keluhan',
  'lainnya',
] as const;

export type AlasanDiskon = (typeof ALASAN_DISKON)[number];

export function adalahAlasanDiskon(nilai: unknown): nilai is AlasanDiskon {
  return typeof nilai === 'string' && (ALASAN_DISKON as readonly string[]).includes(nilai);
}

/**
 * Ambang otorisasi diskon. `spec-b:273`, keputusan user 1 Agustus 2026.
 *
 * ⛔ `[ASUMSI]` — angkanya belum divalidasi ke merchant mana pun
 * (`spec-b:462` menuntut tiga merchant), dan itu sebabnya keduanya
 * dapat dikonfigurasi per outlet. Yang TIDAK dapat diubah adalah keberadaan
 * ambangnya.
 *
 * Persen berskala 10.000, konvensi yang sama dengan `tax_rate.rate` — 20% =
 * `2000n`. Nominal rupiah utuh.
 */
export const AMBANG_DISKON_PERSEN = 2000n;
export const AMBANG_DISKON_NOMINAL = 50_000n;

export interface AmbangDiskon {
  persenSkala: bigint;
  nominal: bigint;
}

export const AMBANG_DISKON_BAWAAN: AmbangDiskon = {
  persenSkala: AMBANG_DISKON_PERSEN,
  nominal: AMBANG_DISKON_NOMINAL,
};

export type TipeDiskon = 'persen' | 'nominal';

export interface PermintaanDiskon {
  tipe: TipeDiskon;
  /** Persen berskala 10.000 (`1500n` = 15%), atau rupiah utuh. */
  nilai: bigint;
}

function wajibBigint(nilai: unknown, label: string): asserts nilai is bigint {
  if (typeof nilai !== 'bigint') {
    // Uang tidak pernah float (`CLAUDE.md`). Mengonversi diam-diam membuat
    // diskon dihitung dengan aritmetika yang berbeda dari seluruh jalur uang.
    throw new TypeError(`${label} harus bigint, bukan ${typeof nilai}.`);
  }
}

/**
 * Nilai rupiah diskon atas `subtotal`.
 *
 * ⛔ Pembagian bigint MEMOTONG, dan itu arah yang benar di sini: diskon yang
 * dibulatkan ke ATAS mengambil satu rupiah lebih banyak daripada yang
 * merchant setujui, dan selisih satu rupiah per transaksi adalah tepat kelas
 * cacat yang tidak pernah dilaporkan siapa pun tapi muncul di rekonsiliasi.
 *
 * ⛔ Diskon TIDAK PERNAH melebihi subtotal. `computeOrderTotals` juga
 * menolaknya, dan dua lapis itu disengaja: yang di sini menjaga hitungan
 * klien, yang di sana menjaga baris yang benar-benar ditulis.
 */
export function nilaiDiskon(subtotal: bigint, minta: PermintaanDiskon): bigint {
  wajibBigint(subtotal, 'subtotal');
  wajibBigint(minta.nilai, 'nilai diskon');
  if (subtotal < 0n) throw new RangeError('subtotal tidak boleh negatif.');
  if (minta.nilai < 0n) throw new RangeError('nilai diskon tidak boleh negatif.');

  if (minta.tipe === 'nominal') {
    return minta.nilai > subtotal ? subtotal : minta.nilai;
  }
  if (minta.tipe !== 'persen') {
    throw new RangeError(`Tipe diskon tidak dikenal: "${String(minta.tipe)}".`);
  }
  if (minta.nilai > SKALA_TARIF) {
    throw new RangeError('Diskon persen tidak boleh melebihi 100%.');
  }
  return (subtotal * minta.nilai) / SKALA_TARIF;
}

/**
 * Apakah diskon ini menuntut otorisasi manajer.
 *
 * ⛔ Diputuskan dari NILAI RUPIAH-nya, bukan dari tipe yang diminta kasir.
 * `spec-b:273` menulis ambangnya "> 20% **atau** > Rp 50.000", dan keduanya
 * harus berlaku apa pun bentuk masukannya:
 *
 *   - diskon Rp 60.000 atas subtotal Rp 1.000.000 hanya 6%, tapi melewati
 *     ambang nominal;
 *   - diskon 30% atas subtotal Rp 10.000 hanya Rp 3.000, tapi melewati ambang
 *     persen.
 *
 * Memeriksa hanya bentuk yang diketik kasir membuat setengah ambang tidak
 * pernah menyala — dan yang tidak menyala adalah yang dipakai untuk
 * melewatinya.
 *
 * ⛔ `subtotal = 0` menuntut otorisasi untuk diskon apa pun yang bukan nol.
 * Persen atas nol tidak dapat dihitung, dan "tidak dapat dihitung" bukan
 * alasan untuk melewatkan kontrol.
 */
export function butuhOtorisasiDiskon(
  subtotal: bigint,
  nominalDiskon: bigint,
  ambang: AmbangDiskon = AMBANG_DISKON_BAWAAN
): boolean {
  wajibBigint(subtotal, 'subtotal');
  wajibBigint(nominalDiskon, 'nominalDiskon');
  if (nominalDiskon <= 0n) return false;
  if (nominalDiskon > ambang.nominal) return true;
  if (subtotal <= 0n) return true;
  // Perbandingan dilakukan dengan perkalian silang, bukan pembagian: pembagian
  // bigint memotong, dan diskon 20,004% akan terbaca persis 20% lalu lolos.
  return nominalDiskon * SKALA_TARIF > ambang.persenSkala * subtotal;
}

export interface RencanaDiskon {
  /** Nilai rupiah yang akan ditulis ke `order.order_discount`. */
  nominal: bigint;
  butuhPenyetuju: boolean;
}

/**
 * Menyusun diskon dan memutuskan apakah ia menuntut PIN manajer.
 *
 * Mengembalikan pesan kesalahan lewat lemparan hanya untuk masukan yang
 * MUSTAHIL (tipe asing, bigint yang bukan bigint). Alasan yang tidak sah
 * dikembalikan sebagai pesan lewat `periksaAlasanDiskon` — pemanggilnya yang
 * memutuskan bentuk kegagalannya.
 */
export function rencanaDiskon(
  subtotal: bigint,
  minta: PermintaanDiskon,
  ambang: AmbangDiskon = AMBANG_DISKON_BAWAAN
): RencanaDiskon {
  const nominal = nilaiDiskon(subtotal, minta);
  return { nominal, butuhPenyetuju: butuhOtorisasiDiskon(subtotal, nominal, ambang) };
}

/** `null` bila sah. Lihat `periksaAlasan`. */
export function periksaAlasanDiskon(kode: unknown, catatan?: string | null): string | null {
  return periksaAlasan(ALASAN_DISKON, kode, catatan);
}

/**
 * Ambang dari kolom outlet, atau bawaan.
 *
 * ⛔ `null` berarti "pakai bawaan", dan bawaannya hidup DI SINI — bukan
 * sebagai `DEFAULT` kolom. Kolom ber-default membuat perubahan bawaan hanya
 * berlaku untuk outlet yang dibuat sesudahnya, dan outlet lama diam-diam
 * memakai angka lama selamanya. Pola yang sama dengan jendela update F6.
 */
export function ambangDari(
  persenSkala: bigint | null,
  nominal: bigint | null
): AmbangDiskon {
  return {
    persenSkala: persenSkala ?? AMBANG_DISKON_BAWAAN.persenSkala,
    nominal: nominal ?? AMBANG_DISKON_BAWAAN.nominal,
  };
}
