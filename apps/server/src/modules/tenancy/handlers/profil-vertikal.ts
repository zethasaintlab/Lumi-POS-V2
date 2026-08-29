import type { Pool, PoolClient } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import { getActorId, getTenantId } from '../../../tenant-context.ts';
import { assertUserVisible, assertBoleh } from '../../identity/index.ts';
import { catatPerubahanServer } from '../../audit/index.ts';
import { resolusiProfil } from '../../../../../../packages/domain/src/profil-vertikal.ts';
import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * B-24 Profil Vertikal (`IA:203`, Owner). OQ-09.
 *
 * ## ⛔ `name` TIDAK dapat diubah, dan hanya `fnb` yang dapat dibuat
 *
 * `retail` ada di CHECK constraint sejak F0 dan ditulis di `IA:291` sebagai
 * kolom v1.3. Daftar "jangan bangun" (`PRD` § 4) menaruh **UI vertikal
 * retail** di v1.1+, dan tabel `IA:293` menyebut apa yang seharusnya berbeda:
 * input barcode primer di K-03, konversi satuan di B-07, retur barang, preset
 * pajak PPN. Tidak satu pun dari itu ada.
 *
 * Merchant yang dapat menekan "retail" karena itu mendapat aplikasi kasir yang
 * dibangun untuk F&B, dengan label yang mengatakan sebaliknya — layar yang
 * menjanjikan produk yang tidak ada. Batas yang DINYATAKAN, bukan didiamkan:
 * layar menyebutkannya, dan endpoint menolaknya.
 *
 * ## ⛔ Hanya `allow_negative_stock` yang dapat disetel, dan itu disengaja
 *
 * `vertical_profile` punya enam kolom perilaku. Lima di antaranya
 * (`default_channel`, `requires_barcode_flow`, `default_tax_type`,
 * `modules_enabled`, dan `name` untuk retail) **tidak dibaca satu baris kode
 * pun** di luar pendaftaran tenant — hari ini mereka data mati.
 *
 * Membuka semuanya di layar adalah persis cacat yang B-26 ada untuk
 * menghindari: setelan yang tersimpan dengan benar, ditampilkan kembali dengan
 * benar, dan tidak mengubah apa pun. Yang dibuka adalah yang benar-benar
 * menentukan sesuatu — FR-E4, dan ia menentukannya **offline**.
 *
 * ## ⛔ Default tenant tidak dapat DIKOSONGKAN, hanya DIPINDAHKAN
 *
 * `resolusiProfil` punya bawaan keras (`allowNegativeStock: true`) untuk
 * perangkat yang katalognya belum turun. Membiarkan merchant menghapus default
 * tenantnya berarti setiap outlet ber-override NULL diam-diam jatuh ke bawaan
 * itu — aturan yang tidak seorang pun pilih, di jalur yang paling tidak
 * terlihat. Yang dapat dilakukan adalah memindahkannya ke profil lain.
 */

interface BarisProfil {
  id: string;
  name: string;
  allow_negative_stock: boolean;
  is_tenant_default: boolean;
}

const bentuk = (r: BarisProfil) => ({
  id: r.id,
  name: r.name,
  allowNegativeStock: r.allow_negative_stock,
  isTenantDefault: r.is_tenant_default,
});

async function ambilProfil(client: PoolClient, id: string): Promise<BarisProfil> {
  const { rows } = await client.query<BarisProfil>(
    'SELECT id, name, allow_negative_stock, is_tenant_default FROM vertical_profile WHERE id = $1',
    [id]
  );
  if (rows.length === 0) {
    throw new HttpError(404, 'VERTICAL_PROFILE_NOT_FOUND', `Profil vertikal ${id} tidak ditemukan.`);
  }
  return rows[0];
}

