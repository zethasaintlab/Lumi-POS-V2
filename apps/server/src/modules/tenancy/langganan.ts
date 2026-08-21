import { randomUUID } from 'node:crypto';
import type { PoolClient } from '../../db.ts';
import { HttpError } from '../../http-error.ts';
import { recordAuditEvent } from '../audit/index.ts';
import {
  KUOTA_PAKET,
  type NamaPaket,
} from '../../../../../packages/domain/src/paket.ts';
import type { GatewayStatus } from '../payment/providers/langganan.ts';

/**
 * Tagihan langganan — tabel `subscription_invoice`, milik modul `tenancy`.
 *
 * Dipisah dari `index.ts` dengan alasan yang sama dengan `kuota.ts`: handler
 * DI DALAM modul ini memakainya, dan `index.ts` tetap satu-satunya permukaan
 * publik bagi modul lain (invariant #4).
 *
 * ## ⛔ Kenapa modul `payment` tidak memiliki tabel ini
 *
 * `payment` punya empat kolom NOT NULL yang tagihan langganan tidak punya:
 * `order_id`, `outlet_id`, `device_id`, `check_id`. Kalau keempatnya
 * nullable, jalan termudah adalah menulis tagihan langganan sebagai
 * `payment` — dan akibatnya `posisi-penjualan.ts` serta B-19 akan menampilkan
 * **biaya langganan merchant sebagai omzet kafenya sendiri**. Cacat diam di
 * jalur uang.
 */

export interface TagihanRow {
  id: string;
  tenant_id: string;
  plan: string;
  outlet_count: number;
  unit_price: string;
  amount: string;
  status: string;
  provider: string | null;
  provider_reference: string | null;
  created_at: Date;
  confirmed_at: Date | null;
  requested_by: string;
}

const KOLOM = `
  id, tenant_id, plan, outlet_count, unit_price::text AS unit_price,
  amount::text AS amount, status, provider, provider_reference,
  created_at, confirmed_at, requested_by
`;

export interface PaketTenant {
  plan: string;
  status: string;
}

/**
 * Paket tenant saat ini.
 *
 * ⛔ `WHERE id = $1` WAJIB, bukan gaya. `tenant` **dikecualikan dari RLS**
 * (ia akar model tenancy), jadi query tanpa `WHERE` mengembalikan baris
 * SETIAP merchant — alasan yang persis sama dengan `batasKuota`.
 */
export async function bacaPaketTenant(client: PoolClient, tenantId: string): Promise<PaketTenant> {
  const { rows } = await client.query<PaketTenant>(
    'SELECT plan, status FROM tenant WHERE id = $1',
    [tenantId]
  );
  if (rows.length === 0) {
    throw new HttpError(404, 'TENANT_NOT_FOUND', `Tenant ${tenantId} tidak ditemukan.`);
  }
  return rows[0];
}

export interface TagihanBaru {
  id: string;
  tenantId: string;
  plan: string;
  outletCount: number;
  unitPrice: bigint;
  amount: bigint;
  requestedBy: string;
  provider: string;
}

/**
 * Menulis tagihan `pending_confirmation`.
 *
 * Dua penolakan datang dari DATABASE, dan itu disengaja:
 *
 * - **Satu tagihan terbuka per tenant** — index unik parsial
 *   `ux_subscription_invoice_terbuka`. Idempotency-Key melindungi retry satu
 *   klien; index ini melindungi dari dua klik, dua tab, dan dua perangkat.
 * - **`amount = unit_price * outlet_count`** — CHECK tabel. Tanpa itu tagihan
 *   dapat menyebut 3 outlet × Rp349.000 lalu menagih Rp1.000.
 */
export async function buatTagihan(client: PoolClient, t: TagihanBaru): Promise<TagihanRow> {
  try {
    const { rows } = await client.query<TagihanRow>(
      `INSERT INTO subscription_invoice
         (id, tenant_id, plan, outlet_count, unit_price, amount, status, provider, requested_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending_confirmation', $7, $8)
       RETURNING ${KOLOM}`,
      [t.id, t.tenantId, t.plan, t.outletCount, t.unitPrice.toString(), t.amount.toString(), t.provider, t.requestedBy]
    );
    return rows[0];
  } catch (err) {
    const kode = (err as { code?: string; constraint?: string }).code;
    if (kode === '23505') {
      const constraint = (err as { constraint?: string }).constraint;
      if (constraint === 'ux_subscription_invoice_terbuka') {
        throw new HttpError(
          409,
          'SUBSCRIPTION_INVOICE_OPEN',
          'Masih ada tagihan langganan yang belum diselesaikan. Selesaikan atau batalkan dulu tagihan itu.'
        );
      }
      throw new HttpError(409, 'ID_ALREADY_EXISTS', `Tagihan dengan id ${t.id} sudah ada.`);
    }
    throw err;
  }
}

