import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import {
  ALASAN_DISKON,
  ambangDari,
  rencanaDiskon,
  type AmbangDiskon,
} from '../../../../packages/domain/src/diskon.ts';
import {
  ambangBerlaku,
  type AmbangBerlaku,
} from '../../../../packages/domain/src/ambang.ts';
import type { DiskonKeranjang } from './keranjang.ts';

/**
 * Diskon di sisi perangkat — ambang outlet dan label alasannya. FR-B8.
 *
 * ## ⛔ Ambang dibaca dari perangkat, bukan diminta ke server
 *
 * AC FR-B8 menuntut aturannya berjalan di kasir, dan kasir bekerja OFFLINE.
 * Ambang yang hanya diketahui server berarti perangkat offline menerapkan
 * diskon 90% tanpa satu pun PIN, lalu server menolaknya berjam-jam kemudian —
 * saat uangnya sudah diterima dan pelanggannya sudah pulang.
 *
 * Kolomnya turun bersama baris `outlet` lewat sync rules, jadi perubahan
 * ambang oleh pusat sampai ke perangkat dengan jalur yang sama seperti
 * perubahan zona waktu atau pembulatan.
 */

interface BarisAmbang {
  cash_variance_threshold: number | bigint | string | null;
  no_sale_threshold: number | bigint | string | null;
  discount_threshold_percent: number | bigint | string | null;
  discount_threshold_amount: number | bigint | string | null;
}

/**
 * Ambang otorisasi diskon untuk outlet ini.
 *
 * ⛔ Outlet yang TIDAK ADA di perangkat tetap mengembalikan ambang bawaan,
 * bukan "tanpa ambang". Perangkat yang katalognya belum turun penuh adalah
 * keadaan normal (`spec-h`), dan ketiadaan baris yang diartikan "tidak ada
 * batas" membuat kontrol FR-B8 mati justru pada perangkat yang paling baru
 * dipasang — yaitu yang paling tidak terawasi.
 */
export async function bacaAmbangDiskon(db: DbLokal, outletId: string): Promise<AmbangDiskon> {
  const a = await bacaAmbangOutlet(db, outletId);
  return ambangDari(a.diskonPersenSkala, a.diskonNominal);
}

/**
 * Ketiga ambang otorisasi outlet ini, dari salinan lokal. B-26.
 *
 * ⛔ Alasan yang sama dengan `bacaAmbangDiskon`, dan berlaku untuk ketiganya:
 * tutup kas (K-12) dan buka laci no-sale (K-16) berjalan TANPA JARINGAN.
 * Perangkat yang memakai bawaan domain sementara server memakai angka yang
 * merchant setel menghasilkan kasir yang sama, shift yang sama, jawaban
 * berbeda — persis penyimpangan yang `packages/domain/src/buku-kas.ts` catat
 * saat konstantanya dipindahkan ke domain.
 *
 * ⛔ Outlet yang TIDAK ADA di perangkat mengembalikan bawaan, bukan "tanpa
 * ambang". Perangkat yang katalognya belum turun penuh adalah keadaan normal
 * (`spec-h`), dan ketiadaan baris yang diartikan "tidak ada batas" membuat
 * kontrolnya mati justru pada perangkat yang paling baru dipasang — yaitu yang
 * paling tidak terawasi.
 */
export async function bacaAmbangOutlet(db: DbLokal, outletId: string): Promise<AmbangBerlaku> {
  const baris = (
    await db.getAll<BarisAmbang>(
      `SELECT discount_threshold_percent, discount_threshold_amount,
              cash_variance_threshold, no_sale_threshold
         FROM outlet WHERE id = ?`,
      [outletId]
    )
  )[0];
  return ambangBerlaku({
    diskonPersenSkala: keBigint(baris?.discount_threshold_percent),
    diskonNominal: keBigint(baris?.discount_threshold_amount),
    selisihKas: keBigint(baris?.cash_variance_threshold),
    // ⛔ `noSale` adalah `number` di domain, dan `keBigint` mengembalikan
    // `bigint` — dikonversi di sini, bukan dibiarkan lewat. `bigint` yang
    // masuk ke perbandingan `number` melempar `TypeError` pada penjumlahan,
    // bukan menghasilkan jawaban yang salah; tapi ia melemparnya di jalur
    // penjualan.
    noSale: baris?.no_sale_threshold === null || baris?.no_sale_threshold === undefined
      ? null
      : Number(baris.no_sale_threshold),
  });
}

/**
 * ⛔ Menerima `bigint`, `number`, DAN `string`.
 *
 * `@powersync/web` mengembalikan kolom `INTEGER` besar sebagai `bigint`
 * sementara driver test (`node:sqlite`) mengembalikan `number` (`CLAUDE.md`).
 * Guard yang hanya memeriksa satu bentuk tidak pernah mengambil cabangnya —
 * hijau di seluruh test, salah di aplikasi.
 */
function keBigint(nilai: number | bigint | string | null | undefined): bigint | null {
  if (nilai === null || nilai === undefined) return null;
  return BigInt(nilai);
}

export interface StatusDiskon {
  /** Rupiah yang akan ditulis ke `order.order_discount`. */
  nominal: bigint;
  /** Ambang terlewati — dengan atau tanpa persetujuan yang sudah ada. */
  diAtasAmbang: boolean;
  /** Ambang terlewati DAN belum tertutup persetujuan yang ada. */
  perluPersetujuan: boolean;
}

/**
 * Keadaan diskon terhadap subtotal SEKARANG.
 *
 * ⛔ Satu fungsi untuk layar dan untuk jalur penulisan. K-03 memakainya untuk
 * memberi tahu kasir SEBELUM ia menekan Bayar; `simpanPenjualan` memakainya
 * untuk menolak. Dua salinan aturan ini akan menyimpang, dan yang menyimpang
 * menghasilkan layar yang berkata "siap" pada penjualan yang ditolak sendiri.
 */
export function statusDiskon(
  subtotal: bigint,
  diskon: DiskonKeranjang | null,
  ambang: AmbangDiskon
): StatusDiskon | null {
  if (diskon === null) return null;
  const rencana = rencanaDiskon(subtotal, diskon.minta, ambang);
  const tertutup =
    diskon.approverId !== null &&
    diskon.nominalDisetujui !== null &&
    rencana.nominal <= diskon.nominalDisetujui;
  return {
    nominal: rencana.nominal,
    diAtasAmbang: rencana.butuhPenyetuju,
    perluPersetujuan: rencana.butuhPenyetuju && !tertutup,
  };
}

/**
 * Label layar untuk kode alasan diskon.
 *
 * ⛔ Kuncinya DITURUNKAN dari `ALASAN_DISKON`, dan ada test yang menolak
 * daftar yang tidak lengkap. Kode yang lahir di domain tanpa label di sini
 * akan muncul di layar sebagai `pelanggan_langganan` — dan yang lebih buruk,
 * label yang tertinggal untuk kode yang sudah dihapus membuat opsi mati
 * terlihat sah.
 */
export const LABEL_ALASAN_DISKON: Record<(typeof ALASAN_DISKON)[number], string> = {
  promo_berjalan: 'Promo berjalan',
  karyawan: 'Diskon karyawan',
  pelanggan_langganan: 'Pelanggan langganan',
  kompensasi_keluhan: 'Kompensasi keluhan',
  lainnya: 'Lainnya',
};