export function createVerticalProfileHandlers(pool: Pool): Record<string, unknown> {
  return {
    /**
     * `GET /vertical-profiles` — profil tenant ini beserta resolusi per outlet.
     *
     * ⛔ Resolusinya ikut dihitung DI SINI, lewat `resolusiProfil` yang sama
     * yang perangkat pakai. Layar yang menghitungnya sendiri adalah tempat
     * kedua yang memutuskan "profil mana yang berlaku di cabang ini", dan yang
     * menyimpang menampilkan aturan yang berbeda dari yang kasirnya alami.
     */
    async listVerticalProfiles(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);

        const { rows: profil } = await client.query<BarisProfil>(
          `SELECT id, name, allow_negative_stock, is_tenant_default
             FROM vertical_profile ORDER BY is_tenant_default DESC, id`
        );
        const { rows: outlet } = await client.query<{
          id: string;
          name: string;
          vertical_profile_id: string | null;
        }>(
          `SELECT id, name, vertical_profile_id FROM outlet
            WHERE archived_at IS NULL ORDER BY name`
        );

        const bawaanTenant = profil.find((p) => p.is_tenant_default) ?? null;
        return {
          profiles: profil.map(bentuk),
          outlets: outlet.map((o) => {
            const sendiri = profil.find((p) => p.id === o.vertical_profile_id) ?? null;
            const berlaku = resolusiProfil({
              profilOutlet: sendiri === null ? null : bentuk(sendiri),
              profilDefaultTenant: bawaanTenant === null ? null : bentuk(bawaanTenant),
            });
            return {
              id: o.id,
              name: o.name,
              /** `null` berarti "ikut default tenant". */
              verticalProfileId: o.vertical_profile_id,
              berlaku,
            };
          }),
        };
      });
    },

    async createVerticalProfile(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const body = req.body as {
        id: string;
        name?: string;
        allowNegativeStock?: boolean;
      };

      assertNamaSah(body.name);

      const hasil = await withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        await assertBoleh(client, actorId, 'outlet_manage', 'mengelola profil vertikal');

        try {
          await client.query(
            // ⛔ Kolom yang tidak dapat disetel diberi nilai yang SAMA dengan
            // yang `registerTenant` tulis. Membiarkannya ke `DEFAULT` kolom
            // membuat profil yang dibuat lewat layar berperilaku berbeda dari
            // profil yang lahir bersama tenant — perbedaan yang tidak terlihat
            // sampai seseorang membandingkan dua baris.
            `INSERT INTO vertical_profile
               (id, tenant_id, name, modules_enabled, default_channel,
                allow_negative_stock, requires_barcode_flow, default_tax_type)
             VALUES ($1, $2, 'fnb', '[]'::jsonb, 'takeaway', $3, false, 'pbjt')`,
            [body.id, tenantId, body.allowNegativeStock ?? true]
          );
        } catch (err) {
          if ((err as { code?: string }).code === '23505') {
            throw new HttpError(409, 'ID_ALREADY_EXISTS', `Profil ${body.id} sudah ada.`);
          }
          throw err;
        }

        const baru = await ambilProfil(client, body.id);
        await catatPerubahanServer(client, {
          tenantId,
          actorUserId: actorId,
          eventType: 'vertical_profile_changed',
          entityType: 'vertical_profile',
          entityId: body.id,
          after: bentuk(baru),
        });
        return bentuk(baru);
      });

      reply.code(201);
      return hasil;
    },

    async updateVerticalProfile(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const { profileId } = req.params as { profileId: string };
      const body = req.body as { allowNegativeStock?: boolean; isTenantDefault?: boolean };

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        await assertBoleh(client, actorId, 'outlet_manage', 'mengelola profil vertikal');

        const sebelum = await ambilProfil(client, profileId);

        // ⛔ Default tenant tidak dapat DIKOSONGKAN, hanya dipindahkan.
        // Lihat catatan kepala: outlet ber-override NULL akan jatuh ke bawaan
        // keras yang tidak seorang pun pilih.
        if (body.isTenantDefault === false && sebelum.is_tenant_default) {
          throw new HttpError(
            409,
            'DEFAULT_PROFILE_REQUIRED',
            'Tenant harus punya satu profil bawaan. Tetapkan profil lain sebagai bawaan ' +
              'terlebih dahulu — mencabutnya membuat outlet tanpa profil sendiri memakai ' +
              'aturan yang tidak dipilih siapa pun.'
          );
        }

        // ⛔ Default LAMA dicabut lebih dulu, di transaksi yang sama.
        // `ux_vertical_profile_tenant_default` adalah index unik PARSIAL:
        // menetapkan default kedua tanpa mencabut yang pertama ditolak
        // database dengan 23505 — benar, tapi jawabannya 500 dan pesannya
        // menyebut nama index.
        if (body.isTenantDefault === true && !sebelum.is_tenant_default) {
          await client.query(
            `UPDATE vertical_profile SET is_tenant_default = false
              WHERE is_tenant_default AND id <> $1`,
            [profileId]
          );
        }

        await client.query(
          `UPDATE vertical_profile
              SET allow_negative_stock = COALESCE($2, allow_negative_stock),
                  is_tenant_default = COALESCE($3, is_tenant_default)
            WHERE id = $1`,
          [profileId, body.allowNegativeStock ?? null, body.isTenantDefault ?? null]
        );

        const sesudah = await ambilProfil(client, profileId);
        await catatPerubahanServer(client, {
          tenantId,
          actorUserId: actorId,
          eventType: 'vertical_profile_changed',
          entityType: 'vertical_profile',
          entityId: profileId,
          before: bentuk(sebelum),
          after: bentuk(sesudah),
        });
        return bentuk(sesudah);
      });
    },

    /**
     * `PUT /outlets/{outletId}/vertical-profile` — override per outlet.
     *
     * ⛔ Bukan bagian dari "ubah outlet". Layar B-23 sengaja tidak punya
     * ubah/arsip outlet, dan endpoint ini tidak menyentuh nama, alamat, zona
     * waktu, maupun `archived_at` — ia menyetel satu kolom yang punya layarnya
     * sendiri.
     */
    async setOutletVerticalProfile(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const { outletId } = req.params as { outletId: string };
      const body = (req.body ?? {}) as { verticalProfileId?: string | null };
      const profilId =
        body.verticalProfileId === undefined || body.verticalProfileId === ''
          ? null
          : body.verticalProfileId;

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        await assertBoleh(client, actorId, 'outlet_manage', 'mengelola profil vertikal');

        // FK klien-suplai ke tabel ber-`tenant_id`. Temuan F1 (`CLAUDE.md`):
        // FK PostgreSQL tidak tunduk RLS — ia hanya membuktikan barisnya ada
        // di SUATU tenant, dan profil merchant lain akan menentukan perilaku
        // stok negatif outlet ini.
        if (profilId !== null) await ambilProfil(client, profilId);

        const { rows: lama } = await client.query<{ vertical_profile_id: string | null }>(
          'SELECT vertical_profile_id FROM outlet WHERE id = $1 AND archived_at IS NULL',
          [outletId]
        );
        if (lama.length === 0) {
          throw new HttpError(404, 'OUTLET_NOT_FOUND', `Outlet ${outletId} tidak ditemukan.`);
        }

        await client.query('UPDATE outlet SET vertical_profile_id = $2 WHERE id = $1', [
          outletId,
          profilId,
        ]);

        await catatPerubahanServer(client, {
          tenantId,
          actorUserId: actorId,
          eventType: 'vertical_profile_changed',
          entityType: 'outlet',
          entityId: outletId,
          outletId,
          // ⛔ `null` DICATAT sebagai null, bukan diresolusi menjadi id
          // bawaan tenant. "Outlet ini mengikuti pusat" dan "outlet ini
          // memilih profil yang kebetulan sama dengan pusat" berperilaku sama
          // hari ini dan berbeda pada hari bawaannya dipindahkan.
          before: { verticalProfileId: lama[0].vertical_profile_id },
          after: { verticalProfileId: profilId },
        });

        return { outletId, verticalProfileId: profilId };
      });
    },
  };
}

/**
 * ⛔ Hanya `fnb`. Lihat catatan kepala — `retail` menuntut UI yang belum ada.
 *
 * Ditolak dengan pesan yang MENJELASKAN, bukan `VALIDATION_ERROR` generik:
 * merchant yang mencoba retail sedang menanyakan sesuatu yang nyata, dan
 * jawaban "nilai tidak sah" membuatnya mengira ia salah mengetik.
 */
function assertNamaSah(name: string | undefined): void {
  if (name === undefined || name === 'fnb') return;
  throw new HttpError(
    400,
    'VERTICAL_NOT_AVAILABLE',
    'Profil vertikal retail belum tersedia. Aplikasi kasir, konversi satuan, retur barang, ' +
      'dan preset pajak PPN yang membedakannya belum dibangun — menyalakannya sekarang ' +
      'hanya mengubah labelnya.'
  );
}
