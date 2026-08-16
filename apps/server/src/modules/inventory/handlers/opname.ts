import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import { getActorId, getTenantId } from '../../../tenant-context.ts';
import type { Hlc } from '../../../../../../packages/domain/src/hlc.ts';
import { assertUserVisible, assertBoleh } from '../../identity/index.ts';
import { assertOutletVisible } from '../../tenancy/index.ts';
import { recordStockMovements } from './pergerakan.ts';

/**
 * B-14 — Stock opname (FR-E7).
 *
 * ## ⛔ Selisih dihitung terhadap SNAPSHOT WAKTU T, bukan stok saat menyimpan
 *
 * Ini aturan yang menentukan seluruh bentuk berkas ini, dan ia adalah AC
 * eksplisit `spec-e` FR-E7: *"Selisih dihitung terhadap snapshot waktu T,
 * bukan stok saat penyimpanan"*, dengan aturan pendamping *"Penjualan tetap
 * berjalan selama opname. Movement setelah waktu T tidak memengaruhi
 * perhitungan selisih."*
 *
 * Kalau selisih dihitung terhadap stok SAAT PENYELESAIAN, setiap penjualan
 * yang terjadi selama petugas menghitung akan **terhapus**: sistem dipaksa
 * sama dengan angka fisik yang dihitung sebelum penjualan itu terjadi, dan
 * barang yang benar-benar keluar dari rak kembali muncul di catatan.
 *
 * Contohnya konkret. Stok sistem 10, petugas menghitung fisik 8 (selisih −2,
 * susut). Sambil menghitung, 3 terjual — sistem kini 7. Kalau `delta` dihitung
 * `8 − 7 = +1`, opname MENAMBAH satu barang yang tidak ada. Yang benar
 * `8 − 10 = −2`, dan stok akhir menjadi `7 − 2 = 5`: benar, karena 8 yang
 * dihitung dikurangi 3 yang terjual sesudahnya.
 *
 * `expected_qty` karena itu dibekukan saat baris disimpan, dihitung dari
 * movement ber-`occurred_at <= snapshot_at`.
 *
 * ## ⛔ Tipe movementnya `stocktake`, BUKAN `adjustment`
 *
 * `spec-e` FR-E2 memberi keduanya baris tersendiri, dan FR-E7 menyebut
 * `type='stocktake'` secara eksplisit. Bedanya bukan kosmetik: `adjustment`
 * **wajib** `reason_code` (AC FR-E2), sementara hasil opname tidak selalu
 * punya satu — selisihnya justru yang sedang dicari sebabnya. Memakai
 * `adjustment` berarti memaksa petugas mengarang alasan untuk setiap baris,
 * atau melonggarkan aturan alasan yang ada untuk melindungi koreksi manual.
 */

interface BarisOpname {
  id: string;
  outlet_id: string;
  status: string;
  snapshot_at: Date | string | null;
  started_by: string;
  approved_by: string | null;
}

const teks = (v: unknown): string => String(v ?? 0);
const keIso = (v: Date | string | null): string | null =>
  v === null ? null : v instanceof Date ? v.toISOString() : String(v);

/**
 * Saldo variation PADA WAKTU T.
 *
 * ⛔ `occurred_at <= $3`, bukan seluruh movement. Itu satu klausa yang
 * memisahkan opname yang benar dari opname yang menghapus penjualan.
 */
async function saldoPadaT(
  client: PoolClient,
  outletId: string,
  variationId: string,
  snapshotAt: string
): Promise<bigint> {
  const { rows } = await client.query<{ saldo: string }>(
    `SELECT COALESCE(SUM(delta), 0)::text AS saldo
       FROM stock_movement
      WHERE outlet_id = $1 AND variation_id = $2 AND occurred_at <= $3::timestamptz`,
    [outletId, variationId, snapshotAt]
  );
  return BigInt(rows[0]?.saldo ?? '0');
}

async function ambilOpname(client: PoolClient, id: string): Promise<BarisOpname | null> {
  const { rows } = await client.query<BarisOpname>(
    `SELECT id, outlet_id, status, snapshot_at, started_by, approved_by
       FROM stocktake WHERE id = $1 FOR UPDATE`,
    [id]
  );
  return rows[0] ?? null;
}

