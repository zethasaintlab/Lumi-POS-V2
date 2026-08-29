/**
 * M-02 — Perlu Diperiksa. Aturan tampilannya, terpisah dari komponennya.
 *
 * `IA:247` menamainya *"Drill-down dari peringatan di M-01"*, dan `spec-g:245`
 * menuntut bagiannya **tidak muncul bila tidak ada temuan**.
 *
 * ## ⛔ Kalimatnya disusun DI SINI, bukan di server
 *
 * Server mengirim data: jenis, outlet, angka, waktu. Kalimat yang disusun
 * server akan menjadi kalimat KEDUA yang harus dijaga sepakat dengan yang di
 * back-office — dan yang menyimpang di antara keduanya membuat owner melihat
 * dua deskripsi untuk satu kejadian dan tidak punya cara memutuskan mana yang
 * benar.
 *
 * ## ⛔ Tanpa satu pun kata yang menyalahkan orang
 *
 * `spec-g:168`: *"produk yang menuduh karyawan merchant akan merusak hubungan
 * merchant dengan stafnya."* Oversell secara khusus **bukan kesalahan** — ia
 * konsekuensi teorema CAP dan non-goal permanen (`spec-e:177`); dua perangkat
 * yang menjual barang terakhir saat offline sama-sama benar. Kalimatnya
 * deskriptif, dan ada test yang memindainya.
 */

import { rupiah } from '../../../../packages/domain/src/uang-tampilan.ts';

export type JenisTemuan = 'oversell' | 'selisih_kas' | 'pembayaran_menggantung';

export interface Temuan {
  jenis: JenisTemuan;
  id: string;
  outletId: string;
  outletNama: string | null;
  nilai: string;
  terjadiPada: string;
  keterangan: string | null;
}

export interface PerluPerhatian {
  outletId: string | null;
  jumlah: number;
  temuan: Temuan[];
}

/**
 * ⛔ Berapa temuan yang M-01 tampilkan. `IA:373` — "maks 3 temuan".
 *
 * Angka penuhnya tetap disebut (`ringkasTemuan`): tiga dari sembilan yang
 * tidak menyebut sembilan mengecilkan apa yang sebenarnya menunggu.
 */
export const MAKS_TEMUAN_M01 = 3;

export type KeadaanPerlu = 'memuat' | 'siap' | 'gagal' | 'tidak-berhak';

/**
 * Pesan pengganti daftar, atau `null` bila daftarnya yang dirender.
 *
 * ⛔ Ketiga keadaan bukan-siap punya kalimatnya sendiri, aturan yang sama
 * dengan `pesanLayar` M-01. Yang paling berbahaya di layar INI: "gagal
 * memuat" yang terbaca seperti "tidak ada yang perlu diperiksa" — kegagalan
 * jaringan yang terbaca sebagai **pembebasan**.
 */
export function pesanPerlu(keadaan: KeadaanPerlu): string | null {
  switch (keadaan) {
    case 'memuat':
      return 'Memeriksa…';
    case 'gagal':
      return 'Daftar tidak dapat dimuat. Ini BUKAN berarti tidak ada yang perlu diperiksa — coba lagi sebelum menyimpulkan apa pun.';
    case 'tidak-berhak':
      return 'Akun Anda tidak berhak melihat daftar ini.';
    default:
      return null;
  }
}

/** Judul jenis, dalam kata yang merchant pakai. */
export const JUDUL_JENIS: Record<JenisTemuan, string> = {
  oversell: 'Terjual melebihi stok',
  selisih_kas: 'Selisih kas',
  pembayaran_menggantung: 'Pembayaran belum dikonfirmasi',
};

export function judulJenis(jenis: string): string {
  return JUDUL_JENIS[jenis as JenisTemuan] ?? jenis;
}

/** Kuantitas ×1000 dibuat terbaca, tanpa melewati float. */
function kuantitas(milli: string): string {
  const n = BigInt(milli);
  const utuh = n / 1000n;
  const sisa = n % 1000n;
  if (sisa === 0n) return utuh.toString();
  return `${utuh},${sisa.toString().padStart(3, '0').replace(/0+$/, '')}`;
}

/**
 * Satu baris temuan, sebagai kalimat.
 *
 * ⛔ Selisih kas dibaca dengan KATANYA — "kurang" / "lebih" — bukan dengan
 * tandanya saja. `− Rp 50.000` di layar 390px dibaca sekilas sebagai
 * `Rp 50.000`, dan arahnya adalah separuh artinya.
 */
export function rinciTemuan(t: Temuan): string {
  switch (t.jenis) {
    case 'oversell': {
      const nama = t.keterangan ?? 'Produk';
      return `${nama} — ${kuantitas(t.nilai)} unit terjual melebihi saldo stok.`;
    }
    case 'selisih_kas': {
      const n = BigInt(t.nilai);
      const arah = n < 0n ? 'kurang' : 'lebih';
      const besaran = rupiah(n < 0n ? -n : n);
      const tanggal = t.keterangan === null ? '' : ` (tanggal bisnis ${t.keterangan})`;
      return `Laci ${arah} ${besaran} saat tutup kas${tanggal}.`;
    }
    case 'pembayaran_menggantung':
      // ⛔ Ia TIDAK disebut gagal. Pelanggan mungkin sudah membayar (FR-C14),
      // dan menyebutnya gagal membuat merchant menagih ulang.
      return `${rupiah(t.nilai)} menunggu konfirmasi gateway lebih dari 24 jam. Belum tentu gagal — periksa ke penyedia sebelum menagih ulang.`;
    default:
      return '';
  }
}

/** Nama outlet, atau penggantinya. Outlet yang hilang tidak dibiarkan kosong. */
export function outletTampil(t: Temuan): string {
  return t.outletNama ?? 'Outlet tidak dikenal';
}

/**
 * Kalimat ringkas untuk bagian "perlu diperiksa" di M-01.
 *
 * ⛔ `null` bila tidak ada temuan — `spec-g:245`: *"Bagian 'perlu diperiksa'
 * tidak muncul bila tidak ada temuan."* Bagian yang selalu tampil dengan
 * "0 hal perlu diperiksa" mengubah layar yang menjawab satu pertanyaan menjadi
 * dasbor, dan owner berhenti melihat bagiannya justru saat ia berisi.
 */
export function ringkasTemuan(jumlah: number): string | null {
  if (jumlah <= 0) return null;
  return jumlah === 1 ? '1 hal perlu diperiksa' : `${jumlah} hal perlu diperiksa`;
}

/**
 * ⛔ Kalimat batas: daftar ini TERTUNGGAK, bukan "hari ini".
 *
 * Tanpa kalimat ini, temuan berumur seminggu yang muncul di layar "Ringkasan
 * Hari Ini" terbaca sebagai kejadian hari ini — dan owner memeriksa shift yang
 * salah.
 */
export const CATATAN_TERTUNGGAK =
  'Daftar ini memuat semua yang belum beres, bukan hanya yang terjadi hari ini.';
