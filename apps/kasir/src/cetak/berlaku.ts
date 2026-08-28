import type { PrinterProfile } from './escpos.ts';

/**
 * Profil printer mana yang BERLAKU di perangkat ini.
 *
 * ## ⛔ Sebelum berkas ini ada, jawabannya adalah `p[0]`
 *
 * K-09 (cetak ulang) dan K-15 (uji cetak) sama-sama menulis
 * `setProfil(p[0] ?? null)` — baris **pertama** yang query kembalikan. Dan
 * query-nya tidak punya `ORDER BY` sama sekali, jadi yang "pertama" bukan
 * hanya sembarang: ia tidak dijamin apa pun.
 *
 * Merchant yang punya tiga model printer tersinkron karena itu mencetak dengan
 * profil yang dipilih urutan baris, bukan dengan profil printer yang
 * benar-benar tercolok. Gejalanya bukan error: struk 80 mm dipotong di kolom
 * 32, atau perintah potong tercetak sebagai karakter sampah di printer yang
 * tidak punya pemotong. Kasir menyimpulkan printernya rusak.
 *
 * ## ⛔ Pilihan hidup di PERANGKAT, bukan di merchant
 *
 * `device_config.printer_profile_id` — murni lokal. Printer menempel pada
 * perangkat: kasir 1 dengan Epson dan kasir 2 dengan Xprinter di outlet yang
 * sama adalah keadaan normal, dan setelan per-merchant akan memaksa keduanya
 * memakai profil yang sama.
 *
 * ## ⛔ Yang belum memilih TIDAK berhenti mencetak
 *
 * Perangkat yang sudah terpasang sebelum kolom ini ada punya
 * `printer_profile_id = NULL`, dan seluruhnya sedang mencetak hari ini. Yang
 * berlaku untuknya adalah baseline — bukan daftar kosong, dan bukan `p[0]`
 * yang justru sedang diperbaiki. Baseline dipilih karena ia satu-satunya yang
 * benar untuk printer yang TIDAK diketahui: perintahnya dipatuhi hampir setiap
 * printer termal, dan ia tidak mengasumsikan pemotong.
 *
 * Murni: tanpa I/O.
 */

/** `id` baseline 58 mm dari `profil.ts`. Dipakai sebagai jawaban terakhir. */
export const PROFIL_BAWAAN_ID = 'baseline-58';

export interface AlasanProfil {
  profil: PrinterProfile | null;
  /**
   * Kenapa profil ini yang berlaku. Ditampilkan di K-15 — kasir yang melihat
   * profil yang bukan pilihannya harus dapat mengetahui sebabnya, bukan
   * menyimpulkan aplikasinya mengabaikan setelannya.
   */
  sebab: 'dipilih' | 'pilihan-hilang' | 'belum-dipilih' | 'tidak-ada-profil';
}

/**
 * @param daftar seluruh profil yang tersedia (tersinkron + baseline).
 * @param dipilih `device_config.printer_profile_id`, `null` bila belum dipilih.
 */
export function profilBerlaku(
  daftar: readonly PrinterProfile[],
  dipilih: string | null
): AlasanProfil {
  if (daftar.length === 0) return { profil: null, sebab: 'tidak-ada-profil' };

  if (dipilih !== null && dipilih !== '') {
    const cocok = daftar.find((p) => p.id === dipilih);
    if (cocok) return { profil: cocok, sebab: 'dipilih' };
    // ⛔ Pilihan yang menunjuk profil yang sudah TIDAK ADA dibedakan dari
    // "belum memilih". Merchant yang menghapus baris `printer_profile` membuat
    // setiap perangkat yang memilihnya jatuh ke baseline — dan kasir yang
    // strukanya tiba-tiba berubah lebar berhak tahu kenapa, bukan menyimpulkan
    // printernya rusak.
    return { profil: bawaan(daftar), sebab: 'pilihan-hilang' };
  }

  return { profil: bawaan(daftar), sebab: 'belum-dipilih' };
}

/**
 * ⛔ Baseline dicari lewat `id`, BUKAN `daftar[0]`. Mengambil elemen pertama
 * di sini akan mengembalikan tepat cacat yang berkas ini ada untuk
 * memperbaikinya, satu lapis lebih dalam.
 */
function bawaan(daftar: readonly PrinterProfile[]): PrinterProfile {
  return daftar.find((p) => p.id === PROFIL_BAWAAN_ID) ?? daftar[0];
}

/** Kalimat untuk K-15. Setiap sebab punya kalimatnya sendiri. */
export function pesanProfil(sebab: AlasanProfil['sebab'], nama: string | null): string {
  switch (sebab) {
    case 'dipilih':
      return `Perangkat ini memakai profil ${nama}.`;
    case 'pilihan-hilang':
      return `Profil yang dipilih sebelumnya sudah tidak ada. Sementara ini memakai ${nama} — pilih ulang.`;
    case 'belum-dipilih':
      return `Belum ada profil yang dipilih untuk perangkat ini. Sementara ini memakai ${nama}.`;
    default:
      return 'Tidak ada satu pun profil printer di perangkat ini.';
  }
}
