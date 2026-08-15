import type { Sesi } from './sesi-simpanan.ts';

/**
 * Satu-satunya pintu keluar HTTP back-office.
 *
 * ## ⛔ TIGA header dikirim, dan hanya DUA yang benar-benar dipakai server
 *
 * | Header | Perannya di rute back-office |
 * |---|---|
 * | `Authorization: Bearer` | **Kredensialnya.** Middleware server mencari barisnya di `user_session`, menolak yang kedaluwarsa atau milik pengguna nonaktif |
 * | `X-Tenant-Id` | **Petunjuk pencarian**, bukan otoritas. `user_session` tunduk RLS, jadi pembacaannya menuntut `app.tenant_id`. Berbohong tidak membeli apa pun — token tenant A tidak ditemukan saat dicari di tenant B |
 * | `X-Actor-Id` | **DIABAIKAN** di rute terlindungi. Aktor datang dari baris sesi |
 *
 * `X-Actor-Id` tetap dikirim karena jalur perangkat kasir masih memakainya
 * (rute terbuka), dan mengirimnya di kedua tempat lebih sederhana daripada
 * dua klien yang berbeda. Di rute terlindungi ia tidak berpengaruh apa pun —
 * ada test server yang membuktikannya (`tests/identity/sesi-middleware`).
 *
 * ## Kenapa satu pintu, bukan `fetch` di tiap layar
 *
 * Header yang disuntikkan pemanggil akan lupa disuntikkan di satu tempat, dan
 * tempat itu akan menjadi layar yang diam-diam memanggil API sebagai tenant
 * yang salah — atau tanpa aktor sama sekali, lalu 400 yang tidak dapat
 * dijelaskan penggunanya.
 */

export class GalatHttp extends Error {
  status: number;
  kode: string;

  constructor(status: number, kode: string, pesan: string) {
    super(pesan);
    this.name = 'GalatHttp';
    this.status = status;
    this.kode = kode;
  }
}

export interface OpsiKlien {
  /** Contoh: `http://localhost:3000`. Tanpa garis miring di akhir. */
  baseUrl: string;
  fetch: typeof globalThis.fetch;
  /** Dibaca SETIAP permintaan, bukan sekali saat klien dibuat. Lihat di bawah. */
  sesi: () => Sesi | null;
  /** Dipanggil saat server menjawab 401 — sesi dibuang, pengguna diminta masuk. */
  onSesiHabis?: () => void;
}

export interface PermintaanApi {
  metode?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Diserialisasi JSON. Dikosongkan berarti tanpa body. */
  body?: unknown;
  /** Header tambahan, mis. `Idempotency-Key`. Tidak dapat menimpa header sesi. */
  header?: Record<string, string>;
}

export interface KlienApi {
  minta<T>(jalur: string, opsi?: PermintaanApi): Promise<T>;
}

