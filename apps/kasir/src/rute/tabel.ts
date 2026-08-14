// Tabel rute aplikasi kasir, dan pencocokannya.
//
// Berkas ini SENGAJA tidak mengimpor React maupun PowerSync. Itu yang membuat
// `node --experimental-strip-types --test` dapat memuatnya apa adanya
// (keputusan user 8 Agustus 2026, PLAN-pondasi-kasir §3.1: logika ditulis
// sebagai fungsi murni, React dijaga tipis). Menambahkan satu impor React di
// sini akan mematikan seluruh suite `test:kasir` untuk berkas ini.
//
// Daftar rutenya adalah terjemahan langsung `product/IA-lumi-pos-v1.md` §7
// (baris 308-317). Kode layar berasal dari §2.2 dokumen yang sama.

/** Prefiks aplikasi kasir sebagaimana ditulis IA §7. */
export const BASIS = '/kasir';

export interface Rute {
  /** Jalur relatif terhadap akar aplikasi, persis seperti tertulis di IA §7. */
  jalur: string;
  /** Kode layar IA §2.2 -- bukan nama bebas; ia jangkar ke dokumen. */
  layar: string;
  /** Judul yang dipakai topbar dan layar `BelumDibangun`. */
  nama: string;
}

/**
 * Delapan rute, tidak lebih.
 *
 * K-04, K-05, K-10, K-11, dan K-16 adalah modal/dialog di IA §2.2, bukan
 * layar ber-URL. K-06 (Pembayaran), K-07 (Kembalian), K-13 (Laporan Shift),
 * dan K-17 (Cari Produk) adalah layar tetapi IA §7 TIDAK memberi mereka URL.
 * Mengarang URL untuk mereka berarti memutuskan sesuatu yang belum diputuskan
 * pemilik produk, jadi mereka tidak ada di sini.
 */
export const TABEL_RUTE: Rute[] = [
  { jalur: '/login', layar: 'K-01', nama: 'Login' },
  { jalur: '/shift/buka', layar: 'K-02', nama: 'Buka Shift' },
  { jalur: '/', layar: 'K-03', nama: 'Kasir' },
  { jalur: '/riwayat', layar: 'K-08', nama: 'Riwayat Transaksi' },
  { jalur: '/riwayat/:orderId', layar: 'K-09', nama: 'Detail Transaksi' },
  { jalur: '/shift/tutup', layar: 'K-12', nama: 'Tutup Kas' },
  { jalur: '/sync', layar: 'K-14', nama: 'Status Sinkronisasi' },
  { jalur: '/perangkat', layar: 'K-15', nama: 'Perangkat & Uji Cetak' },
];

/** Layar untuk jalur yang tidak dikenal. Bukan salah satu rute di atas. */
export const LAYAR_TIDAK_DITEMUKAN = 'TIDAK-DITEMUKAN';

export interface HasilCocok {
  layar: string;
  params: Record<string, string>;
  /** null pada jalur tak dikenal. */
  rute: Rute | null;
}

function segmen(jalur: string): string[] {
  return jalur.split('/').filter((s) => s.length > 0);
}

/**
 * Menormalkan pathname sebelum dicocokkan.
 *
 * Query dan fragment dibuang di sini, bukan diserahkan ke pemanggil: satu
 * `SyncIndicator` yang menavigasi ke `/sync?dari=topbar` sudah cukup untuk
 * membuat kasir mendapat layar "tidak ditemukan" kalau ini tidak dilakukan.
 */
function normalkan(pathname: string): string[] {
  const bersih = pathname.split('#')[0].split('?')[0];
  const bagian = segmen(bersih);
  // IA §7 menuliskan rute kasir bersarang di bawah `/kasir`. Apakah prefiks
  // itu benar-benar muncul di pathname bergantung pada cara aplikasi
  // disajikan -- Tauri menyajikannya dari root, browser pengembangan bisa
  // tidak. Kedua bacaan diterima; tidak ada yang perlu ditebak.
  if (bagian[0] === BASIS.slice(1)) bagian.shift();
  return bagian;
}

function cocokkanSatu(rute: Rute, bagian: string[]): Record<string, string> | null {
  const pola = segmen(rute.jalur);
  if (pola.length !== bagian.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < pola.length; i += 1) {
    const p = pola[i];
    if (p.startsWith(':')) {
      // Segmen kosong bukan nilai parameter. `/riwayat/` harus jatuh ke
      // daftar riwayat, bukan ke detail order ber-id kosong.
      if (bagian[i].length === 0) return null;
      params[p.slice(1)] = bagian[i];
      continue;
    }
    if (p !== bagian[i]) return null;
  }
  return params;
}

/**
 * Mencocokkan pathname ke satu layar.
 *
 * Rute statis diperiksa lebih dulu, jadi `/riwayat` tidak pernah tertelan
 * `/riwayat/:orderId` -- keduanya layar berbeda di IA §2.2 (K-08 dan K-09).
 */
export function cocokkanRute(pathname: string): HasilCocok {
  const bagian = normalkan(pathname);
  const statis = TABEL_RUTE.filter((r) => !r.jalur.includes(':'));
  const berparameter = TABEL_RUTE.filter((r) => r.jalur.includes(':'));

  for (const rute of [...statis, ...berparameter]) {
    const params = cocokkanSatu(rute, bagian);
    if (params) return { layar: rute.layar, params, rute };
  }
  return { layar: LAYAR_TIDAK_DITEMUKAN, params: {}, rute: null };
}
