/**
 * B-01 — aturan layar Dasbor.
 *
 * ## ⛔ Layar ini tidak menghitung apa pun
 *
 * Setiap angka datang dari server, yang menghitungnya dengan fungsi yang sama
 * dengan B-16, B-17, dan B-12. Menjumlahkan atau menurunkan apa pun di sini
 * melahirkan definisi kedua — dan dasbor adalah tempat terburuk untuk itu,
 * karena ia yang pertama dilihat dan paling jarang diperiksa ulang.
 *
 * Yang ada di berkas ini hanya PILIHAN RENTANG dan penyusunan kalimat.
 */

import type { Rentang } from '../laporan/b16.ts';

/** Rentang cepat yang dasbor tawarkan. */
export type PilihanRentang = 'hari-ini' | 'minggu-ini' | 'bulan-ini';

export const LABEL_RENTANG: Record<PilihanRentang, string> = {
  'hari-ini': 'Hari ini',
  'minggu-ini': '7 hari terakhir',
  'bulan-ini': '30 hari terakhir',
};

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Tanggal `YYYY-MM-DD` di zona PERANGKAT.
 *
 * ⛔ Ia hanya nilai AWAL pemilih, bukan sumbu laporan. Sumbunya `business_date`
 * yang server hitung dari zona outlet — dan keduanya sengaja dapat berbeda
 * untuk merchant yang outletnya di zona lain.
 */
export function tanggalLokal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Rentang dari pilihan cepat.
 *
 * ⛔ "7 hari terakhir", bukan "minggu ini". Minggu kalender menuntut keputusan
 * tentang hari mana yang memulainya — Senin di Indonesia, Minggu di sebagian
 * pustaka — dan merchant yang membandingkan dua angka yang keduanya disebut
 * "minggu ini" tidak punya cara tahu mana yang mana. Jumlah hari tidak ambigu.
 */
export function rentangDari(pilihan: PilihanRentang, sekarang: Date): Rentang {
  const sampai = tanggalLokal(sekarang);
  if (pilihan === 'hari-ini') return { dari: sampai, sampai };

  const mundur = pilihan === 'minggu-ini' ? 6 : 29;
  const awal = new Date(sekarang.getTime());
  awal.setDate(awal.getDate() - mundur);
  return { dari: tanggalLokal(awal), sampai };
}

export interface ProdukTerlaris {
  variationId: string;
  itemName: string;
  variationName: string;
  kuantitas: string;
  kuantitasTampil: string;
  nilaiKotor: string;
}

export interface RingkasStok {
  minus: number;
  habis: number;
  contoh: { variationId: string; itemName: string; variationName: string; saldo: string }[];
}

export interface PosisiPenjualan {
  omzetKotor: string;
  voidAmount: string;
  refundAmount: string;
  omzetBersih: string;
  pajakTerkumpul: string;
  jumlahTransaksi: number;
  rataRataPerTransaksi: string;
}

export interface PerangkatMenua {
  deviceId: string;
  code: string;
  outletId: string;
  lastSeenAt: string | null;
  jamSejakTerlihat: number | null;
  tingkat: 'peringatan' | 'kritis' | 'darurat';
}

export interface RingkasPerangkat {
  total: number;
  menua: PerangkatMenua[];
  belumPernah: number;
}

export interface Dasbor {
  from: string;
  to: string;
  outletId: string | null;
  penjualan: PosisiPenjualan;
  terlaris: ProdukTerlaris[];
  stok: RingkasStok | null;
  perangkat: RingkasPerangkat;
}

export type Keadaan =
  | { jenis: 'memuat' }
  | { jenis: 'siap'; dasbor: Dasbor }
  | { jenis: 'galat'; pesan: string };

/**
 * Berapa hal yang perlu perhatian di kartu stok.
 *
 * ⛔ Minus dan habis DIJUMLAHKAN untuk angka besarnya, tapi kalimatnya
 * memisahkan keduanya. Merchant yang melihat "3 perlu perhatian" harus dapat
 * tahu berapa yang mustahil (minus) dan berapa yang sekadar habis — keduanya
 * ditindaklanjuti dengan cara berbeda.
 */
export function ringkasKalimatStok(stok: RingkasStok | null): string {
  if (stok === null) return 'Pilih satu outlet untuk melihat stok yang perlu perhatian.';
  if (stok.minus === 0 && stok.habis === 0) return 'Tidak ada barang yang habis atau bersaldo minus.';

  const bagian: string[] = [];
  if (stok.minus > 0) bagian.push(`${stok.minus} bersaldo minus`);
  if (stok.habis > 0) bagian.push(`${stok.habis} habis`);
  return bagian.join(' · ');
}

export function jumlahPerluPerhatian(stok: RingkasStok | null): number {
  return stok === null ? 0 : stok.minus + stok.habis;
}

export interface LencanaStok {
  nada: 'success' | 'warning' | 'neutral';
  teks: string;
}

/**
 * Lencana kartu stok.
 *
 * ⛔ `null` TIDAK boleh berbunyi "Aman". Versi pertama menurunkan lencananya
 * dari `jumlahPerluPerhatian`, yang mengembalikan `0` untuk `null` — dan `0`
 * berarti hijau. Hasilnya kartu hijau bertuliskan "Aman" di atas kalimat
 * "Pilih satu outlet untuk melihat stok yang perlu perhatian": jaminan tentang
 * stok yang tidak seorang pun periksa.
 *
 * Terlihat di browser, bukan di test — dengan menjatuhkan server, menekan
 * "Coba lagi", dan memperhatikan bahwa daftar outlet tidak ikut dimuat ulang.
 *
 * ⛔ Teksnya membawa ANGKA, bukan hanya warna (aturan design system #5).
 */