export function buatKlien(opsi: OpsiKlien): KlienApi {
  return {
    async minta<T>(jalur: string, permintaan: PermintaanApi = {}): Promise<T> {
      // ⛔ Sesi dibaca DI SINI, tiap permintaan — bukan ditangkap saat klien
      // dibuat. Klien dibuat sekali seumur aplikasi, sementara sesi berganti
      // saat login dan hilang saat logout. Menangkapnya di closure membuat
      // permintaan setelah login memakai `null` yang lama, dan gejalanya
      // adalah 400 "Header X-Tenant-Id wajib diisi" tepat setelah login
      // berhasil.
      const sesi = opsi.sesi();

      const adaBody = permintaan.body !== undefined;

      // ⛔ `content-type: application/json` HANYA saat ada body.
      //
      // Fastify menolak permintaan ber-`content-type: application/json` yang
      // body-nya kosong dengan `400 FST_ERR_CTP_EMPTY_JSON_BODY` — dan itu
      // mengenai SETIAP POST tanpa body, bukan hanya logout:
      // `/auth/logout`, `/items/{id}/archive`, `/items/{id}/restore`,
      // `/devices/{id}/revoke`, dan seterusnya.
      //
      // Ditemukan dengan menjalankannya, bukan lewat test: fake `fetch` di
      // `tests/backoffice/sesi.test.js` menjawab 204 dengan patuh karena ia
      // tidak menegakkan aturan Fastify mana pun. Kelas yang sama dengan
      // "fake `DbLokal` tidak menegakkan constraint apa pun" (`CLAUDE.md`) —
      // yang hijau di test dan gagal keras di jalur sungguhan.
      const header: Record<string, string> = { ...permintaan.header };
      if (adaBody) header['content-type'] = 'application/json';

      if (sesi) {
        // Ditulis SETELAH `permintaan.header` supaya header sesi tidak dapat
        // ditimpa pemanggil. Layar yang mengirim `x-actor-id` sendiri akan
        // bertindak atas nama orang lain, dan audit trail akan
        // mencatatkannya sebagai orang itu.
        header['x-tenant-id'] = sesi.tenantId;
        header['x-actor-id'] = sesi.userId;
        header.authorization = `Bearer ${sesi.token}`;
      }

      const res = await opsi.fetch(`${opsi.baseUrl}${jalur}`, {
        method: permintaan.metode ?? 'GET',
        headers: header,
        body: adaBody ? JSON.stringify(permintaan.body) : undefined,
      });

      if (res.status === 401) {
        // Sesi ditolak server. Dibuang di sini, bukan dibiarkan sampai
        // permintaan berikutnya — aplikasi yang menampilkan shell dengan sesi
        // mati menghasilkan layar penuh error yang terbaca seperti kerusakan.
        opsi.onSesiHabis?.();
      }

      if (res.status === 204) return undefined as T;

      const teks = await res.text();
      let terurai: unknown = null;
      if (teks.length > 0) {
        try {
          terurai = JSON.parse(teks);
        } catch {
          terurai = null;
        }
      }

      if (!res.ok) {
        const galat = (terurai as { error?: { code?: string; message?: string } } | null)?.error;
        throw new GalatHttp(
          res.status,
          galat?.code ?? 'UNKNOWN',
          // ⛔ Pesan server dipakai apa adanya bila ada. Ia sudah ditulis
          // dalam bahasa Indonesia dan MEMBAWA ANGKANYA (pesan kuota menyebut
          // terpakai/batas). Menggantinya dengan "Terjadi kesalahan" di sini
          // membuang satu-satunya informasi yang dapat dipakai pengguna.
          galat?.message ?? `Permintaan gagal (${res.status}).`
        );
      }

      return terurai as T;
    },
  };
}

export interface HasilLogin {
  token: string;
  expiresAt: string;
  userId: string;
  roles: string[];
}

/**
 * `POST /auth/login`.
 *
 * ⛔ Ia MENUNTUT `X-Tenant-Id`, dan itu berarti tenant harus sudah diketahui
 * SEBELUM login — bukan hasil darinya. Karena itu fungsi ini menerima
 * `tenantId` dan mengirim headernya sendiri, alih-alih lewat `buatKlien`
 * (yang mengambilnya dari sesi yang belum ada).
 *
 * Ini gap produk yang nyata dan dicatat: merchant tidak menghafal UUID
 * tenant-nya. Jalan keluarnya (subdomain, atau pencarian by-email lintas
 * tenant di server) belum diputuskan.
 */
export async function masuk(
  opsi: { baseUrl: string; fetch: typeof globalThis.fetch },
  kredensial: { tenantId: string; email: string; password: string }
): Promise<HasilLogin> {
  const res = await opsi.fetch(`${opsi.baseUrl}/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-tenant-id': kredensial.tenantId,
    },
    body: JSON.stringify({ email: kredensial.email, password: kredensial.password }),
  });

  const teks = await res.text();
  let terurai: unknown = null;
  try {
    terurai = JSON.parse(teks);
  } catch {
    terurai = null;
  }

  if (!res.ok) {
    const galat = (terurai as { error?: { code?: string; message?: string } } | null)?.error;
    throw new GalatHttp(
      res.status,
      galat?.code ?? 'UNKNOWN',
      galat?.message ?? 'Email atau password salah.'
    );
  }

  return terurai as HasilLogin;
}
