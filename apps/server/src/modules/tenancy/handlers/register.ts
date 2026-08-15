import { randomUUID } from 'node:crypto';
import type { Pool } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import { buatPemilikPertama, buatHasher } from '../../identity/index.ts';
import { recordAuditEvent } from '../../audit/index.ts';
import { periksaPassword } from '../../../../../../packages/domain/src/password.ts';
import { KUOTA_PAKET, PAKET_PENDAFTARAN } from '../../../../../../packages/domain/src/paket.ts';
import type { Hlc } from '../../../../../../packages/domain/src/hlc.ts';
import { ZONA_WAKTU } from '../../../../../../packages/domain/src/zona-waktu.ts';
import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * F5 — pendaftaran merchant mandiri. Gate `ARCH:399`: "Merchant dapat
 * mendaftar → impor → bertransaksi tanpa bantuan."
 *
 * ## ⛔ Endpoint KEDUA tanpa `X-Tenant-Id`
 *
 * Sampai sekarang webhook Midtrans adalah satu-satunya, dan alasannya berbeda:
 * Midtrans tidak tahu apa-apa soal tenant kami. Di sini alasannya lebih
 * sederhana dan lebih mutlak — **tenantnya belum ada.** Tidak ada nilai yang
 * benar untuk header itu.
 *
 * `X-Actor-Id` juga tidak diminta: aktor pertama adalah owner yang dibuat
 * request ini.
 *
 * ## Invariant #8 tidak dilonggarkan
 *
 * Seluruh penulisan terjadi di dalam `withTenantTransaction` dengan id tenant
 * yang **baru**. `SET LOCAL app.tenant_id` dijalankan dengan id yang belum
 * punya baris, lalu `tenant` — satu-satunya tabel yang dikecualikan RLS,
 * karena ia adalah akar model tenancy — ditulis di dalamnya. Setiap tabel
 * sesudahnya sudah tunduk RLS seperti endpoint lain mana pun.
 *
 * ## Satu transaksi, dan kenapa itu bukan sekadar kerapian
 *
 * Tenant yang lahir tanpa owner **tidak dapat dimasuki siapa pun selamanya**:
 * setiap endpoint lain menuntut `X-Actor-Id` yang sah, dan tidak ada jalur
 * pemulihan. Tenant yang lahir tanpa outlet tidak dapat berjualan. Keduanya
 * adalah kegagalan yang tidak menghasilkan error di mana pun — merchant hanya
 * mendapati dirinya terkunci.
 *
 * ## Batas yang dinyatakan, bukan didiamkan
 *
 * - **Tanpa rate limit dan tanpa captcha.** Ini endpoint publik yang membuat
 *   baris database. Wajib ditutup sebelum merchant berbayar pertama.
 * - **Tanpa verifikasi email.** Email owner tidak dibuktikan miliknya, dan
 *   pemulihan password belum ada sama sekali.
 * - **Idempotensi hanya dari PK `tenant.id`.** Respons yang hilang lalu
 *   diulang dengan id yang sama menjawab `409`. Diulang dengan id BARU
 *   menghasilkan tenant kedua — tidak ada `UNIQUE` lintas-tenant pada email,
 *   dan tidak dapat ada tanpa query yang melewati RLS.
 */

interface BodyDaftar {
  tenant: { id: string; name: string };
  outlet: { id: string; name: string; timezone: string; address?: string | null };
  owner: { id: string; name: string; email: string; password: string };
}

/**
 * `0002_tenancy.sql` — CHECK (timezone IN (…)).
 *
 * Daftarnya dari `packages/domain`: layar pendaftaran B-00b merender pilihan
 * dari daftar yang sama, dan dua salinan akan menyimpang tanpa error.
 */
const ZONA_SAH = new Set<string>(ZONA_WAKTU);

function pelanggaranUnik(err: unknown): boolean {
  return (err as { code?: string }).code === '23505';
}

