import type { PoolClient } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import { tanggalBisnis } from '../../../../../../packages/domain/src/tanggal-bisnis.ts';

/**
 * Tanggal bisnis "hari ini" — diputuskan SERVER, bukan perangkat.
 *
 * ## ⛔ Kenapa bukan dihitung di HP owner
 *
 * `tanggalBisnis` murni dan dapat berjalan di mana saja, jadi menghitungnya di
 * klien terlihat lebih sederhana. Ia menuntut tiga masukan: momen, zona
 * outlet, dan jam tutup — dan **momen** itulah masalahnya. Jam HP dapat salah,
 * dan FR-F8 ada di produk ini justru karena jam perangkat berbohong cukup
 * sering untuk perlu dideteksi. HP yang jamnya maju satu hari menampilkan
 * ringkasan hari yang belum terjadi: nol transaksi, tanpa satu pun error, dan
 * owner menyimpulkan outletnya tidak berjualan sama sekali.
 *
 * Aturan yang sama dengan "waktu selalu dari jam database, tidak pernah
 * `new Date()` di Node" (`CLAUDE.md`) — di sini `new Date()` di browser.
 *
 * ## ⛔ Tanpa `outlet_id`, jawabannya hanya ada bila SELURUH outlet sepakat
 *
 * Indonesia punya tiga zona waktu, dan jam tutup dipilih per outlet. Merchant
 * yang cabangnya di Jakarta dan Jayapura tidak punya satu "hari ini" — pukul
 * 23:00 di Jayapura masih pukul 21:00 di Jakarta, dan sebuah angka gabungan
 * memuat dua hari bisnis yang berbeda. Menebaknya berarti melaporkan omzet
 * yang tidak dapat dicocokkan dengan tutup kas cabang mana pun.
 *
 * Dijawab `400 BUSINESS_DATE_AMBIGUOUS` dengan instruksi memilih outlet —
 * bentuk yang sama dengan keputusan "ringkasan stok `null` tanpa `outlet_id`":
 * angka gabungan yang tidak dapat dipakai memutuskan apa pun tidak dikarang.
 */
export async function tanggalBisnisHariIni(
  client: PoolClient,
  outletId: string | null
): Promise<string> {
  // ⛔ `now()` DATABASE, satu jam untuk seluruh sistem. Lihat catatan kepala.
  const { rows } = await client.query<{
    timezone: string;
    business_day_ends_at: string;
    sekarang: string;
  }>(
    outletId === null
      ? `SELECT DISTINCT o.timezone, o.business_day_ends_at::text, now()::text AS sekarang
           FROM outlet o
          WHERE o.archived_at IS NULL`
      : `SELECT o.timezone, o.business_day_ends_at::text, now()::text AS sekarang
           FROM outlet o
          WHERE o.id = $1`,
    outletId === null ? [] : [outletId]
  );

  if (rows.length === 0) {
    throw new HttpError(
      404,
      'OUTLET_NOT_FOUND',
      'Tidak ada outlet aktif yang dapat dipakai menentukan tanggal hari ini.'
    );
  }

  if (rows.length > 1) {
    throw new HttpError(
      400,
      'BUSINESS_DATE_AMBIGUOUS',
      'Outlet Anda memakai zona waktu atau jam tutup yang berbeda, jadi "hari ini" berarti tanggal yang berbeda di tiap cabang. Pilih satu outlet, atau sebutkan tanggalnya.'
    );
  }

  const o = rows[0];
  return tanggalBisnis(new Date(o.sekarang), o.timezone, o.business_day_ends_at);
}
