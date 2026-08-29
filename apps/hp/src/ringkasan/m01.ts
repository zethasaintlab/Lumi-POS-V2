/**
 * M-01 — Ringkasan Hari Ini. Aturan tampilannya, terpisah dari komponennya.
 *
 * `IA:229`: *"Persona P3 membuka aplikasi **pukul 23:00 untuk satu
 * pertanyaan**. IA-nya harus menjawab pertanyaan itu di layar pertama, bukan
 * menyediakan navigasi lengkap."*
 *
 * ## ⛔ Setiap angka bertanda disertai KATANYA
 *
 * Aturan design system #5 — status tidak pernah warna saja — dan di layar ini
 * ia menggigit lebih keras daripada di mana pun: panah hijau ke atas pada
 * omzet yang **turun** dibaca sekilas sebagai kabar baik, dan layar ini
 * memang dibaca sekilas. Karena itu setiap arah punya kata, dan kata itulah
 * yang dirender — panahnya hanya menemaninya.
 *
 * ## ⛔ "Belum dapat dibandingkan" BUKAN "0%"
 *
 * `deltaPersen: null` datang dari server untuk merchant yang belum punya dua
 * hari-sama sebelumnya. Menampilkannya sebagai 0% mengaku omzet hari ini
 * persis sama dengan kebiasaannya, dan kebiasaan itu belum ada.
 */

import { rupiah } from '../../../../packages/domain/src/uang-tampilan.ts';
import { labelMetode } from '../../../../packages/domain/src/metode-tampilan.ts';

export interface MetodeRingkas {
  metode: string;
  total: string;
  jumlah: number;
}

export interface PenjualanOutletRingkas {
  outletId: string;
  outletNama: string | null;
  omzetBersih: string;
  jumlahTransaksi: number;
}

export interface RingkasanHarian {
  tanggal: string;
  outletId: string | null;
  omzetBersih: string;
  jumlahTransaksi: number;
  rataRataPerTransaksi: string | null;
  perMetode: MetodeRingkas[];
  /** `null` saat satu outlet diminta — rinciannya akan mengulang totalnya. */
  perOutlet: PenjualanOutletRingkas[] | null;
  tren: {
    deltaPersen: number | null;
    arah: 'naik' | 'turun' | 'datar';
    rataRata: string | null;
    basisMinggu: number;
  };
}

export type KeadaanLayar = 'memuat' | 'siap' | 'gagal' | 'tidak-berhak' | 'ambigu';

/**
 * Pesan pengganti isi layar, atau `null` bila isinya yang dirender.
 *
 * ⛔ SATU fungsi untuk keempat keadaan bukan-siap — aturan yang sama dengan
 * `pesanLaporan` di B-21 dan `pesanPanel` di panel harga basi. "Sedang
 * memuat", "gagal memuat", "tidak berhak", dan "hari ini ambigu" tampak sama
 * di layar dan berarti hal yang sangat berbeda; empat salinan berarti tiga
 * kesempatan menuliskan salah satunya seperti yang lain.
 *
 * Yang paling berbahaya: kegagalan jaringan yang terbaca seperti "outlet Anda
 * tidak berjualan hari ini". Owner yang menyimpulkan itu pukul 23:00 akan
 * menelepon kasirnya.
 */
export function pesanLayar(keadaan: KeadaanLayar): string | null {
  switch (keadaan) {
    case 'memuat':
      return 'Mengambil angka hari ini…';
    case 'gagal':
      // ⛔ Menyangkal kesimpulan yang paling mudah diambil, secara eksplisit.
      return 'Angka hari ini tidak dapat diambil. Ini BUKAN berarti tidak ada penjualan — periksa koneksi lalu coba lagi.';
    case 'tidak-berhak':
      return 'Akun Anda tidak berhak melihat ringkasan penjualan.';
    case 'ambigu':
      return 'Outlet Anda memakai zona waktu atau jam tutup yang berbeda, jadi "hari ini" berarti tanggal yang berbeda di tiap cabang. Pilih satu outlet di atas.';
    default:
      return null;
  }
}

/** `26 Jul 2026` — format tanggal `CLAUDE.md`. */
const BULAN = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
];

/**
 * Tanggal bisnis dibuat terbaca.
 *
 * ⛔ Diurai sebagai TEKS, bukan lewat `new Date(...)`. `new Date('2026-08-24')`
 * menghasilkan tengah malam UTC, dan `getDate()` atasnya mengembalikan
 * tanggal 23 untuk setiap zona di sebelah barat Greenwich — layar yang
 * menyebut hari kemarin untuk angka hari ini.
 */
export function tanggalTampil(tanggalBisnis: string): string {
  const cocok = /^(\d{4})-(\d{2})-(\d{2})$/.exec(tanggalBisnis);
  if (!cocok) return tanggalBisnis;
  const bulan = BULAN[Number(cocok[2]) - 1];
  if (bulan === undefined) return tanggalBisnis;
  return `${Number(cocok[3])} ${bulan} ${cocok[1]}`;
}

export interface TrenTampil {
  /** Kalimatnya. SELALU ada, dan selalu memuat katanya. */
  teks: string;
  /** `↑`/`↓`/`—`, atau string kosong bila belum dapat dibandingkan. */
  panah: string;
  /** `true` bila delta benar-benar dapat dihitung. */
  dapatDibandingkan: boolean;
}