export function createRegisterHandlers(pool: Pool, hlc: Hlc): Record<string, unknown> {
  const hasher = buatHasher();

  return {
    async registerTenant(req: FastifyRequest, reply: FastifyReply) {
      const body = req.body as BodyDaftar;

      // ⛔ Diperiksa SEBELUM transaksi dibuka, dan sebelum satu byte pun
      // di-hash. Argon2id memakan 23 ms per hash; password yang pasti ditolak
      // tidak boleh membayar biaya itu di endpoint yang tidak terautentikasi.
      const periksa = periksaPassword(body.owner.password);
      if (!periksa.ok) {
        throw new HttpError(400, periksa.kode, periksa.pesan);
      }

      // Zona waktu divalidasi di aplikasi meski CHECK constraint juga
      // menjaganya. Yang dibedakan: CHECK menjawab 500 lewat error PostgreSQL
      // yang tidak dikenal, sementara ini menjawab 400 dengan daftar nilai
      // yang sah — merchant yang salah ketik butuh tahu pilihannya.
      if (!ZONA_SAH.has(body.outlet.timezone)) {
        throw new HttpError(
          400,
          'TIMEZONE_INVALID',
          `Zona waktu harus salah satu dari: ${[...ZONA_SAH].join(', ')}.`
        );
      }

      const passwordHash = await hasher.hash(body.owner.password);
      const paket = PAKET_PENDAFTARAN;
      const kuota = KUOTA_PAKET[paket];
      const profilId = randomUUID();

      const hasil = await withTenantTransaction(pool, body.tenant.id, async (client) => {
        try {
          // `tenant` dikecualikan RLS — ia akar model tenancy, tidak ada
          // "tenant lain" untuk di-scope di dalam tabel ini. Justru itulah
          // yang membuat baris pertama dapat ditulis sama sekali.
          //
          // Kuota diambil dari paket, TIDAK dari body. Endpoint ini tidak
          // terautentikasi; paket yang dapat dipilih pemanggil berarti siapa
          // pun memberi dirinya kuota tanpa batas lewat satu field JSON.
          await client.query(
            `INSERT INTO tenant
               (id, name, plan, status, deployment_mode,
                max_outlets, max_devices, max_users, max_products)
             VALUES ($1, $2, $3, 'active', 'cloud', $4, $5, $6, $7)`,
            [
              body.tenant.id,
              body.tenant.name,
              paket,
              kuota.maxOutlets,
              kuota.maxDevices,
              kuota.maxUsers,
              kuota.maxProducts,
            ]
          );

          // `deployment_mode` selalu `cloud`. On-premise adalah roadmap
          // bersyarat (KEP-33), dan pendaftaran mandiri jelas bukan jalurnya —
          // membacanya dari body akan menjadi `if (isOnPrem)` yang menyamar
          // sebagai data (invariant #5).

          // ⛔ Profil vertikal WAJIB ada sebagai default tenant. Resolusinya
          // `COALESCE(profil_outlet, default_tenant)`; tanpa baris ini ia
          // jatuh ke nilai bawaan yang dipanggang di kode, dan merchant tidak
          // pernah dapat mengubah perilaku stok negatif dari back-office.
          //
          // `fnb` dan `takeaway`: UI vertikal retail ada di daftar "jangan
          // bangun" v1, dan segmen sasaran produk ini adalah kafe takeaway.
          await client.query(
            `INSERT INTO vertical_profile
               (id, tenant_id, name, modules_enabled, default_channel,
                allow_negative_stock, requires_barcode_flow, default_tax_type,
                is_tenant_default)
             VALUES ($1, $2, 'fnb', '[]'::jsonb, 'takeaway', true, false, 'pbjt', true)`,
            [profilId, body.tenant.id]
          );

          await client.query(
            `INSERT INTO outlet (id, tenant_id, name, address, timezone, vertical_profile_id)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              body.outlet.id,
              body.tenant.id,
              body.outlet.name,
              body.outlet.address ?? null,
              body.outlet.timezone,
              profilId,
            ]
          );

          // Invariant #4: tabel `"user"` milik modul identity.
          await buatPemilikPertama(client, {
            id: body.owner.id,
            tenantId: body.tenant.id,
            name: body.owner.name,
            email: body.owner.email,
            passwordHash,
            outletId: body.outlet.id,
          });
        } catch (err) {
          if (pelanggaranUnik(err)) {
            throw new HttpError(
              409,
              'ID_ALREADY_EXISTS',
              'Salah satu id (tenant, outlet, atau pengguna) sudah dipakai.'
            );
          }
          throw err;
        }

        // Aktornya adalah owner yang baru saja dibuat — satu-satunya orang
        // yang ada di tenant ini. `audit_event.actor_user_id` punya FK ke
        // `"user"`, jadi urutannya bukan pilihan gaya.
        await recordAuditEvent(client, {
          id: randomUUID(),
          tenantId: body.tenant.id,
          outletId: body.outlet.id,
          deviceId: null,
          actorUserId: body.owner.id,
          approverUserId: null,
          eventType: 'tenant_registered',
          entityType: 'tenant',
          entityId: body.tenant.id,
          reasonCode: null,
          reasonNote: null,
          after: { name: body.tenant.name, plan: paket, kuota, outletId: body.outlet.id },
          hlc: hlc.tick(),
        });

        return {
          tenantId: body.tenant.id,
          outletId: body.outlet.id,
          ownerId: body.owner.id,
          plan: paket,
          kuota,
        };
      });

      reply.code(201);
      return hasil;
    },
  };
}
