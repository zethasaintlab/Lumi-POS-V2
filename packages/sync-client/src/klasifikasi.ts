import type { HasilKirim } from './ports.ts';

/**
 * Apa yang harus dilakukan relay terhadap satu jawaban.
 *
 * - `terkirim`      — item sudah ada di server. Selesai, jangan kirim lagi.
 * - `coba-lagi`     — bukan salah payload. Backoff, `attempts` naik.
 * - `gagal-permanen`— payload cacat. Langsung `failed`, tanpa 20 percobaan.
 */
export type Keputusan = 'terkirim' | 'coba-lagi' | 'gagal-permanen';

/**
 * Kode 409 yang berarti item SUDAH ADA di server.
 *
 * `openShift` tidak menuntut Idempotency-Key -- yang melindunginya hanya
 * primary key yang di-generate klien (`apps/server/src/modules/cash/handlers/
 * shifts.ts`, `isPrimaryKeyViolation` -> 409 ID_ALREADY_EXISTS). Retry karena
 * itu WAJIB dibaca sebagai berhasil; menganggapnya gagal berarti mengirim
 * ulang sampai batas 20 percobaan lalu menandai shift yang sehat `failed`.
 */
const SUDAH_ADA = new Set(['ID_ALREADY_EXISTS']);

/** 409 yang berarti request kembar sedang diproses -- jawabannya akan datang. */
const SEDANG_DIPROSES = new Set(['IDEMPOTENCY_KEY_CONFLICT']);

export function klasifikasi(hasil: HasilKirim): Keputusan {
  const { status, code } = hasil;

  // Respons HILANG: jaringan putus, timeout, perangkat kehilangan sinyal.
  //
  // Ini kasus yang membuat idempotency ada sama sekali, dan ia TIDAK BOLEH
  // dibaca sebagai gagal permanen: permintaannya mungkin sudah sampai dan
  // diproses. Menandainya `failed` berarti penjualan yang sudah tercatat di
  // server menghilang dari antrean tanpa pernah dikonfirmasi.
  if (status === null || status === undefined) return 'coba-lagi';

  if (status >= 200 && status < 300) return 'terkirim';

  if (status === 409) {
    if (code && SUDAH_ADA.has(code)) return 'terkirim';
    if (code && SEDANG_DIPROSES.has(code)) return 'coba-lagi';
    // Kode 409 yang tidak dikenal TIDAK PERNAH ditebak sebagai `terkirim`.
    // Menghapus item dari antrean berdasarkan kata yang tidak dimengerti
    // adalah kehilangan penjualan; mencobanya lagi paling buruk hanya
    // membuang satu percobaan. Pola yang sama dengan aturan gateway di
    // CLAUDE.md: status tak dikenal -> `pending`, tidak pernah `confirmed`.
    return 'coba-lagi';
  }

  // 429 bukan payload yang cacat -- server sedang sibuk, dan payload yang
  // sama akan diterima nanti.
  if (status === 429) return 'coba-lagi';

  // Sisa 4xx: validasi gagal, header hilang, entitas tidak ditemukan, atau
  // key dipakai ulang untuk body berbeda. Semuanya cacat payload, dan 20
  // percobaan hanya menunda laporannya.
  if (status >= 400 && status < 500) return 'gagal-permanen';

  // 5xx dan sisanya: server, bukan payload.
  return 'coba-lagi';
}