function assertKuantitas(nilai: unknown, nama: string): bigint {
  if (nilai === undefined || nilai === null || nilai === '') {
    throw new HttpError(400, 'VALIDATION_ERROR', `${nama} wajib diisi (kuantitas ×1000).`);
  }
  let n: bigint;
  try {
    n = typeof nilai === 'bigint' ? nilai : BigInt(String(nilai).trim());
  } catch {
    throw new HttpError(400, 'VALIDATION_ERROR', `${nama} harus bilangan bulat (kuantitas ×1000).`);
  }
  if (n < 0n) {
    // Hitungan fisik tidak dapat negatif — rak tidak dapat berisi barang minus.
    // Selisihnya boleh; yang dihitung tidak.
    throw new HttpError(400, 'VALIDATION_ERROR', `${nama} tidak boleh negatif.`);
  }
  return n;
}

export function createOpnameHandlers(pool: Pool, hlc: Hlc): Record<string, unknown> {
  return {
    /** Memulai opname. Waktu T dibekukan DI SINI. */
    async createStocktake(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const body = (req.body ?? {}) as { id?: string; outletId?: string };

      if (typeof body.outletId !== 'string' || body.outletId === '') {
        throw new HttpError(400, 'VALIDATION_ERROR', 'outletId wajib diisi.');
      }
      const id = typeof body.id === 'string' && body.id !== '' ? body.id : randomUUID();

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        await assertBoleh(client, actorId, 'stock_adjust', 'memulai opname');
        await assertOutletVisible(client, body.outletId as string);

        // ⛔ `snapshot_at` diisi jam DATABASE, dan ia adalah waktu T untuk
        // seluruh opname ini. Diisi dari Node, ia akan menyimpang dari
        // `occurred_at` movement yang dibandingkan dengannya — dan skew
        // beberapa milidetik cukup untuk memasukkan atau mengeluarkan satu
        // penjualan dari perhitungan.
        const { rows } = await client.query<{ snapshot_at: string }>(
          `INSERT INTO stocktake (id, tenant_id, outlet_id, status, snapshot_at, started_by)
           VALUES ($1, $2, $3, 'counting', now(), $4)
           RETURNING snapshot_at::text`,
          [id, tenantId, body.outletId, actorId]
        );

        reply.code(201);
        return {
          id,
          outletId: body.outletId,
          status: 'counting',
          snapshotAt: rows[0].snapshot_at,
          startedBy: actorId,
        };
      });
    },

    /** Menyimpan hitungan fisik. Dapat dipanggil berulang (opname dijeda). */
    async saveStocktakeLines(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const { stocktakeId } = req.params as { stocktakeId: string };
      const body = (req.body ?? {}) as {
        lines?: { variationId?: string; countedQty?: string | number; reasonCode?: string | null }[];
      };

      const lines = body.lines;
      if (!Array.isArray(lines) || lines.length === 0) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'lines wajib berisi minimal satu baris.');
      }

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        await assertBoleh(client, actorId, 'stock_adjust', 'menyimpan hitungan opname');

        const opname = await ambilOpname(client, stocktakeId);
        if (opname === null) {
          throw new HttpError(404, 'NOT_FOUND', `Opname ${stocktakeId} tidak ditemukan.`);
        }
        if (opname.status === 'approved') {
          throw new HttpError(
            409,
            'STOCKTAKE_ALREADY_APPROVED',
            `Opname ${stocktakeId} sudah diselesaikan dan tidak dapat diubah.`
          );
        }
        const snapshotAt = keIso(opname.snapshot_at);
        if (snapshotAt === null) {
          throw new Error(`Opname ${stocktakeId} tidak punya snapshot_at.`);
        }

        const hasil: { variationId: string; expectedQty: string; countedQty: string }[] = [];
        for (const l of lines) {
          if (typeof l.variationId !== 'string' || l.variationId === '') {
            throw new HttpError(400, 'VALIDATION_ERROR', 'Setiap baris wajib menyebut variationId.');
          }
          const counted = assertKuantitas(l.countedQty, 'countedQty');

          // ⛔ Divalidasi lewat SELECT yang tunduk RLS. `stocktake_line.
          // variation_id` tidak punya FK sama sekali — sama seperti
          // `stock_movement.variation_id` — jadi tidak ada apa pun di database
          // yang menolak id karangan, apalagi id milik tenant lain.
          const { rows: adaVar } = await client.query(
            'SELECT 1 FROM item_variation WHERE id = $1',
            [l.variationId]
          );
          if (adaVar.length === 0) {
            throw new HttpError(404, 'NOT_FOUND', `Variation ${l.variationId} tidak ditemukan.`);
          }

          const expected = await saldoPadaT(client, opname.outlet_id, l.variationId, snapshotAt);

          // `expected_qty` tidak ikut di-`UPDATE` oleh klausa di bawah.
          //
          // ⛔ Itu pertahanan berlapis, BUKAN yang menjaga waktu T — dan
          // klaim sebaliknya sempat ada di sini sampai sabotase
          // membuktikannya salah. Yang membekukan T adalah
          // `occurred_at <= snapshot_at` di `saldoPadaT`: menghitung ulang
          // `expected_qty` kapan pun menghasilkan angka yang SAMA, karena
          // penyaringnya tidak bergerak.
          //
          // Ia tetap ditulis begini karena menghitung ulang nilai yang sudah
          // dibekukan tidak membeli apa pun, dan kolom yang tidak pernah
          // berubah lebih mudah dipercaya saat dibaca dari database.
          await client.query(
            `INSERT INTO stocktake_line (id, tenant_id, stocktake_id, variation_id, expected_qty, counted_qty, reason_code)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (stocktake_id, variation_id)
             DO UPDATE SET counted_qty = EXCLUDED.counted_qty,
                           reason_code = EXCLUDED.reason_code`,
            [
              randomUUID(), tenantId, stocktakeId, l.variationId,
              expected.toString(), counted.toString(),
              typeof l.reasonCode === 'string' && l.reasonCode.trim() !== ''
                ? l.reasonCode.trim()
                : null,
            ]
          );

          hasil.push({
            variationId: l.variationId,
            expectedQty: expected.toString(),
            countedQty: counted.toString(),
          });
        }

        return { id: stocktakeId, status: opname.status, lines: hasil };
      });
    },

    /** Menyelesaikan opname — di sinilah movement lahir. */
    async completeStocktake(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const { stocktakeId } = req.params as { stocktakeId: string };

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        // `spec-e` FR-E7: "Manajer menyetujui".
        await assertBoleh(client, actorId, 'stock_adjust', 'menyelesaikan opname');

        const opname = await ambilOpname(client, stocktakeId);
        if (opname === null) {
          throw new HttpError(404, 'NOT_FOUND', `Opname ${stocktakeId} tidak ditemukan.`);
        }
        if (opname.status === 'approved') {
          throw new HttpError(
            409,
            'STOCKTAKE_ALREADY_APPROVED',
            `Opname ${stocktakeId} sudah diselesaikan.`
          );
        }

        const { rows: lines } = await client.query<{
          variation_id: string;
          expected_qty: string;
          counted_qty: string | null;
          reason_code: string | null;
        }>(
          `SELECT variation_id, expected_qty::text, counted_qty::text, reason_code
             FROM stocktake_line
            WHERE stocktake_id = $1 AND counted_qty IS NOT NULL
            ORDER BY variation_id`,
          [stocktakeId]
        );

        const movements = [];
        let jumlahBerselisih = 0;
        for (const l of lines) {
          // ⛔ SNAPSHOT, bukan stok sekarang. Lihat catatan kepala berkas.
          const delta = BigInt(teks(l.counted_qty)) - BigInt(l.expected_qty);
          if (delta === 0n) continue; // Baris yang cocok tidak menghasilkan movement.
          jumlahBerselisih += 1;
          movements.push({
            id: randomUUID(),
            tenantId,
            outletId: opname.outlet_id,
            deviceId: null,
            variationId: l.variation_id,
            type: 'stocktake' as const,
            delta,
            orderId: null,
            stocktakeId,
            reasonCode: l.reason_code,
            note: null,
            createdBy: actorId,
            hlc: hlc.tick(),
          });
        }

        // ⛔ Movement dan penutupan opname di transaksi yang SAMA. Opname yang
        // tertutup tanpa movementnya adalah selisih yang hilang tanpa jejak,
        // dan movement tanpa penutupannya dapat ditulis dua kali.
        if (movements.length > 0) await recordStockMovements(client, movements);

        const { rows: hasil } = await client.query<{ snapshot_at: string }>(
          `UPDATE stocktake SET status = 'approved', approved_by = $1
            WHERE id = $2
        RETURNING snapshot_at::text`,
          [actorId, stocktakeId]
        );

        return {
          id: stocktakeId,
          status: 'approved',
          snapshotAt: hasil[0]?.snapshot_at ?? null,
          approvedBy: actorId,
          jumlahBaris: lines.length,
          jumlahBerselisih,
          movementDitulis: movements.length,
        };
      });
    },

    /** Riwayat opname + rincian barisnya. */
    async listStocktakes(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const q = req.query as { outlet_id?: string };
      const outletId = q.outlet_id === undefined || q.outlet_id === '' ? null : q.outlet_id;

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        if (outletId !== null) await assertOutletVisible(client, outletId);

        const { rows } = await client.query(
          `SELECT s.id, s.outlet_id, s.status, s.snapshot_at, s.started_by, s.approved_by,
                  us.name AS started_by_nama, ua.name AS approved_by_nama,
                  count(sl.*)::int AS jumlah_baris,
                  count(sl.*) FILTER (WHERE sl.counted_qty IS NOT NULL)::int AS jumlah_dihitung,
                  count(sl.*) FILTER (
                    WHERE sl.counted_qty IS NOT NULL AND sl.counted_qty <> sl.expected_qty
                  )::int AS jumlah_berselisih
             FROM stocktake s
             LEFT JOIN "user" us          ON us.id = s.started_by
             LEFT JOIN "user" ua          ON ua.id = s.approved_by
             LEFT JOIN stocktake_line sl  ON sl.stocktake_id = s.id
            WHERE ($1::text IS NULL OR s.outlet_id = $1)
            GROUP BY s.id, s.outlet_id, s.status, s.snapshot_at, s.started_by,
                     s.approved_by, us.name, ua.name
            ORDER BY s.snapshot_at DESC NULLS LAST, s.id DESC`,
          [outletId]
        );

        return {
          outletId,
          items: rows.map((r) => ({
            id: r.id as string,
            outletId: r.outlet_id as string,
            status: r.status as string,
            snapshotAt: keIso(r.snapshot_at as Date | null),
            startedBy: r.started_by as string,
            startedByNama: (r.started_by_nama as string | null) ?? (r.started_by as string),
            approvedBy: (r.approved_by as string | null) ?? null,
            approvedByNama:
              r.approved_by === null
                ? null
                : ((r.approved_by_nama as string | null) ?? (r.approved_by as string)),
            jumlahBaris: Number(r.jumlah_baris),
            jumlahDihitung: Number(r.jumlah_dihitung),
            jumlahBerselisih: Number(r.jumlah_berselisih),
          })),
        };
      });
    },

    /** Rincian satu opname, beserta selisih per baris. */
    async getStocktake(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const { stocktakeId } = req.params as { stocktakeId: string };

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);

        const { rows: kepala } = await client.query<BarisOpname & {
          started_by_nama: string | null;
          approved_by_nama: string | null;
        }>(
          `SELECT s.id, s.outlet_id, s.status, s.snapshot_at, s.started_by, s.approved_by,
                  us.name AS started_by_nama, ua.name AS approved_by_nama
             FROM stocktake s
             LEFT JOIN "user" us ON us.id = s.started_by
             LEFT JOIN "user" ua ON ua.id = s.approved_by
            WHERE s.id = $1`,
          [stocktakeId]
        );
        if (kepala.length === 0) {
          throw new HttpError(404, 'NOT_FOUND', `Opname ${stocktakeId} tidak ditemukan.`);
        }
        const s = kepala[0];

        const { rows: lines } = await client.query(
          `SELECT sl.variation_id, sl.expected_qty::text, sl.counted_qty::text, sl.reason_code,
                  iv.name AS variation_name, i.name AS item_name
             FROM stocktake_line sl
             LEFT JOIN item_variation iv ON iv.id = sl.variation_id
             LEFT JOIN item i            ON i.id = iv.item_id
            WHERE sl.stocktake_id = $1
            ORDER BY i.name, iv.name, sl.variation_id`,
          [stocktakeId]
        );

        return {
          id: s.id,
          outletId: s.outlet_id,
          status: s.status,
          snapshotAt: keIso(s.snapshot_at),
          startedBy: s.started_by,
          startedByNama: s.started_by_nama ?? s.started_by,
          approvedBy: s.approved_by,
          approvedByNama:
            s.approved_by === null ? null : (s.approved_by_nama ?? s.approved_by),
          lines: lines.map((l) => {
            const expected = BigInt(teks(l.expected_qty));
            const counted = l.counted_qty === null ? null : BigInt(teks(l.counted_qty));
            return {
              variationId: l.variation_id as string,
              itemName: (l.item_name as string | null) ?? (l.variation_id as string),
              variationName: (l.variation_name as string | null) ?? '—',
              expectedQty: expected.toString(),
              // `null` DIPERTAHANKAN: baris yang belum dihitung bukan baris
              // yang dihitung nol.
              countedQty: counted === null ? null : counted.toString(),
              selisih: counted === null ? null : (counted - expected).toString(),
              reasonCode: (l.reason_code as string | null) ?? null,
            };
          }),
        };
      });
    },
  };
}
