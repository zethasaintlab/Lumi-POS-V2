/**
 * Aturan tampilan kenaikan paket untuk B-29. Murni: tanpa DOM, tanpa React,
 * tanpa jaringan.
 *
 * Dipisah dari komponennya dengan alasan yang sama dengan `kuota-tampilan.ts`
 * di layar yang sama: "paket mana yang boleh dibeli" dan "berapa tagihannya"
 * adalah aturan, dan aturan diuji `node --test` tanpa merender apa pun.
 *
 * ## ⛔ Harga dan urutan diIMPOR, tidak diketik ulang
 *
 * `HARGA_PAKET`, `URUTAN_PAKET`, dan `periksaKenaikanPaket` datang dari
 * `packages/domain` — sumber yang sama persis dengan yang dipakai server saat
 * MENAGIH. Angka yang disalin ke klien akan menyimpang pada perubahan harga
 * berikutnya, dan gejalanya adalah layar yang menjanjikan Rp349.000 lalu
 * menagih lain. Merchant tidak punya cara mengetahui mana dari dua angka itu
 * yang benar.
 */

import {
  HARGA_PAKET,
  URUTAN_PAKET,
  hitungTagihanBulanan,
  periksaKenaikanPaket,
  type NamaPaket,
} from '../../../../packages/domain/src/paket.ts';
import { labelPaket } from './kuota-tampilan.ts';

export interface PilihanPaket {
  paket: NamaPaket;
  /** Nama yang dibaca merchant. */
  judul: string;
  /** Rupiah utuh per outlet per bulan. `null` = harga dinegosiasikan. */
  hargaPerOutlet: bigint | null;
  /** `hargaPerOutlet × jumlah outlet`. `null` bila tidak dapat dihitung. */
  perkiraanBulanan: bigint | null;
  /** Apakah merchant dapat membelinya sendiri sekarang. */
  dapatDibeli: boolean;
  /**
   * Kenapa tidak dapat dibeli. `null` bila dapat.
   *
   * ⛔ Kalimatnya datang dari `periksaKenaikanPaket`, bukan ditulis ulang di
   * sini — layar yang berkata "hubungi tim Lumi" sementara server menjawab
   * kalimat lain adalah dua penjelasan untuk satu penolakan.
   */
  alasan: string | null;
  /** Paket yang sedang dipakai tenant ini. */
  sedangDipakai: boolean;
}

/**
 * Perkiraan tagihan satu bulan, atau `null` bila tidak dapat dihitung.
 *
 * ## ⛔ Kenapa pembungkus ini ada, dan kenapa domain TIDAK dilonggarkan
 *
 * `hitungTagihanBulanan` **melempar** untuk paket bernegosiasi (`enterprise`)
 * dan untuk jumlah outlet di bawah satu — fail-closed, dan itu benar untuk
 * server: keduanya berarti pemanggil salah menghitung, dan menagih Rp0
 * diam-diam adalah tagihan yang tidak akan pernah ditanyakan siapa pun.
 *
 * Di klien, lemparan yang tidak tertangkap saat render **mematikan seluruh
 * layar**. Batasnya karena itu ditarik di sini: klien menerjemahkan lemparan
 * menjadi "tidak dapat dihitung", dan domain tetap fail-closed untuk semua
 * pemanggil lain.
 */
export function perkiraanTagihan(paket: string, jumlahOutlet: number): bigint | null {
  try {
    return hitungTagihanBulanan(paket, jumlahOutlet);
  } catch {
    return null;
  }
}

/**
 * Seluruh paket, terurut tingkat, dengan status belinya masing-masing.
 *
 * ⛔ Paket yang TIDAK dapat dibeli tetap dirender, dengan alasannya. Menyaring
 * mereka keluar membuat merchant di paket `pro` melihat daftar berisi satu
 * baris tanpa penjelasan apa pun — dan `enterprise` menjadi tier yang tidak
 * pernah ia tahu ada.
 */
export function susunPilihan(paketSaatIni: string, jumlahOutlet: number): PilihanPaket[] {
  return URUTAN_PAKET.map((paket) => {
    const harga = HARGA_PAKET[paket];
    let dapatDibeli = false;
    let alasan: string | null = null;

    // `periksaKenaikanPaket` melempar untuk paket tak dikenal. Di sini
    // `paket` datang dari `URUTAN_PAKET` sehingga tidak mungkin asing —
    // tapi `paketSaatIni` datang dari SERVER, dan server yang mengirim nilai
    // yang klien belum kenal (paket kelima) tidak boleh mematikan layar.
    try {
      const hasil = periksaKenaikanPaket(paketSaatIni, paket);
      dapatDibeli = hasil.ok;
      alasan = hasil.ok ? null : hasil.pesan;
    } catch {
      alasan = 'Paket ini tidak dikenali aplikasi. Muat ulang halaman atau hubungi dukungan.';
    }

    return {
      paket,
      judul: labelPaket(paket),
      hargaPerOutlet: harga,
      perkiraanBulanan: perkiraanTagihan(paket, jumlahOutlet),
      dapatDibeli,
      alasan,
      sedangDipakai: paket === paketSaatIni,
    };
  });
}

