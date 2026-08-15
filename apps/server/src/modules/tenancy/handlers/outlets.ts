import { randomUUID } from 'node:crypto';
import type { Pool } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import { getTenantId, getActorId } from '../../../tenant-context.ts';
import { assertUserVisible, assertBoleh } from '../../identity/index.ts';
import { recordAuditEvent } from '../../audit/index.ts';
import { assertKuota, hitungOutlet } from '../kuota.ts';
import type { Hlc } from '../../../../../../packages/domain/src/hlc.ts';
import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * `POST /outlets` — outlet kedua dan seterusnya.
 *
 * Outlet PERTAMA lahir bersama tenant di `POST /tenants`; sebuah tenant tanpa
 * outlet tidak dapat berjualan sama sekali, jadi ia tidak pernah ada sebagai
 * keadaan yang sah.
 *
 * ## Titik penegakan `max_outlets` (`research/09` § 6)
 *
 * Ini satu dari empat tempat kuota ditegakkan, dan seluruhnya adalah operasi
 * **administratif**. Tidak satu pun ada di jalur kasir.
 *
 * ## Owner-only, dan itu dari spec
 *
 * `spec-f:29` memberi Owner "membuat outlet"; `spec-f:30` menaruhnya di kolom
 * yang TIDAK BOLEH milik Manajer Area. Ditegakkan lewat `assertBoleh(…,
 * 'outlet_manage')`, bukan lewat perbandingan nama peran di handler.
 */

interface BodyOutlet {
  id: string;
  name: string;
  timezone: string;
  address?: string | null;
  verticalProfileId?: string | null;
}

/** `0002_tenancy.sql` — CHECK (timezone IN (…)). */
const ZONA_SAH = new Set(['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura']);

export function createOutletHandlers(pool: Pool, hlc: Hlc): Record<string, unknown> {
  return {
    async createOutlet(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const body = req.body as BodyOutlet;

      if (!ZONA_SAH.has(body.timezone)) {
        throw new HttpError(
          400,
          'TIMEZONE_INVALID',
          `Zona waktu harus salah satu dari: ${[...ZONA_SAH].join(', ')}.`
        );
      }

      const hasil = await withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        await assertBoleh(client, actorId, 'outlet_manage', 'mengelola outlet');

        await assertKuota(client, tenantId, 'outlet', await hitungOutlet(client), 1);

        // FK klien-suplai ke tabel ber-tenant_id. Temuan F1: FK PostgreSQL
        // tidak tunduk RLS — ia hanya membuktikan baris itu ada di SUATU
        // tenant. Profil vertikal milik merchant lain akan menentukan
        // perilaku stok negatif outlet ini.
        if (body.verticalProfileId) {
          const { rows } = await client.query('SELECT id FROM vertical_profile WHERE id = $1', [
            body.verticalProfileId,
          ]);
          if (rows.length === 0) {
            throw new HttpError(
              404,
              'VERTICAL_PROFILE_NOT_FOUND',
              `Profil vertikal ${body.verticalProfileId} tidak ditemukan.`
            );
          }
        }

        try {
          await client.query(
            `INSERT INTO outlet (id, tenant_id, name, address, timezone, vertical_profile_id)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              body.id,
              tenantId,
              body.name,
              body.address ?? null,
              body.timezone,
              // `null` berarti "warisi default tenant" — resolusinya
              // `COALESCE(profil_outlet, default_tenant)`, dan itu keputusan
              // OQ-09. Outlet baru yang tidak menyebut profil mengikuti pusat.
              body.verticalProfileId ?? null,
            ]
          );
        } catch (err) {
          if ((err as { code?: string }).code === '23505') {
            throw new HttpError(409, 'ID_ALREADY_EXISTS', `Outlet ${body.id} sudah ada.`);
          }
          throw err;
        }

        await recordAuditEvent(client, {
          id: randomUUID(),
          tenantId,
          outletId: body.id,
          deviceId: null,
          actorUserId: actorId,
          approverUserId: null,
          eventType: 'outlet_created',
          entityType: 'outlet',
          entityId: body.id,
          reasonCode: null,
          reasonNote: null,
          after: { name: body.name, timezone: body.timezone },
          hlc: hlc.tick(),
        });

        return { id: body.id, name: body.name, timezone: body.timezone };
      });

      reply.code(201);
      return hasil;
    },
  };
}
