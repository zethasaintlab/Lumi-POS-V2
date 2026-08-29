import type { Penyimpanan } from '../../../packages/klien-api/src/sesi-simpanan.ts';

/**
 * Id tenant yang diingat antar kunjungan.
 *
 * ## Kenapa berkas tersendiri
 *
 * Kunci ini dulu konstanta privat di `Masuk.tsx`, dan itu benar selama hanya
 * layar itu yang memakainya. B-00b menjadikannya DUA penulis: pendaftaran
 * menyimpannya begitu tenant lahir, login menyimpannya lagi setelah berhasil.
 *
 * Kunci yang disalin ke berkas kedua adalah kunci yang akan menyimpang, dan
 * yang menyimpang di sini menghasilkan merchant yang baru mendaftar tetap
 * disodori field kosong — persis keadaan yang B-00b dibuat untuk hilangkan.
 *
 * ## ⛔ `localStorage`, dan itu BUKAN kekeliruan
 *
 * Sesi memakai `sessionStorage` (`sesi-simpanan.ts`) karena token adalah
 * rahasia yang tidak boleh tertinggal di laptop yang dipakai bergantian.
 * Id tenant kebalikannya: ia **bukan rahasia** — ia dikirim sebagai header di
 * setiap permintaan — dan seluruh gunanya justru bertahan setelah tab ditutup.
 * Nilai yang hilang bersama tab tidak menghemat apa pun dan mengembalikan
 * merchant ke keadaan yang tidak dapat ia isi sendiri.
 *
 * Sejak `POST /auth/login` dapat meresolusi tenant dari email (migrasi 0023),
 * nilai ini bukan lagi syarat masuk — ia jalan pintas, dan satu-satunya jalan
 * bagi merchant yang emailnya terdaftar di dua tenant.
 */

export const KUNCI_TENANT_TERAKHIR = 'lumi.backoffice.tenant-terakhir';

function penyimpananBawaan(): Penyimpanan | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * ⛔ Mengembalikan string kosong, tidak pernah `null`.
 *
 * Nilainya dipakai langsung sebagai `value` sebuah `<input>`. `null` di sana
 * membuat React berpindah dari uncontrolled ke controlled dan memuntahkan
 * peringatan di setiap ketikan.
 */
export function bacaTenantTerakhir(penyimpanan?: Penyimpanan | null): string {
  const simpanan = penyimpanan ?? penyimpananBawaan();
  if (!simpanan) return '';
  try {
    return simpanan.getItem(KUNCI_TENANT_TERAKHIR) ?? '';
  } catch {
    // Beberapa konfigurasi privasi melempar pada pembacaan, bukan hanya pada
    // penulisan. Yang hilang cukup "diingat sampai kunjungan berikutnya".
    return '';
  }
}

/**
 * ⛔ Nilai kosong TIDAK menimpa yang sudah tersimpan.
 *
 * Layar Masuk memanggil ini dengan isian fieldnya, dan field itu sekarang
 * opsional — merchant yang masuk lewat resolusi email mengirimkannya kosong.
 * Menimpanya berarti pendaftaran yang baru saja menyimpan id tenant
 * kehilangannya pada login pertama, tanpa satu pun error.
 */
export function ingatTenant(id: string, penyimpanan?: Penyimpanan | null): void {
  const bersih = String(id ?? '').trim();
  if (bersih.length === 0) return;

  const simpanan = penyimpanan ?? penyimpananBawaan();
  if (!simpanan) return;
  try {
    simpanan.setItem(KUNCI_TENANT_TERAKHIR, bersih);
  } catch {
    // Private mode. Merchant mengetiknya lagi lain kali — tidak fatal.
  }
}
