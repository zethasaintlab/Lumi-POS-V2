import type { FastifyRequest } from 'fastify';
import type { Pool } from '../../db.ts';
import { withTenantTransaction } from '../../db.ts';
import { HttpError } from '../../http-error.ts';
import { getActorId, getTenantId } from '../../tenant-context.ts';
import { assertBoleh, assertUserVisible } from '../identity/index.ts';
import { assertOutletVisible } from '../tenancy/index.ts';
import { assertRentang } from '../ordering/handlers/rentang.ts';
import { ambilDetail } from './handlers/detail-transaksi.ts';
import { ambilStok } from './handlers/stok.ts';
import { ambilDaftarShift, ambilDetailShift } from './handlers/shift.ts';
import { ambilOversell, ambilSelisihKas } from './handlers/perlu-diperiksa.ts';
import { ambilDasbor } from './handlers/dasbor.ts';
import {
  ambilDiskonPerKasir,
  ambilNoSalePerKasir,
  ambilRefundTinggi,
  ambilSelisihKasPerKasir,
  ambilVoidDekatTutup,
} from './handlers/exception.ts';
import { ambilAudit, bacaBatas, bacaJenis } from './handlers/audit.ts';
import { ambilHargaBasi } from './handlers/harga-perangkat.ts';
import { ambilRingkasanHarian } from './handlers/ringkasan-hp.ts';
import { PERISTIWA_BELUM_DIPANCARKAN } from '../../../../../packages/domain/src/audit-peristiwa.ts';

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

    async getShiftReport(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const q = req.query as { from?: string; to?: string; outlet_id?: string; include_open?: string };
      const { from, to, outletId } = assertRentang(q);

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        if (outletId !== null) await assertOutletVisible(client, outletId);
        const items = await ambilDaftarShift(client, {
          from,
          to,
          outletId,
          // ⛔ Bawaan: HANYA yang tertutup. Shift berjalan tidak punya angka
          // selisih, dan menampilkannya kosong di kolom uang membuat
          // manajer mengira hitungannya nol.
          hanyaTertutup: q.include_open !== 'true',
        });
        return { from, to, outletId, items };
      });
    },

    async getShiftDetail(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const { shift_id: shiftId } = req.params as { shift_id: string };

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        const detail = await ambilDetailShift(client, shiftId);
        if (detail === null) {
          throw new HttpError(404, 'NOT_FOUND', `Shift ${shiftId} tidak ditemukan.`);
        }
        return detail;
      });
    },

    async getInventoryOversells(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const q = req.query as {
        from?: string;
        to?: string;
        outlet_id?: string;
        include_resolved?: string;
      };
      const { from, to, outletId } = assertRentang(q);

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        if (outletId !== null) await assertOutletVisible(client, outletId);
        const filter = {
          from,
          to,
          outletId,
          sertakanSelesai: q.include_resolved === 'true',
        };
        // ⛔ Dua daftar dalam SATU respons. `IA:§3.3` menamai layarnya
        // "Perlu Diperiksa (oversell + selisih)"; mengirimnya terpisah
        // berarti layar harus menjahitnya sendiri, dan ringkasan
        // "berapa yang perlu diperiksa" jadi punya dua sumber.
        //
        // ⛔ Keduanya dijalankan BERURUTAN, dan itu bukan pilihan gaya. Versi
        // sebelumnya memakai `Promise.all` atas SATU `PoolClient`, dan itu
        // tidak memparalelkan apa pun: `node-postgres` mengantrekan query pada
        // koneksi yang sama, jadi wall-clock-nya identik dengan berurutan —
        // sambil memancing `DeprecationWarning: Calling client.query() when
        // the client is already executing a query`, perilaku yang **dihapus di
        // pg@9**. Terlihat di log server, bukan di test: keduanya menjawab
        // benar.
        //
        // Memparalelkannya dengan sungguh-sungguh menuntut dua koneksi, dan
        // itu berarti dua transaksi: `SET LOCAL app.tenant_id` berlaku per
        // transaksi (invariant #8), jadi keduanya harus menyetelnya
        // sendiri-sendiri dan respons berhenti menjadi satu potret pada satu
        // titik waktu — persis yang komentar di atas melarang.
        const oversell = await ambilOversell(client, filter);
        const selisihKas = await ambilSelisihKas(client, filter);
        return { from, to, outletId, oversell, selisihKas };
      });
    },

    async getDashboardSummary(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const q = req.query as { from?: string; to?: string; outlet_id?: string };
      const { from, to, outletId } = assertRentang(q);

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        if (outletId !== null) await assertOutletVisible(client, outletId);
        return ambilDasbor(client, { from, to, outletId });
      });
    },

    // -----------------------------------------------------------------------
    // FR-G5 X2–X7 — laporan exception
    // -----------------------------------------------------------------------
    //
    // ⛔ Kelimanya memakai penjaga yang SAMA dengan X1: `report_exception`.
    // AC `spec-g`: "Kasir tidak dapat mengakses laporan exception". Omzet
    // outletnya sendiri bukan rahasia dari kasir; daftar siapa-membatalkan-apa
    // adalah.
    //
    // ⛔ Penjaganya di satu tempat — `exceptionHandler` di bawah — bukan
    // disalin lima kali. Laporan keenam yang ditambahkan besok akan lupa
    // menyalinnya, dan yang lupa adalah yang membocorkan daftar itu ke kasir.
    ...exceptionHandlers(pool),

    /**
     * `GET /audit-events` — B-22 Audit & Aktivitas. FR-F6, FR-F7.
     *
     * ## ⛔ RBAC: `report_exception`, dan itu `[ASUMSI]` yang dinyatakan
     *
     * Matriks `spec-f:38-53` **tidak punya baris untuk audit trail**, dan
     * `navigasi.ts` mencatat itu apa adanya: B-22 adalah "layar yang tidak
     * punya operasi di matriks dan yang tidak seorang pun putuskan untuk
     * Akuntan".
     *
     * Yang dipakai `report_exception`, dan alasannya bukan kenyamanan:
     * himpunan perannya — owner, manajer area, manajer outlet, akuntan —
     * sama persis dengan minimum `IA:201` (Manajer Outlet), dan isi audit
     * trail adalah SUPERSET dari X1 yang matriks sudah berikan kepada keempat
     * peran itu. Menolak trail sambil memberikan X1 tidak melindungi apa pun;
     * ia hanya membuat pertanyaan yang sama dijawab dua kali dengan hasil
     * berbeda.
     *
     * Operasi baru `audit_view` sengaja TIDAK dibuat: menambah baris ke
     * matriks berarti mengarang kebijakan yang spec tidak nyatakan, dan
     * matriks yang mengandung baris karangan berhenti dapat dibaca
     * berdampingan dengan spec-nya.
     */

    /**
     * `GET /reports/stale-price-devices` — FR-A7 AC keempat.
     *
     * ⛔ RBAC `price_edit`, bukan `report_exception`. Yang bertanya "perangkat
     * mana yang belum menerima harga baru" adalah orang yang BARU MENGUBAH
     * harga itu, dan himpunan perannya sudah ditetapkan `spec-f:38-53`.
     * Operasi baru yang himpunannya identik hanya menambah baris ke matriks
     * yang spec tidak nyatakan.
     */

    /**
     * `GET /reports/daily-summary` — FR-G6, layar pertama M-01.
     *
     * ⛔ Angkanya dari `ambilPenjualan` dan `ambilPembayaran` — fungsi yang
     * SAMA yang `GET /reports/sales` dan `/reports/payments` pakai. Owner yang
     * melihat omzet berbeda tergantung layar mana yang ia buka akan
     * mempercayai yang ia lihat pukul 23:00, dan itu yang paling jarang
     * diperiksa ulang.
     *
     * ⛔ RBAC `report_exception`, himpunan yang sama dengan laporan pengawasan
     * lain: ringkasan ini memuat omzet bersih seluruh outlet.
     */
    async getDailySummary(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const q = (req.query ?? {}) as { date?: string; outlet_id?: string };
      const outletId = q.outlet_id === undefined || q.outlet_id === '' ? null : q.outlet_id;

      const tanggal = q.date;
      if (typeof tanggal !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'date wajib diisi, bentuk YYYY-MM-DD.');
      }

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        await assertBoleh(client, actorId, 'report_exception', 'melihat ringkasan harian');
        if (outletId !== null) await assertOutletVisible(client, outletId);
        return ambilRingkasanHarian(client, { tanggal, outletId });
      });
    },

    async getStalePriceDevices(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const q = (req.query ?? {}) as { outlet_id?: string };
      const outletId = q.outlet_id === undefined || q.outlet_id === '' ? null : q.outlet_id;

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        await assertBoleh(client, actorId, 'price_edit', 'melihat perangkat berharga basi');
        if (outletId !== null) await assertOutletVisible(client, outletId);

        const hasil = await ambilHargaBasi(client, { outletId });
        return { outletId, ...hasil };
      });
    },

    async getAuditEvents(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const q = req.query as {
        from?: string;
        to?: string;
        outlet_id?: string;
        event_type?: string;
        actor_user_id?: string;
        entity_id?: string;
        cursor?: string;
        limit?: string;
        support_only?: string;
      };
      const { from, to, outletId } = assertRentang(q);
      const eventType = bacaJenis(q.event_type);
      const batas = bacaBatas(q.limit);
      const kosong = (v: string | undefined) => (v === undefined || v === '' ? null : v);

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        await assertBoleh(client, actorId, 'report_exception', 'melihat audit trail');
        if (outletId !== null) await assertOutletVisible(client, outletId);

        const halaman = await ambilAudit(client, {
          from,
          to,
          outletId,
          eventType,
          actorUserId: kosong(q.actor_user_id),
          entityId: kosong(q.entity_id),
          kursor: kosong(q.cursor),
          batas,
          // ⛔ Hanya `'true'` yang menyalakannya. Nilai lain apa pun berarti
          // tidak menyaring — string kosong dari form yang belum diisi tidak
          // boleh diam-diam menyembunyikan seluruh audit non-support.
          hanyaSupport: q.support_only === 'true',
        });

        // ⛔ Saringan yang dipakai ikut dikembalikan. Daftar audit yang tidak
        // menyebut apa yang sedang disaring terbaca seperti daftar lengkap —
        // dan kesimpulan yang ditarik darinya menyangkut orang.
        return {
          from,
          to,
          outletId,
          eventType,
          actorUserId: kosong(q.actor_user_id),
          entityId: kosong(q.entity_id),
          hanyaSupport: q.support_only === 'true',
          batas,
          // Jarak yang tersisa ke FR-F6 AC pertama, diturunkan di domain.
          // Layar menyebutkannya: trail berlubang yang terlihat lengkap adalah
          // bentuk paling berbahaya dari trail yang tidak lengkap.
          belumDipancarkan: PERISTIWA_BELUM_DIPANCARKAN,
          ...halaman,
        };
      });
    },
  };
}

