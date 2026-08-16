import type { FastifyRequest } from 'fastify';
import type { Pool } from '../../db.ts';
import { withTenantTransaction } from '../../db.ts';
import { HttpError } from '../../http-error.ts';
import { getActorId, getTenantId } from '../../tenant-context.ts';
import { assertUserVisible } from '../identity/index.ts';
import { assertOutletVisible } from '../tenancy/index.ts';
import { ambilDetail } from './handlers/detail-transaksi.ts';
import { ambilStok } from './handlers/stok.ts';

/**
 * Modul `reporting` — agregator baca-saja.
 *
 * `apps/server/src/modules/README.md` sudah menyediakan tempatnya sejak awal
 * ("`reporting` | — (baca lewat view yang disediakan modul lain)"), dan ia
 * kosong sampai sekarang. B-03 adalah kebutuhan pertama yang benar-benar
 * menuntutnya: satu struk **menurut definisi** menggabungkan empat modul.
 *
 * ⛔ Ia tidak memiliki satu tabel pun, dan tidak menulis apa pun. Kedua sifat
 * itulah yang membuat izin bacanya aman — bukan sekadar diberikan.
 *
 * Yang TIDAK dipindahkan ke sini: tujuh pelanggaran batas modul yang sudah ada
 * di `ordering` (endpoint laporan agregat). Memindahkannya adalah refactor
 * tersendiri dengan risikonya sendiri, dan menumpangkannya pada PR B-03 akan
 * membuat keduanya sulit ditinjau.
 */
export function createReportingHandlers(pool: Pool): Record<string, unknown> {
  return {
    async getTransactionDetail(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const { order_id: orderId } = req.params as { order_id: string };

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);

        const detail = await ambilDetail(client, orderId);
        if (detail === null) {
          // ⛔ Pesan yang SAMA untuk "tidak ada" dan "milik tenant lain".
          // Membedakannya memberi tahu penyerang bahwa id yang ia tebak
          // benar-benar ada di suatu tempat.
          throw new HttpError(404, 'NOT_FOUND', `Transaksi ${orderId} tidak ditemukan.`);
        }
        return detail;
      });
    },

    async getInventoryStocks(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const q = req.query as { outlet_id?: string; only_negative?: string; include_zero?: string };
      const outletId = q.outlet_id === undefined || q.outlet_id === '' ? null : q.outlet_id;

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        if (outletId !== null) await assertOutletVisible(client, outletId);

        const items = await ambilStok(client, {
          outletId,
          hanyaNegatif: q.only_negative === 'true',
          sertakanNol: q.include_zero === 'true',
        });
        return { outletId, items };
      });
    },
  };
}
