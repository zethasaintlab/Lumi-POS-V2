// Identitas perangkat di sisi klien.
//
// Ia yang membuka tiga hal sekaligus: pengirim REST tahu ke mana dan atas
// nama tenant siapa, penjadwal relay boleh menyala, dan `SumberToken` punya
// sesuatu untuk ditukar jadi token PowerSync (FR-F12).
//
// Modul murni: seluruh I/O lewat port `DbLokal`.

import type { DbLokal } from './ports.ts';

export interface KonfigPerangkat {
  deviceId: string;
  deviceCode: string;
  tenantId: string;
  outletId: string;
  /** Base URL server Lumi, bukan URL PowerSync. */
  baseUrl: string;
  /**
   * Secret perangkat dari `POST /devices/{id}/credentials`.
   *
   * ⛔ Disimpan APA ADANYA di SQLite lokal. AC ketiga FR-F12 menuntut database
   * lokal terenkripsi dengan kunci di keystore OS; itu menunggu Tauri (F4).
   * `null` berarti perangkat tahu siapa dirinya tapi kredensialnya belum ada
   * atau sudah dibuang — layar provisioning memakai keadaan itu untuk meminta
   * secret saja alih-alih seluruh identitas.
   */
  tokenSecret: string | null;
}

interface BarisKonfig {
  device_id: string;
  device_code: string;
  tenant_id: string;
  outlet_id: string;
  base_url: string;
  token_secret: string | null;
}

export async function bacaKonfigPerangkat(db: DbLokal): Promise<KonfigPerangkat | null> {
  const baris = await db.getAll<BarisKonfig>(
    `SELECT device_id, device_code, tenant_id, outlet_id, base_url, token_secret
       FROM device_config WHERE id = 1`
  );
  const b = baris[0];
  if (!b) return null;
  return {
    deviceId: b.device_id,
    deviceCode: b.device_code,
    tenantId: b.tenant_id,
    outletId: b.outlet_id,
    baseUrl: b.base_url,
    tokenSecret: b.token_secret,
  };
}

/**
 * Menyimpan identitas perangkat.
 *
 * `INSERT OR IGNORE` lalu `UPDATE`, BUKAN `INSERT OR REPLACE`: yang terakhir
 * menghapus baris lalu menulis ulang, dan itu **mereset `receipt_sequence` ke
 * nol**. Nomor struk per (device, tanggal bisnis) harus berurutan rapat — I4
 * di harness DST — jadi provisioning ulang yang mengulang nomor struk dari nol
 * adalah pelanggaran invariant, bukan sekadar kerapian.
 *
 * ⛔ Dan BUKAN `ON CONFLICT(id) DO UPDATE`, meski itu bentuk yang paling
 * langsung. Ia bekerja di `node:sqlite` (tempat test ini berjalan) dan
 * DITOLAK oleh `wa-sqlite` yang dipakai aplikasi: *"ON CONFLICT clause does
 * not match any PRIMARY KEY or UNIQUE constraint"* — `id INTEGER PRIMARY KEY`
 * adalah alias rowid, dan versi SQLite keduanya tidak sepakat soal apakah ia
 * sah sebagai sasaran upsert. Ditemukan dengan menjalankan aplikasi setelah
 * seluruh test hijau. Bentuk dua pernyataan di bawah berlaku di keduanya.
 */
export async function simpanKonfigPerangkat(db: DbLokal, konfig: KonfigPerangkat): Promise<void> {
  // Baris ditulis hanya bila belum ada; kolom counter TIDAK disebut di mana
  // pun, jadi ia tidak dapat tersentuh.
  await db.execute(
    `INSERT OR IGNORE INTO device_config (id, device_id, device_code, tenant_id, outlet_id, base_url, token_secret)
     VALUES (1, ?, ?, ?, ?, ?, ?)`,
    [
      konfig.deviceId,
      konfig.deviceCode,
      konfig.tenantId,
      konfig.outletId,
      konfig.baseUrl,
      konfig.tokenSecret,
    ]
  );
  await db.execute(
    `UPDATE device_config
        SET device_id = ?, device_code = ?, tenant_id = ?, outlet_id = ?,
            base_url = ?, token_secret = ?
      WHERE id = 1`,
    [
      konfig.deviceId,
      konfig.deviceCode,
      konfig.tenantId,
      konfig.outletId,
      konfig.baseUrl,
      konfig.tokenSecret,
    ]
  );
}

/** Membuang secret tanpa membuang identitas — dipakai saat kredensial ditolak server. */
export async function hapusSecret(db: DbLokal): Promise<void> {
  await db.execute(`UPDATE device_config SET token_secret = NULL WHERE id = 1`);
}

/**
 * Apakah perangkat boleh mulai mengirim.
 *
 * Dipakai sebagai gerbang penjadwal relay: menyalakannya tanpa identitas
 * berarti memukul endpoint tanpa tenant, 15 detik sekali, sepanjang hari.
 */
export function siapKirim(konfig: KonfigPerangkat | null): boolean {
  if (!konfig) return false;
  return Boolean(
    konfig.tokenSecret &&
      konfig.baseUrl.trim() &&
      konfig.tenantId.trim() &&
      konfig.deviceId.trim()
  );
}