/**
 * Pembungkus satu-satunya untuk laporan exception.
 *
 * Menerima pembaca data, mengembalikan handler ber-RBAC. Yang tidak boleh
 * terjadi adalah laporan exception yang lupa `assertBoleh` — dan itu tidak
 * dapat terjadi bila hanya ada satu tempat yang memasangnya.
 */
function exceptionHandlers(pool: Pool): Record<string, unknown> {
  const buat =
    (baca: (
      client: Parameters<typeof ambilVoidDekatTutup>[0],
      filter: { from: string; to: string; outletId: string | null }
    ) => Promise<unknown>, kunci: string) =>
    async (req: FastifyRequest) => {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const q = req.query as { from?: string; to?: string; outlet_id?: string };
      const { from, to, outletId } = assertRentang(q);

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        await assertBoleh(client, actorId, 'report_exception', 'melihat laporan exception');
        if (outletId !== null) await assertOutletVisible(client, outletId);
        return { from, to, outletId, [kunci]: await baca(client, { from, to, outletId }) };
      });
    };

  return {
    /** X2 — void mendekati/sesudah tutup shift. */
    getShiftEndVoidReport: buat(ambilVoidDekatTutup, 'void'),
    /** X3 — refund bernilai tinggi (persentil 90). */
    getHighRefundReport: buat(ambilRefundTinggi, 'laporan'),
    /** X4 — frekuensi no-sale per kasir. */
    getNoSaleExceptionReport: buat(ambilNoSalePerKasir, 'perKasir'),
    /** X5 — diskon manual per kasir. */
    getDiscountExceptionReport: buat(ambilDiskonPerKasir, 'perKasir'),
    /** X7 — selisih kas per kasir, dengan tren. */
    getCashVarianceExceptionReport: buat(ambilSelisihKasPerKasir, 'perKasir'),
  };
}
