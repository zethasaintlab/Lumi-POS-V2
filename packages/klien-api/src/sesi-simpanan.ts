/**
 * Keadaan sesi back-office. Murni: tanpa DOM, tanpa React, tanpa jaringan.
 *
 * Penyimpanan dan jam di-INJECT, mengikuti aturan repo ("lapisan sync ditulis
 * dengan waktu, keacakan, dan I/O di-inject"). Yang di sini dapat diuji di
 * `node --test` tanpa browser sama sekali.
 *
 * ## Apa yang token ini lakukan
 *
 * `POST /auth/login` menerbitkan token 32 byte acak, menyimpan SHA-256-nya di
 * `user_session`, dan memberi `expiresAt` 12 jam (`spec-f:176`).
 *
 * Sejak `apps/server/src/sesi.ts` ada, token itu **diverifikasi server pada
 * setiap permintaan ke permukaan back-office**: middleware `preHandler`
 * mencari barisnya, menolak yang kedaluwarsa atau milik pengguna nonaktif,
 * lalu menetapkan tenant dan aktor DARI BARIS ITU. `X-Actor-Id` yang dikirim
 * klien tidak pernah dibaca di rute terlindungi.
 *
 * ⛔ **Batas yang tersisa, dan harus dibaca apa adanya:** jalur perangkat
 * kasir (`POST /orders`, `/shifts`, `/orders/{id}/cancel`,
 * `/orders/{id}/payments`) TIDAK ikut dilindungi. Relay outbox tidak mengirim
 * Bearer sama sekali dan `spec-f:183` melarang kasir punya sesi
 * back-office — melindunginya berarti setiap penjualan offline yang menyusul
 * dijawab 401. Kredensial perangkat (FR-F12) belum menjadi kredensial
 * permintaan; itu pekerjaan tersendiri.
 *
 * Versi pertama berkas ini menyatakan bahwa penjaga rute di aplikasi ini
 * "penjaga UX, bukan batas keamanan". Untuk permukaan back-office, itu tidak
 * berlaku lagi.
 */

export interface Sesi {
  /** Token dari `POST /auth/login`. Dikirim sebagai `Authorization: Bearer`. */
  token: string;
  /** ISO-8601 dari server. Jam SERVER, bukan jam perangkat. */
  expiresAt: string;
  userId: string;
  /**
   * Nama pengguna, dari respons login.
   *
   * ⛔ Ia ada supaya layar tidak menampilkan `userId`. Sampai 31 Agustus 2026
   * `/auth/login` tidak mengembalikan nama sama sekali, dan back-office
   * menampilkan UUID mentah sebagai nama pengguna di pojok SETIAP layar —
   * "fee9f9b5-5b0a-40...". Ditemukan dengan membuka aplikasinya di browser.
   *
   * OPSIONAL, dan itu disengaja: sesi yang sudah tersimpan di `sessionStorage`
   * milik merchant yang sedang masuk TIDAK punya field ini. Menjadikannya
   * wajib membuat `sesiValid` menolak sesi itu, dan setiap orang yang sedang
   * bekerja terlempar ke layar login saat aplikasi diperbarui.
   */
  nama?: string;
  roles: string[];
  /**
   * Tenant yang dipakai sesi ini, **dari respons login**.
   *
   * ⛔ Bukan dari isian form. `X-Tenant-Id` opsional sejak migrasi 0023 —
   * server meresolusinya dari email bila tidak disebut, dan responsnya adalah
   * satu-satunya tempat klien dapat mengetahui hasilnya. Menyimpan isian form
   * berarti sesi merchant yang masuk lewat resolusi menyimpan tenant kosong,
   * dan setiap permintaan sesudahnya ditolak 400.
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
