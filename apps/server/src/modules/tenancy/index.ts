import type { Pool, PoolClient } from '../../db.ts';
import { HttpError } from '../../http-error.ts';
import { parseRateToScaled } from '../../../../../packages/domain/src/numeric.ts';
import {
  adalahKategoriMerchant,
  type KategoriMerchant,
} from '../../../../../packages/domain/src/mdr.ts';
import type { Hlc } from '../../../../../packages/domain/src/hlc.ts';
import { createRegisterHandlers } from './handlers/register.ts';
import { createOutletHandlers } from './handlers/outlets.ts';
import { createUsageHandlers, createSettingsHandlers } from './handlers/usage.ts';
import { createSubscriptionHandlers } from './handlers/langganan.ts';
import type { SubscriptionProvider } from '../payment/providers/langganan.ts';

// Penegakan kuota. Implementasinya di `./kuota.ts` supaya handler di dalam
// modul ini dapat memakainya tanpa impor melingkar; ia tetap keluar lewat
// `index.ts` karena itulah satu-satunya permukaan publik bagi modul lain.
export { batasKuota, assertKuota, hitungOutlet } from './kuota.ts';

// F5 — tagihan langganan. `subscription_invoice` milik modul ini
// (`0026_subscription_invoice.sql`), jadi webhook Midtrans yang merutekan
// notifikasi langganan memanggil fungsi ini alih-alih meng-query tabelnya
// sendiri (invariant #4). `client` WAJIB dari transaksi pemanggil yang sudah
// men-`SET LOCAL app.tenant_id`, pola yang sama dengan `recordAuditEvent`.
export { terapkanStatusTagihan } from './langganan.ts';

// Permukaan publik modul tenancy (apps/server/src/modules/README.md --
// kepemilikan tabel DITEGAKKAN). Modul catalog DILARANG query `outlet`
// langsung; `price_history.outlet_id` mereferensi outlet(id) lintas modul,
// jadi validasi keberadaannya harus lewat sini.
//
// KENAPA ini perlu, bukan sekadar hiasan: FK PostgreSQL (price_history.
// outlet_id REFERENCES outlet(id)) TIDAK tunduk RLS -- referential integrity
// check Postgres berjalan dengan hak pemilik tabel yang direferensikan,
// bukan peran yang dibatasi RLS. Temuan F1 (CLAUDE.md) membuktikan ini
// empiris untuk item.category_id: createItem sempat menerima categoryId
// tenant lain dan mengembalikan 201. FK hanya membuktikan baris outlet itu
// ada di SUATU tenant, bukan tenant pemanggil.
//
// `client` WAJIB berasal dari transaksi pemanggil yang sudah men-SET LOCAL
// app.tenant_id (withTenantTransaction) -- SELECT ini baru tunduk RLS kalau
// dijalankan lewat client itu, bukan lewat `pool` mentah.
export async function assertOutletVisible(client: PoolClient, outletId: string): Promise<void> {
  const { rows } = await client.query('SELECT id FROM outlet WHERE id = $1 AND archived_at IS NULL', [outletId]);
  if (rows.length === 0) {
    throw new HttpError(404, 'OUTLET_NOT_FOUND', `Outlet ${outletId} tidak ditemukan.`);
  }
}

export interface OutletSettings {
  roundingIncrement: bigint;
  /**
   * `numeric(6,4)` berskala 10.000 — 5% = `500n`. Bukan `number`.
   *
   * Awalnya kolom ini dibaca lewat `Number()`. Itu keliru untuk alasan yang
   * sama dengan tarif pajak: ia masuk perhitungan uang (FR-C8 langkah 9,
   * `service_charge = base x service_charge_rate`), dan jalur uang tidak
   * menyentuh float. Konversinya dibagi lewat `packages/domain/src/numeric.ts`
   * supaya tenancy dan payment tidak punya dua salinan aturan yang sama.
   */
  serviceChargeRateScaled: bigint;
  /**
   * `outlet.rounding_mode`: `half_up` | `up` | `down`.
   *
   * Diteruskan apa adanya ke `computeCashRounding`, yang MENOLAK nilai tak
   * dikenal alih-alih diam-diam jatuh ke `half_up` — outlet yang salah
   * konfigurasi akan menagih berbeda dari yang diharapkan merchant.
   */
  roundingMode: string;
}