export function lencanaStok(stok: RingkasStok | null): LencanaStok {
  if (stok === null) return { nada: 'neutral', teks: 'Belum diperiksa' };
  const n = jumlahPerluPerhatian(stok);
  return n > 0 ? { nada: 'warning', teks: `${n} perlu tindakan` } : { nada: 'success', teks: 'Aman' };
}

export interface PesanLayar {
  judul: string;
  badan: string;
}

/**
 * Pesan yang menggantikan isi dasbor, atau `null`.
 *
 * ⛔ Dasbor tanpa transaksi BUKAN keadaan error, dan bukan pula dasbor kosong
 * yang perlu disembunyikan. Merchant yang baru mendaftar akan melihatnya
 * setiap pagi sampai penjualan pertamanya — kalimatnya karena itu menjelaskan
 * apa yang akan mengisinya, bukan sekadar menyatakan tidak ada apa-apa.
 */
export function pesanKeadaan(k: Keadaan): PesanLayar | null {
  if (k.jenis === 'memuat') {
    return { judul: 'Memuat ringkasan…', badan: 'Server sedang menghitung angka hari ini.' };
  }
  if (k.jenis === 'galat') {
    return { judul: 'Ringkasan tidak dapat dimuat', badan: k.pesan };
  }
  return null;
}

/** Apakah periode ini benar-benar kosong — dipakai untuk pesan di dalam kartu. */
export function periodeKosong(d: Dasbor): boolean {
  return d.penjualan.jumlahTransaksi === 0;
}

/**
 * FR-H8 sisi owner — kalimat perangkat yang berhenti menyapa.
 *
 * `null` berarti tidak ada yang perlu ditampilkan. Kartu yang selalu muncul
 * dengan tulisan "semua sehat" adalah kartu yang berhenti dibaca, dan ketika
 * ia akhirnya berubah, tidak ada yang memperhatikan.
 *
 * ## ⛔ "Belum terhubung", BUKAN "antrean menua"
 *
 * Server tidak dapat melihat antrean yang belum sampai kepadanya — tidak ada
 * baris untuk dihitung. Yang dilihatnya adalah perangkat yang berhenti
 * menyapa, dan itu pertanyaan yang berbeda: perangkat yang mati terlihat basi
 * meski tidak ada penjualan tertahan. Kalimat yang menyamakan keduanya
 * menjanjikan ketepatan yang datanya tidak punya.
 *
 * ⛔ Membawa ANGKA dan KODE perangkatnya. "Ada perangkat yang belum
 * terhubung" tidak dapat ditindaklanjuti; "K2 di Cabang Selatan, 3 hari"
 * dapat.
 */
export function kalimatPerangkat(p: RingkasPerangkat | null | undefined): string | null {
  if (!p || p.menua.length === 0) return null;

  const sebut = p.menua.slice(0, 3).map((d) => `${d.code} (${umurKasar(d.jamSejakTerlihat)})`);
  const sisa = p.menua.length - sebut.length;
  const daftar = sisa > 0 ? `${sebut.join(', ')}, dan ${sisa} lainnya` : sebut.join(', ');

  return (
    `${p.menua.length} dari ${p.total} perangkat belum terhubung ke server: ${daftar}. ` +
    'Penjualan di perangkat itu belum tercatat di laporan mana pun.'
  );
}

/** Umur kasar untuk kalimat — jam di bawah sehari, hari di atasnya. */
export function umurKasar(jam: number | null): string {
  if (jam === null) return 'belum pernah';
  if (jam < 24) return `${Math.floor(jam)} jam`;
  return `${Math.floor(jam / 24)} hari`;
}

/**
 * Nada lencana perangkat. Yang TERBURUK menang.
 *
 * Satu perangkat `darurat` di antara sepuluh yang `peringatan` menentukan
 * warnanya — kalau tidak, perangkat yang tiga hari diam tersembunyi di balik
 * rata-rata yang terlihat wajar.
 */
export function nadaPerangkat(p: RingkasPerangkat | null | undefined): 'success' | 'warning' | 'danger' {
  if (!p || p.menua.length === 0) return 'success';
  return p.menua.some((d) => d.tingkat !== 'peringatan') ? 'danger' : 'warning';
}

export interface BarisRincian {
  judul: string;
  /** Nilai APA ADANYA dari server. String, karena ia `bigint`. */
  nilai: string;
  /** Apakah ia mengurangi omzet — ditandai `−` di depannya. */
  pengurang: boolean;
}

/**
 * Rincian di bawah angka besar.
 *
 * ⛔ Ia MEMILIH dan MELABELI, tidak menghitung. Tidak ada penjumlahan,
 * pengurangan, atau `Number()` di sini — omzet bersih datang jadi dari server,
 * dan menurunkannya ulang di klien melahirkan definisi kedua yang akan
 * menyimpang pada aturan void/refund berikutnya yang berubah.
 *
 * `omzetBersih` dan `jumlahTransaksi` sengaja TIDAK di sini: keduanya sudah
 * berdiri sebagai kartu di atasnya, dan mengulangnya membuat merchant mencari
 * perbedaan antara dua angka yang sama.
 */
export function rincian(d: Dasbor): BarisRincian[] {
  return [
    { judul: 'Omzet kotor', nilai: d.penjualan.omzetKotor, pengurang: false },
    { judul: 'Dibatalkan', nilai: d.penjualan.voidAmount, pengurang: true },
    { judul: 'Refund', nilai: d.penjualan.refundAmount, pengurang: true },
    { judul: 'Pajak terkumpul', nilai: d.penjualan.pajakTerkumpul, pengurang: false },
  ];
}
