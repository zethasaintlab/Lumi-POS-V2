import type { PoolClient } from '../../../db.ts';

/**
 * FR-A7 AC keempat — *"Dashboard menampilkan device mana yang belum menerima
 * perubahan harga terakhir."*
 *
 * ## ⛔ Masalah yang dijawabnya
 *
 * `spec-a:220` menyatakan bahwa perangkat offline yang memakai harga lama
 * adalah **BENAR**: itulah harga yang tercetak dan dibayar pelanggan. Yang
 * TIDAK benar adalah merchant yang menaikkan harga lalu tidak tahu bahwa satu
 * kasirnya masih menjual dengan harga lama — berhari-hari, tanpa satu pun
 * error di mana pun.
 *
 * ## ⛔ "Terakhir terlihat" adalah PROKSI, bukan bukti
 *
 * Kita tidak dapat mengetahui apa yang benar-benar sudah mendarat di
 * perangkat: checkpoint PowerSync hidup di tabel `ps_*` MILIK PERANGKAT, dan
 * server kami tidak dapat membacanya. Yang server tahu hanya kapan perangkat
 * terakhir meminta token sinkronisasi (`device.last_seen_at`).
 *
 * Arahnya karena itu satu arah, dan itu yang membuat laporan ini berguna:
 *
 * - `last_seen_at < effective_from` → perangkat **PASTI** belum menerimanya.
 *   Ia belum menghubungi kami sejak harga itu ditulis.
 * - `last_seen_at >= effective_from` → **belum tentu** sudah. Perangkat
 *   menghubungi kami, tetapi replikasinya mungkin masih berjalan.
 *
 * Layar wajib menyatakan asimetri itu. Merchant yang membaca daftar kosong
 * sebagai "semua perangkat sudah memakai harga baru" akan menyimpulkan lebih
 * dari yang datanya dukung.
 *
 * ## ⛔ Ia MEMBACA lintas domain, dan karena itu ada di `reporting`
 *
 * `device` milik identity, `price_history` milik catalog. Invariant #4
 * mengizinkan `reporting` menjahitnya justru karena modul ini tidak memiliki
 * satu pun tabel dan tidak pernah menulis.
 */

export interface PerangkatHargaBasi {
  deviceId: string;
  kode: string;
  nama: string;
  outletId: string;
  outletNama: string | null;
  /** `null` = perangkat ini BELUM PERNAH menghubungi server sama sekali. */
  lastSeenAt: string | null;
  /** Berapa perubahan harga yang ditulis setelah perangkat terakhir terlihat. */
  perubahanTertinggal: number;
  /** Perubahan harga paling awal yang belum pasti diterimanya. */
  tertinggalSejak: string;
}

export interface RingkasanHargaBasi {
  /** `null` = belum pernah ada perubahan harga sama sekali. */
  perubahanTerakhir: string | null;
  perangkat: PerangkatHargaBasi[];
  /**
   * ⛔ Jumlah perangkat AKTIF yang diperiksa, dan itu bukan hiasan. Daftar
   * kosong dari nol perangkat berarti hal yang sangat berbeda dari daftar
   * kosong dari sepuluh perangkat — dan keduanya terlihat sama.
   */
  jumlahDiperiksa: number;
}

interface Baris {
  device_id: string;
  code: string;
  name: string;
  outlet_id: string;
  outlet_nama: string | null;
  last_seen_at: Date | null;
  tertinggal: string;
  sejak: Date;
}

const keIso = (n: Date | string): string => (typeof n === 'string' ? n : n.toISOString());

export async function ambilHargaBasi(
  client: PoolClient,
  { outletId }: { outletId: string | null }
): Promise<RingkasanHargaBasi> {
  const { rows: terakhir } = await client.query<{ pada: Date | null }>(
    `SELECT max(effective_from) AS pada FROM price_history
      WHERE ($1::text IS NULL OR outlet_id = $1 OR outlet_id IS NULL)`,
    [outletId]
  );
  const perubahanTerakhir = terakhir[0]?.pada ?? null;

  const { rows: jumlah } = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM device
      WHERE revoked_at IS NULL AND ($1::text IS NULL OR outlet_id = $1)`,
    [outletId]
  );

  const { rows } = await client.query<Baris>(
    // ⛔ Perangkat yang BELUM PERNAH terlihat (last_seen_at NULL) ikut,
    // dan ia justru yang paling penting: perangkat yang baru didaftarkan dan
    // tidak pernah menyala tidak akan pernah memakai harga apa pun yang benar.
    // COALESCE ke '-infinity' membuatnya tertinggal SELURUH perubahan
    // alih-alih hilang dari daftar.
    `SELECT d.id                       AS device_id,
            d.code,
            d.name,
            d.outlet_id,
            o.name                     AS outlet_nama,
            d.last_seen_at,
            count(p.id)::text          AS tertinggal,
            min(p.effective_from)      AS sejak
       FROM device d
       LEFT JOIN outlet o ON o.id = d.outlet_id
       JOIN price_history p
         ON p.effective_from > COALESCE(d.last_seen_at, '-infinity'::timestamptz)
        -- Harga masa DEPAN tidak dihitung tertinggal: effective_from boleh di
        -- masa depan (harga terjadwal), dan perangkat yang belum menerimanya
        -- belum kehilangan apa pun -- harga itu memang belum berlaku untuk
        -- siapa pun.
        AND p.effective_from <= now()
        -- Harga milik outlet lain tidak menyentuh perangkat ini; harga
        -- ber-outlet_id NULL berlaku untuk semuanya (tangga tiga tingkat).
        AND (p.outlet_id IS NULL OR p.outlet_id = d.outlet_id)
      WHERE d.revoked_at IS NULL
        AND ($1::text IS NULL OR d.outlet_id = $1)
      GROUP BY d.id, d.code, d.name, d.outlet_id, o.name, d.last_seen_at
      ORDER BY d.last_seen_at ASC NULLS FIRST, d.code`,
    [outletId]
  );

  return {
    perubahanTerakhir: perubahanTerakhir === null ? null : keIso(perubahanTerakhir),
    jumlahDiperiksa: Number(jumlah[0]?.n ?? '0'),
    perangkat: rows.map((r) => ({
      deviceId: r.device_id,
      kode: r.code,
      nama: r.name,
      outletId: r.outlet_id,
      outletNama: r.outlet_nama,
      lastSeenAt: r.last_seen_at === null ? null : keIso(r.last_seen_at),
      perubahanTertinggal: Number(r.tertinggal),
      tertinggalSejak: keIso(r.sejak),
    })),
  };
}