/**
 * Format rupiah `CLAUDE.md`: `Rp 1.847.000` — titik ribuan, TANPA desimal.
 *
 * ⛔ `bigint`, bukan `number`. Nilainya datang dari jalur uang, dan aturan
 * "jalur uang tidak menyentuh float" tidak punya pengecualian untuk lapisan
 * tampilan — pengecualian di sini adalah yang disalin ke kolom berikutnya.
 */
export function rupiah(nilai: bigint): string {
  const negatif = nilai < 0n;
  const angka = (negatif ? -nilai : nilai).toString();
  const berTitik = angka.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negatif ? '− ' : ''}Rp ${berTitik}`;
}

/**
 * Label status tagihan yang dibaca merchant.
 *
 * ⛔ `expired` DIBEDAKAN dari `failed`, dan itu bukan kehalusan bahasa: yang
 * pertama menuntut merchant meminta QR baru, yang kedua menuntut ia memeriksa
 * pembayarannya. Kolomnya sengaja mengenal keduanya (`0026`).
 */
export function labelStatusTagihan(status: string): string {
  const peta: Record<string, string> = {
    pending_confirmation: 'Menunggu pembayaran',
    confirmed: 'Lunas',
    failed: 'Gagal',
    expired: 'Kedaluwarsa',
  };
  return peta[status] ?? status;
}

export function toneStatusTagihan(status: string): 'neutral' | 'success' | 'warning' | 'danger' {
  const peta: Record<string, 'neutral' | 'success' | 'warning' | 'danger'> = {
    pending_confirmation: 'warning',
    confirmed: 'success',
    failed: 'danger',
    expired: 'neutral',
  };
  return peta[status] ?? 'neutral';
}

export interface Tagihan {
  id: string;
  plan: string;
  outletCount: number;
  unitPrice: number;
  amount: number;
  status: string;
  provider: string | null;
  providerReference: string | null;
  createdAt: string;
  confirmedAt: string | null;
  requestedBy: string;
  /**
   * ⛔ Datang dari BARIS tagihan, bukan hanya dari respons pembuatan.
   *
   * Sebelum kolomnya ada, QR hanya hidup di memori komponen: memuat ulang
   * halaman menghilangkan satu-satunya cara membayar tagihan yang masih
   * terbuka, sementara server menolak tagihan kedua. Ditemukan di browser.
   */
  qrString: string | null;
  expiresAt: string | null;
}

export interface RiwayatTagihan {
  plan: string;
  status: string;
  invoices: Tagihan[];
}

export interface HasilTagihanBaru {
  invoice: Tagihan;
  qrString: string | null;
  expiresAt: string | null;
  gatewayReachable: boolean;
}

/**
 * Tagihan yang masih menunggu pembayaran, bila ada.
 *
 * ⛔ Server menegakkan **satu tagihan terbuka per tenant** lewat index unik
 * parsial. Layar yang tidak menampilkannya akan menawarkan tombol "Naikkan
 * paket" yang selalu dijawab `409 SUBSCRIPTION_INVOICE_OPEN` — penolakan yang
 * benar, untuk tindakan yang seharusnya tidak pernah ditawarkan.
 */
export function tagihanTerbuka(riwayat: RiwayatTagihan | null): Tagihan | null {
  if (riwayat === null) return null;
  return riwayat.invoices.find((i) => i.status === 'pending_confirmation') ?? null;
}

/**
 * FR-C12 — label kategori merchant yang merchant baca, bukan singkatannya.
 *
 * ⛔ Singkatan penyelenggara ikut di dalam kurung, tidak dibuang. Yang
 * menetapkan kategori adalah penyelenggara QRIS, dan merchant yang
 * mencocokkannya dengan surat pendaftarannya mencari kata "UMI", bukan
 * "usaha mikro".
 */
export const LABEL_KATEGORI: Record<string, string> = {
  umi: 'Usaha mikro (UMI)',
  uke: 'Usaha kecil (UKE)',
  ume: 'Usaha menengah (UME)',
  ube: 'Usaha besar (UBE)',
};

export function labelKategoriMerchant(nilai: string | undefined): string {
  if (nilai === undefined) return 'Belum diatur';
  return LABEL_KATEGORI[nilai] ?? nilai;
}