/**
 * Tren omzet sebagai kalimat.
 *
 * ⛔ Kata "dibanding rata-rata hari yang sama" disebut, bukan disingkat jadi
 * "dibanding biasanya". Owner yang tidak tahu pembandingnya akan
 * mengasumsikan kemarin — dan lalu menyimpulkan Senin yang normal sebagai
 * bencana, tepat kesalahan yang aturan hari-sama ada untuk mencegahnya.
 */
export function trenTampil(tren: RingkasanHarian['tren']): TrenTampil {
  if (tren.deltaPersen === null) {
    return {
      // ⛔ Alasannya disebut. "Belum dapat dibandingkan" tanpa sebab terbaca
      // seperti kerusakan; dengan sebab ia terbaca seperti fakta tentang
      // usianya sendiri.
      teks:
        tren.basisMinggu === 0
          ? 'Belum dapat dibandingkan — belum ada hari yang sama sebelumnya.'
          : `Belum dapat dibandingkan — baru ${tren.basisMinggu} hari yang sama sebelumnya.`,
      panah: '',
      dapatDibandingkan: false,
    };
  }

  const besaran = Math.abs(tren.deltaPersen);
  // Satu digit desimal: `12,3%`. Koma, bukan titik — format Indonesia.
  const angka = besaran.toFixed(1).replace('.', ',');
  const kata =
    tren.arah === 'naik' ? 'lebih tinggi' : tren.arah === 'turun' ? 'lebih rendah' : 'sama dengan';
  const panah = tren.arah === 'naik' ? '↑' : tren.arah === 'turun' ? '↓' : '—';

  const pembanding = `rata-rata ${tren.basisMinggu} hari yang sama sebelumnya`;
  const teks =
    tren.arah === 'datar'
      ? `Sama dengan ${pembanding}.`
      : `${angka}% ${kata} dari ${pembanding}.`;

  return { teks, panah, dapatDibandingkan: true };
}

/**
 * Rata-rata per transaksi sebagai kalimat.
 *
 * ⛔ `null` TIDAK ditampilkan sebagai "Rp 0". Nol rupiah per transaksi mengaku
 * ada transaksi yang nilainya nol; yang benar adalah belum ada transaksi.
 */
export function rataRataTampil(nilai: string | null): string {
  return nilai === null ? 'Belum ada transaksi' : `${rupiah(nilai)} per transaksi`;
}

export interface BarisMetode {
  kunci: string;
  label: string;
  nominal: string;
  jumlah: string;
}

/**
 * Rincian per metode, siap dirender.
 *
 * ⛔ Metode yang nol transaksinya TIDAK dibuang, karena server tidak
 * mengirimnya sama sekali — daftar kosong berarti belum ada pembayaran, dan
 * itu keadaan yang dinyatakan lewat `pesanMetodeKosong`, bukan lewat tabel
 * kosong tanpa penjelasan.
 */
export function barisMetode(perMetode: readonly MetodeRingkas[]): BarisMetode[] {
  return perMetode.map((m) => ({
    kunci: m.metode,
    label: labelMetode(m.metode),
    nominal: rupiah(m.total),
    // ⛔ Angka selalu disertai katanya. "3" di sebelah nominal dapat terbaca
    // sebagai apa saja oleh orang yang membaca sekilas.
    jumlah: m.jumlah === 1 ? '1 transaksi' : `${m.jumlah} transaksi`,
  }));
}

export const PESAN_METODE_KOSONG = 'Belum ada pembayaran yang tercatat hari ini.';

/**
 * ⛔ Kalimat batas yang SELALU tampil, juga saat angkanya lengkap.
 *
 * Penjualan yang dibuat offline baru mendarat di server saat perangkatnya
 * terhubung. Angka di layar ini karena itu adalah apa yang SUDAH sampai, bukan
 * apa yang sudah terjual — dan owner yang tidak diberi tahu akan membacanya
 * sebagai yang kedua, lalu menelepon kasirnya tentang omzet yang sebenarnya
 * ada di antrean sebuah tablet.
 *
 * Bentuk yang sama dengan `CATATAN_BATAS` di panel harga basi: daftar yang
 * tidak menyatakan batasnya akan dibaca sebagai jaminan.
 */
export const CATATAN_ANTREAN =
  'Angka ini dari penjualan yang sudah sampai ke server. Perangkat yang sedang offline belum terhitung di sini.';

export interface BarisOutlet {
  kunci: string;
  nama: string;
  nominal: string;
  jumlah: string;
}

/**
 * Rincian per outlet, siap dirender — AC FR-G6 keempat.
 *
 * ⛔ `null` (satu outlet diminta) dan larik KOSONG diperlakukan sama: tidak ada
 * yang dirender. Keduanya berarti "tidak ada rincian yang menambah apa pun" —
 * yang pertama karena rinciannya akan mengulang totalnya, yang kedua karena
 * belum ada satu pun transaksi di seluruh cabang, dan angka nol itu sudah
 * tertera di atasnya.
 *
 * ⛔ Outlet tanpa nama TIDAK ditampilkan sebagai kosong. Baris omzet tanpa
 * label adalah angka yang tidak dapat ditindaklanjuti siapa pun.
 */
export function barisOutlet(perOutlet: readonly PenjualanOutletRingkas[] | null): BarisOutlet[] {
  if (perOutlet === null) return [];
  return perOutlet.map((o) => ({
    kunci: o.outletId,
    nama: o.outletNama ?? 'Outlet tidak dikenal',
    nominal: rupiah(o.omzetBersih),
    jumlah: o.jumlahTransaksi === 1 ? '1 transaksi' : `${o.jumlahTransaksi} transaksi`,
  }));
}
