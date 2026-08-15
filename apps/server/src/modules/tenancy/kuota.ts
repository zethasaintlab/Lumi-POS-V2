import type { PoolClient } from '../../db.ts';
import { HttpError } from '../../http-error.ts';
import type { KuotaPaket } from '../../../../../packages/domain/src/paket.ts';
import { periksaKuota, type DimensiKuota } from '../../../../../packages/domain/src/kuota.ts';

// Penegakan kuota milik modul tenancy karena kolom `max_*` ada di tabel
// `tenant`. Ia dipisah dari `index.ts` supaya handler DI DALAM modul ini
// (`handlers/outlets.ts`) dapat memakainya tanpa impor melingkar — dan
// `index.ts` tetap satu-satunya permukaan publik bagi modul lain.
/**
 * Pemakaian kuota `max_outlets` — satu-satunya dimensi yang tabelnya milik
 * modul ini.
 *
 * ⛔ Outlet yang DIARSIPKAN tidak dihitung. Merchant yang menutup cabang
 * harus mendapatkan kembali slotnya; kalau tidak, kuota menjadi penghitung
 * seumur hidup dan bukan batas kapasitas — dan tidak ada cara memulihkannya,
 * karena outlet tidak pernah di-`DELETE` (invariant #2).
 */
export async function hitungOutlet(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ n: string }>(
    'SELECT count(*) AS n FROM outlet WHERE archived_at IS NULL'
  );
  return Number(rows[0].n);
}

/**
 * Batas kuota tenant — `research/09` § 6.
 *
 * ## ⛔ Satu-satunya query di repo ini yang `WHERE`-nya WAJIB, bukan gaya
 *
 * `tenant` **dikecualikan dari RLS** (`0002_tenancy.sql`: ia akar model
 * tenancy, tidak ada "tenant lain" untuk di-scope di dalam tabel itu). Setiap
 * tabel lain akan menyaring dirinya sendiri walau `WHERE tenant_id` lupa
 * ditulis; di sini tidak. `SELECT max_products FROM tenant` tanpa `WHERE`
 * mengembalikan baris SETIAP merchant, dan kuota yang dibaca adalah kuota
 * siapa pun yang kebetulan pertama.
 *
 * Karena itu `tenantId` adalah parameter, bukan sesuatu yang disimpulkan dari
 * `app.tenant_id` — tidak ada apa pun di lapisan database yang akan
 * menangkapnya kalau salah.
 *
 * ## Kenapa ia tidak menghitung pemakaian
 *
 * Invariant #4. `COUNT(*) FROM item` milik catalog, `FROM device` milik
 * identity. Memindahkannya ke sini akan menuntut modul tenancy tahu bahwa
 * produk yang diarsipkan tidak dihitung dan perangkat yang dicabut tidak
 * dihitung — aturan yang dimiliki modul lain.
 */
export async function batasKuota(client: PoolClient, tenantId: string): Promise<KuotaPaket> {
  const { rows } = await client.query<{
    max_outlets: number | null;
    max_devices: number | null;
    max_users: number | null;
    max_products: number | null;
  }>(
    'SELECT max_outlets, max_devices, max_users, max_products FROM tenant WHERE id = $1',
    [tenantId]
  );
  if (rows.length === 0) {
    throw new HttpError(404, 'TENANT_NOT_FOUND', `Tenant ${tenantId} tidak ditemukan.`);
  }
  return {
    maxOutlets: rows[0].max_outlets,
    maxDevices: rows[0].max_devices,
    maxUsers: rows[0].max_users,
    maxProducts: rows[0].max_products,
  };
}

/**
 * Menegakkan satu dimensi kuota, atau melempar `403 QUOTA_EXCEEDED`.
 *
 * `terpakai` dihitung PEMANGGIL, karena pemanggilnya adalah pemilik tabelnya.
 *
 * ⛔ **Tidak boleh dipanggil dari jalur kasir.** `research/09` § 6: tidak ada
 * kuota yang boleh menghentikan penjualan. Ada penjaga yang memindai modul
 * `ordering`, `payment`, dan `cash` untuk pemanggilan fungsi ini.
 *
 * 403, bukan 409: merchant tidak salah menyusun permintaannya — ia memang
 * tidak berhak menambah lagi pada paket yang dipegangnya.
 */
export async function assertKuota(
  client: PoolClient,
  tenantId: string,
  dimensi: DimensiKuota,
  terpakai: number,
  tambahan: number
): Promise<void> {
  const batas = await batasKuota(client, tenantId);
  const kolom: Record<DimensiKuota, number | null> = {
    outlet: batas.maxOutlets,
    device: batas.maxDevices,
    pengguna: batas.maxUsers,
    produk: batas.maxProducts,
  };

  const hasil = periksaKuota({ dimensi, terpakai, batas: kolom[dimensi], tambahan });
  if (!hasil.ok) {
    throw new HttpError(403, hasil.kode, hasil.pesan);
  }
}
