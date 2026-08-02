import type { Pool, PoolClient } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import { getTenantId, getActorId } from '../../../tenant-context.ts';
import { assertOutletVisible } from '../../tenancy/index.ts';
import { assertUserVisible, assertDeviceVisible } from '../../identity/index.ts';
import { isPrimaryKeyViolation } from './pg-error.ts';
import type { FastifyRequest, FastifyReply } from 'fastify';

// T0c (PLAN-ordering-fondasi.md §T0c, keputusan Q1 §8.0) -- POST /shifts,
// irisan minimal modul cash: BUKA shift saja. Tutup shift, hitung kas,
// selisih, cash_movement, no-sale tetap F3 (§4 non-scope plan).

interface ShiftRow {
  id: string;
  outlet_id: string;
  device_id: string;
  business_date: string;
  status: string;
  opening_float: string; // bigint comes back as string from node-postgres
  opened_by: string;
  opened_at: string;
}

interface ShiftInput {
  id: string;
  outletId: string;
  deviceId: string;
  businessDate: string;
  openingFloat: unknown;
}

function toShift(row: ShiftRow) {
  return {
    id: row.id,
    outletId: row.outlet_id,
    deviceId: row.device_id,
    businessDate: row.business_date,
    status: row.status,
    openingFloat: Number(row.opening_float),
    openedBy: row.opened_by,
    openedAt: row.opened_at,
  };
}

// Sama seperti assertPriceValid di catalog/handlers/prices.ts -- uang =
// bigint rupiah utuh, tidak pernah float (CLAUDE.md konvensi data). typeof
// dan Number.isInteger dicek eksplisit (bukan hanya `< 0`) supaya string,
// float pecahan, null, dan NaN/Infinity semuanya ditolak. openingFloat = 0
// legal -- kas kosong di awal shift bukan error.
function assertOpeningFloatValid(value: unknown): asserts value is number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > Number.MAX_SAFE_INTEGER
  ) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'openingFloat harus bilangan bulat rupiah >= 0 dan tidak melebihi Number.MAX_SAFE_INTEGER.'
    );
  }
}

// Try-INSERT-dulu, BUKAN pre-check SELECT "device ini sudah punya shift
// open?" lalu INSERT. Alasannya sama persis dengan
// modules/identity/handlers/devices.ts: retry offline mengirim id yang
// SAMA PERSIS setelah respons pertama hilang -- kalau pre-check
// "device sudah punya shift open?" jalan lebih dulu, request kedua akan
// menabrak shift-nya SENDIRI (yang barusan berhasil dibuat request
// pertama) dan salah dilaporkan SHIFT_ALREADY_OPEN, padahal seharusnya
// ID_ALREADY_EXISTS. ux_shift_one_open_per_device (partial unique index,
// db/migrations/0006_cash_shift_open.sql:27) SUDAH ADA di skema sejak F0 --
// ditegakkan di sini dengan menerjemahkan pelanggarannya jadi 409 yang
// bersih, bukan 500 mentah. Postgres mengecek index PK (dibuat inline di
// CREATE TABLE, oid lebih kecil) sebelum ux_shift_one_open_per_device
// (CREATE UNIQUE INDEX belakangan, oid lebih besar) untuk INSERT yang
// menabrak keduanya sekaligus -- jadi retry id sama selalu jatuh ke cabang
// isPrimaryKeyViolation di bawah, bukan cabang SHIFT_ALREADY_OPEN.
async function insertShift(
  client: PoolClient,
  tenantId: string,
  actorId: string,
  input: ShiftInput
): Promise<ShiftRow> {
  try {
    const { rows } = await client.query<ShiftRow>(
      `INSERT INTO cash_drawer_shift (id, tenant_id, outlet_id, device_id, business_date, status, opening_float, opened_by)
       VALUES ($1, $2, $3, $4, $5, 'open', $6, $7)
       RETURNING *`,
      [input.id, tenantId, input.outletId, input.deviceId, input.businessDate, input.openingFloat, actorId]
    );
    return rows[0];
  } catch (err) {
    if (isPrimaryKeyViolation(err)) {
      throw new HttpError(409, 'ID_ALREADY_EXISTS', `Shift dengan id ${input.id} sudah ada.`);
    }
    const pgErr = err as { code?: string; constraint?: string };
    if (pgErr.code === '23505' && pgErr.constraint === 'ux_shift_one_open_per_device') {
      throw new HttpError(409, 'SHIFT_ALREADY_OPEN', `Device ${input.deviceId} sudah punya shift yang masih terbuka.`);
    }
    throw err;
  }
}

export function createShiftHandlers(pool: Pool) {
  return {
    async openShift(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const body = req.body as ShiftInput;
      assertOpeningFloatValid(body.openingFloat);
      const row = await withTenantTransaction(pool, tenantId, async (client) => {
        // Tiga guard FK klien-suplai (brief §"Guard wajib"), sama alasan
        // dengan createPrice di catalog/handlers/prices.ts: FK PostgreSQL
        // tidak tunduk RLS (temuan F1, CLAUDE.md), jadi keberadaan &
        // kepemilikan tenant HARUS dibuktikan lewat SELECT yang tunduk RLS
        // di transaksi ini SEBELUM INSERT, bukan diserahkan ke FK.
        await assertOutletVisible(client, body.outletId);
        await assertDeviceVisible(client, body.deviceId);
        await assertUserVisible(client, actorId);
        return insertShift(client, tenantId, actorId, body);
      });
      reply.code(201);
      return toShift(row);
    },
  };
}