export async function bacaTagihan(client: PoolClient, id: string): Promise<TagihanRow | null> {
  const { rows } = await client.query<TagihanRow>(
    `SELECT ${KOLOM} FROM subscription_invoice WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

/** Riwayat tagihan tenant ini, terbaru dulu — daftar di B-29. */
export async function daftarTagihan(client: PoolClient, batas: number): Promise<TagihanRow[]> {
  const { rows } = await client.query<TagihanRow>(
    `SELECT ${KOLOM} FROM subscription_invoice ORDER BY created_at DESC, id DESC LIMIT $1`,
    [batas]
  );
  return rows;
}

export async function catatRujukanGateway(
  client: PoolClient,
  id: string,
  providerReference: string
): Promise<void> {
  // `AND provider_reference IS NULL` — retry yang sudah punya rujukan tidak
  // menimpanya. Pola yang sama dengan QRIS dinamis di modul payment.
  await client.query(
    'UPDATE subscription_invoice SET provider_reference = $2 WHERE id = $1 AND provider_reference IS NULL',
    [id, providerReference]
  );
}

/**
 * Status gateway → `subscription_invoice.status`.
 *
 * ⛔ Berbeda dari peta milik `payment`: kolom di sana tidak mengenal
 * `expired`, jadi QR kedaluwarsa disimpan sebagai `failed`. Di sini kolomnya
 * mengenalnya (`0026`), dan membedakannya berarti B-29 dapat berkata "QR
 * kedaluwarsa, minta yang baru" alih-alih "pembayaran gagal" — dua kalimat
 * yang menuntut tindakan berbeda dari merchant.
 *
 * `pending` TIDAK ada di peta, dan itu bukan kelalaian: ia berarti "belum ada
 * yang berubah", dan pemanggil memperlakukan `undefined` sebagai itu.
 * `mapGatewayStatus` mengembalikan `pending` untuk setiap kata yang tidak
 * dimengerti — tidak ada kata asing yang boleh berarti lunas (`spec-c:320`).
 */
const GATEWAY_KE_STATUS_TAGIHAN: Readonly<Record<string, string>> = {
  confirmed: 'confirmed',
  failed: 'failed',
  expired: 'expired',
};

export interface HasilTerapkan {
  tagihan: TagihanRow;
  /** `true` bila status tagihan berubah pada pemanggilan ini. */
  berubah: boolean;
  /** Paket tenant SETELAH pemanggilan ini. */
  plan: string;
}

/**
 * Menerapkan status gateway ke tagihan, dan — bila `confirmed` — menaikkan
 * paket tenant beserta keempat kolom kuotanya.
 *
 * ## ⛔ Ini SATU-SATUNYA tempat `tenant.plan` berubah
 *
 * Dan itu properti yang dijaga test: paket tidak dapat naik tanpa tagihan
 * yang dikonfirmasi gateway (`spec-c:320` — sistem tidak pernah menandai
 * lunas tanpa konfirmasi).
 *
 * ## ⛔ Kuota ikut ditulis, tidak hanya `plan`
 *
 * `batasKuota` membaca `tenant.max_*`, bukan `KUOTA_PAKET[plan]`. Menaikkan
 * `plan` tanpa kolomnya menghasilkan tenant yang **membayar paket pro dan
 * tetap ditolak pada kuota free** — tanpa satu pun error, dan setiap layar
 * "pemakaian vs kuota" menampilkan batas lama sambil menyebut paket baru.
 *
 * ## ⛔ Paket diterapkan APA ADANYA, tanpa memeriksa ulang arah
 *
 * Aman hari ini karena dua sifat yang berdiri bersama: `periksaKenaikanPaket`
 * menolak apa pun yang bukan kenaikan **saat tagihan dibuat**, dan index unik
 * parsial `ux_subscription_invoice_terbuka` membuat tidak pernah ada dua
 * tagihan terbuka sekaligus. Tidak ada jalur lain yang mengubah `plan`.
 *
 * Yang membuatnya TIDAK aman lagi: jalur kedua yang mengubah `plan`
 * (penurunan paket, pembatalan langganan, penyetelan oleh tim support). Kalau
 * itu lahir, konfirmasi harus membandingkan arah lebih dulu — kalau tidak,
 * tagihan lama yang dikonfirmasi terlambat akan **menurunkan** paket yang
 * baru saja dinaikkan, diam-diam.
 */
export async function terapkanStatusTagihan(
  client: PoolClient,
  input: { tenantId: string; invoiceId: string; gatewayStatus: GatewayStatus; hlc: bigint }
): Promise<HasilTerapkan> {
  const { rows } = await client.query<TagihanRow>(
    `SELECT ${KOLOM} FROM subscription_invoice WHERE id = $1 FOR UPDATE`,
    [input.invoiceId]
  );
  if (rows.length === 0) {
    throw new HttpError(
      404,
      'SUBSCRIPTION_INVOICE_NOT_FOUND',
      `Tagihan langganan ${input.invoiceId} tidak ditemukan.`
    );
  }
  const tagihan = rows[0];
  const paket = await bacaPaketTenant(client, input.tenantId);

  // Tagihan yang sudah final tidak berubah lagi. Midtrans mengirim ULANG
  // notifikasi yang tidak dijawab 200, jadi pengulangan adalah keadaan
  // NORMAL — dan notifikasi susulan tidak boleh membalikkan tagihan yang
  // sudah dikonfirmasi: uangnya sudah masuk.
  if (tagihan.status !== 'pending_confirmation') {
    return { tagihan, berubah: false, plan: paket.plan };
  }

  const statusBaru = GATEWAY_KE_STATUS_TAGIHAN[input.gatewayStatus];
  if (statusBaru === undefined) {
    return { tagihan, berubah: false, plan: paket.plan };
  }

  const { rows: diperbarui } = await client.query<TagihanRow>(
    `UPDATE subscription_invoice
        SET status = $2,
            confirmed_at = CASE WHEN $2 = 'confirmed' THEN now() ELSE confirmed_at END
      WHERE id = $1
      RETURNING ${KOLOM}`,
    [input.invoiceId, statusBaru]
  );

  if (statusBaru !== 'confirmed') {
    return { tagihan: diperbarui[0], berubah: true, plan: paket.plan };
  }

  const kuota = KUOTA_PAKET[tagihan.plan as NamaPaket];
  await client.query(
    `UPDATE tenant
        SET plan = $2, max_outlets = $3, max_devices = $4, max_users = $5, max_products = $6
      WHERE id = $1`,
    [input.tenantId, tagihan.plan, kuota.maxOutlets, kuota.maxDevices, kuota.maxUsers, kuota.maxProducts]
  );

  // ## ⛔ Aktor audit adalah PEMINTA, dan ia diperiksa dulu
  //
  // Webhook tidak punya aktor — Midtrans bukan pengguna. Yang benar secara
  // faktual adalah orang yang meminta kenaikan ini, dan `requested_by`
  // menyimpannya sejak tagihan dibuat.
  //
  // `recordAuditEvent` MELEMPAR bila aktornya tidak lagi aktif (FK ke
  // `"user"`, dan validasinya tunduk RLS). Di jalur webhook lemparan itu
  // berarti Midtrans menerima non-200 dan **mengirim ulang selamanya**,
  // sementara kenaikan yang sudah dibayar tidak pernah mendarat. Karena itu
  // audit ditulis hanya bila pemintanya masih aktif; catatan yang tidak
  // pernah hilang adalah baris tagihannya sendiri, yang memuat siapa,
  // kapan, paket apa, dan berapa.
  const { rows: aktif } = await client.query<{ id: string }>(
    'SELECT id FROM "user" WHERE id = $1 AND is_active = true',
    [tagihan.requested_by]
  );
  if (aktif.length > 0) {
    await recordAuditEvent(client, {
      id: randomUUID(),
      tenantId: input.tenantId,
      // Langganan bukan urusan satu outlet — ia tenant-wide.
      outletId: null,
      deviceId: null,
      actorUserId: tagihan.requested_by,
      approverUserId: null,
      eventType: 'subscription_plan_upgraded',
      entityType: 'subscription_invoice',
      entityId: tagihan.id,
      reasonCode: null,
      reasonNote: null,
      before: { plan: paket.plan },
      after: { plan: tagihan.plan, amount: tagihan.amount, outletCount: tagihan.outlet_count },
      hlc: input.hlc,
    });
  }

  return { tagihan: diperbarui[0], berubah: true, plan: tagihan.plan };
}

/** Bentuk JSON tagihan — satu tempat, dipakai ketiga endpoint. */
export function toTagihan(row: TagihanRow) {
  return {
    id: row.id,
    plan: row.plan,
    outletCount: row.outlet_count,
    // Uang dikirim sebagai `number` mengikuti seluruh permukaan API repo ini
    // (`toPayment`, laporan). Rupiah utuh; nilai tagihan langganan jauh di
    // bawah 2^53.
    unitPrice: Number(row.unit_price),
    amount: Number(row.amount),
    status: row.status,
    provider: row.provider,
    providerReference: row.provider_reference,
    createdAt: row.created_at.toISOString(),
    confirmedAt: row.confirmed_at === null ? null : row.confirmed_at.toISOString(),
    requestedBy: row.requested_by,
  };
}
