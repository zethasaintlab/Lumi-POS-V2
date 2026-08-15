import type { Pool } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import { getTenantId, getActorId } from '../../../tenant-context.ts';
import { assertUserVisible, assertBoleh, hitungPengguna, hitungPerangkat } from '../../identity/index.ts';
import { hitungProduk } from '../../catalog/index.ts';
import { batasKuota, hitungOutlet } from '../kuota.ts';
import { DIMENSI_KUOTA } from '../../../../../../packages/domain/src/kuota.ts';
import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * `GET /tenants/usage` — pemakaian nyata versus kuota. Data untuk layar B-29
 * "Langganan & Batas" (`IA:169`, `IA:208`).
 *
 * `research/09` § "Implikasi untuk IA" menuntut dua hal dari layar itu, dan
 * keduanya butuh endpoint ini: *"pemakaian versus kuota"* dan *"peringatan
 * kuota mendekati batas harus muncul di dashboard owner, bukan hanya saat
 * operasi ditolak."*
 *
 * ## ⛔ Angka yang ditampilkan HARUS angka yang ditegakkan
 *
 * Setiap hitungan di sini memanggil fungsi yang sama persis dengan yang
 * dipakai titik penegakannya — `hitungProduk` (catalog), `hitungPengguna` dan
 * `hitungPerangkat` (identity), `hitungOutlet` (tenancy).
 *
 * Menulis salinan query di sini akan bekerja hari ini dan menyimpang di edit
 * berikutnya, tepat pada aturan arsip. Gejalanya adalah gejala terburuk yang
 * mungkin untuk layar ini: merchant melihat **"12 dari 200"** lalu operasinya
 * ditolak karena kuota penuh, dan tidak ada satu pun error yang menjelaskan
 * mana dari dua angka itu yang bohong.
 *
 * ## Invariant #4
 *
 * Modul tenancy TIDAK meng-query `item`, `"user"`, maupun `device`. Ia
 * memanggil fungsi yang diekspor pemilik masing-masing tabel, lewat
 * `index.ts` mereka. Aturan "apa yang tidak dihitung" berbeda di tiap modul,
 * dan aturan itu milik modul yang memilikinya:
 *
 *   produk    `archived_at IS NULL`
 *   outlet    `archived_at IS NULL`
 *   pengguna  `is_active = true`
 *   device    `revoked_at IS NULL`
 *
 * ## Owner-only
 *
 * `spec-f:52` menandai "Billing & langganan" ✅ hanya untuk Owner. Pemakaian
 * versus kuota adalah informasi komersial — ia menunjukkan kapan merchant
 * harus membayar lebih.
 */

export function createUsageHandlers(pool: Pool): Record<string, unknown> {
  return {
    async getTenantUsage(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);

      const hasil = await withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        await assertBoleh(client, actorId, 'billing', 'melihat langganan dan batas');

        const { rows } = await client.query<{ plan: string; status: string }>(
          'SELECT plan, status FROM tenant WHERE id = $1',
          [tenantId]
        );
        if (rows.length === 0) {
          throw new HttpError(404, 'TENANT_NOT_FOUND', `Tenant ${tenantId} tidak ditemukan.`);
        }

        const batas = await batasKuota(client, tenantId);

        // Keempat hitungan berjalan di SATU transaksi bersama pembacaan
        // batasnya. Membacanya di transaksi terpisah membuat layar dapat
        // menampilkan pemakaian dari satu titik waktu terhadap kuota dari
        // titik waktu lain — dan pada dimensi yang sedang penuh, selisih itu
        // persis yang membuat "199 dari 200" terlihat aman.
        const terpakai = {
          outlet: await hitungOutlet(client),
          device: await hitungPerangkat(client),
          pengguna: await hitungPengguna(client),
          produk: await hitungProduk(client),
        };

        const kolom = {
          outlet: batas.maxOutlets,
          device: batas.maxDevices,
          pengguna: batas.maxUsers,
          produk: batas.maxProducts,
        };

        // Dibangun dari `DIMENSI_KUOTA`, bukan dari daftar yang ditulis
        // tangan di sini. Dimensi yang ditambahkan kelak muncul di layar ini
        // tanpa ada yang perlu ingat menambahkannya — dan dimensi yang
        // dihapus tidak tertinggal sebagai baris hantu.
        const kuota: Record<string, { terpakai: number; batas: number | null }> = {};
        for (const dimensi of DIMENSI_KUOTA) {
          kuota[dimensi] = { terpakai: terpakai[dimensi], batas: kolom[dimensi] };
        }

        return { plan: rows[0].plan, status: rows[0].status, kuota };
      });

      reply.code(200);
      return hasil;
    },
  };
}