// T3 (PLAN-ordering-fondasi.md) -- dipakai modul ordering di jalur createOrder
// SEBAGAI PENGGANTI assertOutletVisible: ordering butuh rounding_increment
// (packages/domain/src/money.ts:computeOrderTotals) di transaksi yang sama
// tempat ia sudah harus membuktikan outlet ada dan milik tenant pemanggil --
// jadi satu SELECT yang tunduk RLS ini menjawab keduanya sekaligus, alih-alih
// assertOutletVisible lalu SELECT kedua untuk kolomnya.
//
// `rounding_increment` bertipe `int` di skema (db/migrations/0002_tenancy.sql)
// -- pg mengembalikannya sebagai JS number, aman di-BigInt() langsung.
// `service_charge_rate` bertipe `numeric(6,4)` -- pg mengembalikannya sebagai
// string berpresisi penuh, dan diubah lewat parseRateToScaled, bukan Number().
export async function getOutletSettings(client: PoolClient, outletId: string): Promise<OutletSettings> {
  const { rows } = await client.query<{ rounding_increment: number; rounding_mode: string; service_charge_rate: string }>(
    'SELECT rounding_increment, rounding_mode, service_charge_rate FROM outlet WHERE id = $1 AND archived_at IS NULL',
    [outletId]
  );
  if (rows.length === 0) {
    throw new HttpError(404, 'OUTLET_NOT_FOUND', `Outlet ${outletId} tidak ditemukan.`);
  }
  return {
    roundingIncrement: BigInt(rows[0].rounding_increment),
    serviceChargeRateScaled: parseRateToScaled(rows[0].service_charge_rate),
    roundingMode: rows[0].rounding_mode,
  };
}

/**
 * FR-C12 — kategori merchant, untuk memperkirakan potongan MDR.
 *
 * `tenant` milik modul ini (`modules/README.md`), jadi modul `payment` yang
 * membutuhkannya memanggil lewat sini alih-alih meng-query tabelnya sendiri
 * (invariant #4).
 *
 * ⛔ Nilai tak dikenal jatuh ke `umi`, TIDAK melempar. Kolomnya punya CHECK
 * constraint dan bawaan, jadi nilai asing praktis mustahil — tapi kalau ia
 * tetap terjadi, jalur yang benar bukan menggagalkan pembayaran. Perkiraan
 * MDR adalah angka pelengkap; menolak penjualan karena kategori merchant
 * tidak terbaca melanggar `research/09:213` (*"penjualan tidak pernah boleh
 * dihentikan"*) untuk sesuatu yang bahkan tidak menyentuh total.
 *
 * `client` WAJIB dari transaksi pemanggil yang sudah men-`SET LOCAL
 * app.tenant_id` — pola yang sama dengan `assertOutletVisible`.
 */
export async function getMerchantCategory(client: PoolClient): Promise<KategoriMerchant> {
  const { rows } = await client.query<{ merchant_category: string }>(
    'SELECT merchant_category FROM tenant LIMIT 1'
  );
  const nilai = rows[0]?.merchant_category;
  return adalahKategoriMerchant(nilai) ? nilai : 'umi';
}

/**
 * F5 — pendaftaran merchant mandiri (`POST /tenants`).
 *
 * Modul ini tidak punya endpoint sama sekali sebelum ini; ia hidup hanya
 * sebagai guard lintas modul. `tenant`, `outlet`, dan `vertical_profile`
 * miliknya, jadi di sinilah pendaftaran berada.
 */
export function createTenancyHandlers(
  pool: Pool,
  hlc: Hlc,
  subscriptionProvider: SubscriptionProvider
): Record<string, unknown> {
  return {
    ...createRegisterHandlers(pool, hlc),
    ...createOutletHandlers(pool, hlc),
    ...createUsageHandlers(pool),
    ...createSettingsHandlers(pool),
    ...createSubscriptionHandlers(pool, hlc, subscriptionProvider),
  };
}
