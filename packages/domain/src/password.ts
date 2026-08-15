/**
 * FR-F2b — aturan password back-office. Murni: tanpa I/O, tanpa hashing.
 *
 * ## Kenapa ia di `packages/domain`, bukan di modul identity
 *
 * Aturan ini lahir di `identity/handlers/auth.ts` sebagai konstanta privat,
 * dan itu benar selama hanya `PATCH /users/{id}/password` yang memakainya.
 * Pendaftaran merchant (F5) menetapkan password PERTAMA seorang owner —
 * jalur kedua, aturan yang sama.
 *
 * Menyalinnya berarti dua daftar password bocor yang akan menyimpang: yang
 * satu bertambah, yang lain tidak, dan tidak ada apa pun yang gagal saat itu
 * terjadi.
 *
 * ⛔ Yang TIDAK pindah ke sini: hashing. Argon2id menyentuh CPU dan waktu,
 * dan `packages/domain` dibagi dengan klien — ia tetap milik `PinHasher`.
 */

/** `spec-f:174`. */
export const PANJANG_MINIMUM = 10;

/**
 * Daftar password bocor yang di-bundle (`spec-f:174`).
 *
 * ⛔ Daftar ini SENGAJA kecil, dan itu bukan penyelesaian setengah. Daftar
 * sungguhan (rockyou, HIBP) berukuran ratusan megabita dan tidak dapat
 * di-bundle; memakainya menuntut layanan eksternal — yang berarti pendaftaran
 * password gagal saat internet mati, di produk yang seluruh nilainya adalah
 * berfungsi tanpa internet.
 *
 * Yang ada di sini adalah pola yang benar-benar muncul di merchant Indonesia
 * ditambah yang universal. Ia menangkap tebakan pertama, bukan serangan
 * kamus — dan yang menahan serangan kamus adalah Argon2id, bukan daftar ini.
 *
 * Batas ini dicatat supaya tidak dibaca sebagai perlindungan yang lebih besar
 * daripada adanya.
 */
const PASSWORD_BOCOR: ReadonlySet<string> = new Set([
  'password', 'password1', 'password12', 'password123', 'password1234',
  'qwerty12345', '1234567890', '12345678901', 'admin12345', 'administrator',
  'iloveyou12', 'letmein1234', 'welcome1234', 'abcd123456', 'passw0rd123',
  'indonesia1', 'indonesia123', 'jakarta1234', 'bismillah123', 'rahasia123',
]);

export type HasilPeriksaPassword =
  | { ok: true }
  | { ok: false; kode: 'PASSWORD_TOO_SHORT' | 'PASSWORD_BREACHED'; pesan: string };

/**
 * Menerima `unknown`, bukan `string`.
 *
 * Pemanggilnya adalah handler HTTP yang memegang `req.body.password` — nilai
 * yang bentuknya belum dibuktikan siapa pun. Melempar `TypeError` di sini
 * berarti 500, dan 500 untuk password kosong adalah server yang menyalahkan
 * dirinya sendiri atas permintaan klien yang cacat.
 */
export function periksaPassword(password: unknown): HasilPeriksaPassword {
  if (typeof password !== 'string' || password.length < PANJANG_MINIMUM) {
    return {
      ok: false,
      kode: 'PASSWORD_TOO_SHORT',
      pesan: `Password minimal ${PANJANG_MINIMUM} karakter.`,
    };
  }

  if (PASSWORD_BOCOR.has(password.toLowerCase())) {
    return {
      ok: false,
      kode: 'PASSWORD_BREACHED',
      pesan:
        'Password ini termasuk yang paling sering dipakai dan sudah pernah bocor. Pilih yang lain.',
    };
  }

  return { ok: true };
}
