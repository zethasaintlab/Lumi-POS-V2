/**
 * Keadaan sesi back-office. Murni: tanpa DOM, tanpa React, tanpa jaringan.
 *
 * Penyimpanan dan jam di-INJECT, mengikuti aturan repo ("lapisan sync ditulis
 * dengan waktu, keacakan, dan I/O di-inject"). Yang di sini dapat diuji di
 * `node --test` tanpa browser sama sekali.
 *
 * ## ⛔ Apa yang token ini SEBENARNYA lakukan hari ini
 *
 * `POST /auth/login` menerbitkan token 32 byte acak, menyimpan SHA-256-nya di
 * `user_session`, dan memberi `expiresAt` 12 jam (`spec-f:176`).
 *
 * Tapi **tidak satu pun endpoint lain memverifikasinya.** Baris
 * `user_session` ditulis oleh login dan dihapus oleh logout; tidak ada kode
 * yang membacanya untuk mengotorisasi permintaan. Setiap endpoint back-office
 * mengotorisasi lewat `X-Actor-Id` + `assertUserVisible` + `assertBoleh` —
 * header biasa berisi id pengguna, bukan bukti kepemilikan.
 *
 * Konsekuensi yang harus dibaca apa adanya: **penjaga rute di aplikasi ini
 * adalah penjaga UX, bukan batas keamanan.** Siapa pun yang tahu sebuah
 * `tenant_id` dan `user_id` dapat memanggil API tanpa pernah login. Menutup
 * itu adalah perubahan SERVER (middleware yang menukar Bearer → aktor), dan
 * ia belum dibangun.
 *
 * Ini dinyatakan, bukan didiamkan, supaya lapisan ini tidak salah dibaca
 * sebagai autentikasi yang sudah selesai. Ada test yang menyematkan kenyataan
 * itu (`tests/backoffice/sesi.test.js`).
 */

export interface Sesi {
  /** Token dari `POST /auth/login`. Dikirim sebagai `Authorization: Bearer`. */
  token: string;
  /** ISO-8601 dari server. Jam SERVER, bukan jam perangkat. */
  expiresAt: string;
  userId: string;
  roles: string[];
  /**
   * ⛔ Ikut disimpan meski login tidak mengembalikannya.
   *
   * `POST /auth/login` MENUNTUT `X-Tenant-Id` — jadi tenant sudah diketahui
   * sebelum login, bukan hasil darinya. Tanpa menyimpannya, setiap permintaan
   * sesudah login tidak punya tenant untuk dikirim, dan seluruh API menolak.
   */
  tenantId: string;
}

export interface Penyimpanan {
  getItem(kunci: string): string | null;
  setItem(kunci: string, nilai: string): void;
  removeItem(kunci: string): void;
}

/**
 * ⛔ `sessionStorage`, bukan `localStorage`.
 *
 * Sesi back-office berumur 12 jam (`spec-f:176`). `localStorage` bertahan
 * setelah browser ditutup, jadi token yang masih berlaku tertinggal di laptop
 * back-office yang dipakai bergantian — persis kasus pemakaian merchant kecil.
 * `sessionStorage` hilang saat tab ditutup dan tidak dibagi antar tab.
 *
 * Yang TIDAK dibeli keduanya: perlindungan terhadap XSS. Tidak ada
 * penyimpanan browser yang memberikannya. Yang meredam dampaknya adalah umur
 * 12 jam dan `POST /auth/logout` yang benar-benar MENGHAPUS barisnya.
 */
export const KUNCI_SESI = 'lumi.backoffice.sesi';

export interface OpsiSesi {
  penyimpanan: Penyimpanan;
  /** Milidetik epoch. Di-inject supaya kedaluwarsa dapat diuji. */
  sekarang: () => number;
}

function sesiValid(nilai: unknown): nilai is Sesi {
  if (typeof nilai !== 'object' || nilai === null) return false;
  const s = nilai as Record<string, unknown>;
  return (
    typeof s.token === 'string' &&
    s.token.length > 0 &&
    typeof s.expiresAt === 'string' &&
    typeof s.userId === 'string' &&
    s.userId.length > 0 &&
    typeof s.tenantId === 'string' &&
    s.tenantId.length > 0 &&
    Array.isArray(s.roles)
  );
}

/**
 * Membaca sesi tersimpan, atau `null`.
 *
 * ⛔ Mengembalikan `null` untuk apa pun yang tidak berbentuk sesi — JSON
 * rusak, field hilang, tipe salah. Melempar di sini akan membuat aplikasi
 * gagal saat boot karena satu baris penyimpanan yang tersunting, dan
 * penggunanya tidak punya cara membersihkannya selain devtools.
 *
 * ⛔ Sesi yang SUDAH KEDALUWARSA dibuang, bukan dikembalikan. Mengembalikannya
 * berarti aplikasi menampilkan shell lalu setiap permintaan gagal 401 — dan
 * layar penuh error terbaca seperti kerusakan, bukan seperti "silakan masuk
 * lagi".
 */
export function bacaSesi({ penyimpanan, sekarang }: OpsiSesi): Sesi | null {
  const mentah = penyimpanan.getItem(KUNCI_SESI);
  if (mentah === null) return null;

  let terurai: unknown;
  try {
    terurai = JSON.parse(mentah);
  } catch {
    penyimpanan.removeItem(KUNCI_SESI);
    return null;
  }

  if (!sesiValid(terurai)) {
    penyimpanan.removeItem(KUNCI_SESI);
    return null;
  }

  if (sudahKedaluwarsa(terurai, sekarang())) {
    penyimpanan.removeItem(KUNCI_SESI);
    return null;
  }

  return terurai;
}

/**
 * `expiresAt` yang tidak dapat dibaca dianggap KEDALUWARSA, bukan berlaku
 * selamanya. `new Date('bukan tanggal').getTime()` menghasilkan `NaN`, dan
 * setiap perbandingan dengan `NaN` bernilai `false` — jadi `waktu > sekarang`
 * akan diam-diam menjawab "belum kedaluwarsa" untuk nilai yang rusak.
 */
export function sudahKedaluwarsa(sesi: Sesi, sekarang: number): boolean {
  const waktu = new Date(sesi.expiresAt).getTime();
  if (Number.isNaN(waktu)) return true;
  return waktu <= sekarang;
}

export function simpanSesi(sesi: Sesi, { penyimpanan }: Pick<OpsiSesi, 'penyimpanan'>): void {
  penyimpanan.setItem(KUNCI_SESI, JSON.stringify(sesi));
}

export function hapusSesi({ penyimpanan }: Pick<OpsiSesi, 'penyimpanan'>): void {
  penyimpanan.removeItem(KUNCI_SESI);
}

/**
 * Penyimpanan yang tidak menyimpan apa pun.
 *
 * Dipakai saat `sessionStorage` tidak dapat diakses — Safari private mode
 * melemparkan pada `setItem`, dan beberapa konfigurasi privasi memblokirnya
 * sama sekali. Aplikasi tetap dapat dipakai selama tab terbuka; yang hilang
 * hanya bertahan-melewati-reload.
 */
export function penyimpananMemori(): Penyimpanan {
  const peta = new Map<string, string>();
  return {
    getItem: (k) => peta.get(k) ?? null,
    setItem: (k, v) => void peta.set(k, v),
    removeItem: (k) => void peta.delete(k),
  };
}

export function penyimpananBrowser(): Penyimpanan {
  try {
    const uji = '__lumi_uji__';
    window.sessionStorage.setItem(uji, '1');
    window.sessionStorage.removeItem(uji);
    return window.sessionStorage;
  } catch {
    return penyimpananMemori();
  }
}
