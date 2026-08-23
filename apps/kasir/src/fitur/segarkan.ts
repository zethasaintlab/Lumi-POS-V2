import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import { simpanFitur } from './baca.ts';

/**
 * Menyegarkan feature flag dari server. `ARCH:358`.
 *
 * ## ⛔ TIDAK PERNAH melempar
 *
 * Pemanggilnya adalah boot aplikasi dan penjadwal latar. Kill switch yang
 * menjatuhkan aplikasi saat servernya tidak dapat dihubungi adalah kill switch
 * yang mematikan seluruh fitur sekaligus — termasuk menjual.
 *
 * ## ⛔ Kegagalan MEMPERTAHANKAN keadaan lama, tidak mengosongkannya
 *
 * Respons yang tidak sampai bukan "tidak ada flag": ia "belum tahu". Menulis
 * apa pun atas kegagalan berarti flag yang dimatikan operator menyala kembali
 * setiap kali internet merchant terputus.
 */

export type HasilSegarkan =
  | { kind: 'segar'; jumlah: number }
  | { kind: 'gagal'; status: number | null };

export interface KonfigSegarkan {
  db: DbLokal;
  baseUrl: string;
  tenantId: string;
  deviceId: string;
  tokenSecret: string;
  fetchFn: typeof fetch;
  waktu: () => Date;
  timeoutMs?: number;
}

const TIMEOUT_MS = 5000;

export async function segarkanFitur(konfig: KonfigSegarkan): Promise<HasilSegarkan> {
  const pembatal = new AbortController();
  const jam = setTimeout(() => pembatal.abort(), konfig.timeoutMs ?? TIMEOUT_MS);
  try {
    const res = await konfig.fetchFn(
      `${konfig.baseUrl}/devices/${encodeURIComponent(konfig.deviceId)}/features`,
      {
        method: 'GET',
        headers: {
          'X-Tenant-Id': konfig.tenantId,
          Authorization: `Bearer ${konfig.tokenSecret}`,
        },
        signal: pembatal.signal,
      }
    );
    if (!res.ok) return { kind: 'gagal', status: res.status };

    const body = (await res.json()) as { fitur?: unknown };
    const fitur = body?.fitur;
    if (typeof fitur !== 'object' || fitur === null || Array.isArray(fitur)) {
      // Bentuk yang tidak dikenali diperlakukan sebagai kegagalan, bukan
      // sebagai "tidak ada fitur". Yang kedua akan mengembalikan seluruh flag
      // ke bawaan pada versi server yang bentuk responsnya berubah.
      return { kind: 'gagal', status: res.status };
    }

    // ⛔ Hanya boolean yang diterima. Nilai lain diabaikan, tidak dikoersi:
    // `"false"` yang dikoersi menjadi `true` adalah kill switch yang menyala
    // terbalik, dan tidak ada yang menghasilkan error.
    const bersih: Record<string, boolean> = {};
    for (const [kunci, nilai] of Object.entries(fitur as Record<string, unknown>)) {
      if (typeof nilai === 'boolean') bersih[kunci] = nilai;
    }

    await simpanFitur(konfig.db, bersih, konfig.waktu().toISOString());
    return { kind: 'segar', jumlah: Object.keys(bersih).length };
  } catch {
    // Jaringan putus, timeout, atau tabel lokal belum ada. Keadaan lama
    // dipertahankan apa adanya.
    return { kind: 'gagal', status: null };
  } finally {
    clearTimeout(jam);
  }
}
