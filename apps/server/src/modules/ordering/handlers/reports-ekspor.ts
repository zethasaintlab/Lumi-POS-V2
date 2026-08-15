import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import { getActorId, getTenantId } from '../../../tenant-context.ts';
import { assertUserVisible } from '../../identity/index.ts';
import { assertOutletVisible } from '../../tenancy/index.ts';
import { assertRentang } from './rentang.ts';
import { ambilPenjualan } from './reports.ts';
import { ambilProduk } from './reports-produk.ts';
import { ambilKasir } from './reports-kasir.ts';
import { ambilPembayaran } from './reports-pembayaran.ts';

/**
 * `GET /reports/export` — keempat laporan sebagai CSV.
 *
 * ## ⛔ Angkanya datang dari FUNGSI yang sama dengan JSON
 *
 * `ambilPenjualan`, `ambilProduk`, `ambilKasir`, dan `ambilPembayaran`
 * diekspor dari handler masing-masing dan dipanggil di sini. Tidak ada satu
 * query pun yang ditulis ulang.
 *
 * Alasannya lebih tajam daripada sekadar kerapian: CSV adalah berkas yang
 * merchant bawa ke akuntannya, dan CSV yang berbeda dari layar adalah bentuk
 * terburuk perbedaan angka — ia dipercaya, disimpan, dan dibandingkan dengan
 * catatan lain berbulan-bulan kemudian.
 *
 * ## ⛔ Injeksi rumus spreadsheet
 *
 * Nama produk dan nama kasir berasal dari input merchant. Sel CSV yang diawali
 * `=`, `+`, `-`, `@`, tab, atau CR dieksekusi sebagai RUMUS oleh Excel dan
 * Google Sheets — `=HYPERLINK(...)` dan `=cmd|...` adalah vektor nyata, dan
 * korbannya bukan merchant yang mengetiknya melainkan akuntan yang membuka
 * berkasnya.
 *
 * Sel seperti itu diawali kutip tunggal sebelum di-quote. Nilainya tetap
 * terbaca manusia; yang hilang hanya kemampuannya menjadi rumus.
 *
 * ## ⛔ BOM UTF-8
 *
 * Tanpa BOM, Excel di Windows membaca CSV sebagai ANSI dan setiap nama
 * ber-aksen rusak. `CLAUDE.md` sudah mencatat BOM di jalur impor; ini sisi
 * sebaliknya.
 *
 * ## Uang tetap string
 *
 * Nilai uang ditulis apa adanya dari `bigint` — tanpa pemisah ribuan dan tanpa
 * simbol mata uang. Spreadsheet yang menerima `Rp 1.847.000` membacanya
 * sebagai teks, dan kolom yang tidak dapat dijumlahkan adalah kolom yang
 * membuat ekspor ini tidak berguna.
 */

const JENIS = ['sales', 'products', 'cashiers', 'payments'] as const;
type Jenis = (typeof JENIS)[number];

/** Karakter yang membuat spreadsheet memperlakukan sel sebagai rumus. */
const AWALAN_RUMUS = /^[=+\-@\t\r]/;

export function selCsv(nilai: unknown): string {
  let teks = nilai === null || nilai === undefined ? '' : String(nilai);
  if (AWALAN_RUMUS.test(teks)) teks = `'${teks}`;
  // Kutip ganda di dalam sel digandakan (RFC 4180).
  return `"${teks.replace(/"/g, '""')}"`;
}

export function barisCsv(kolom: readonly unknown[]): string {
  return kolom.map(selCsv).join(',');
}

/** CRLF — RFC 4180, dan satu-satunya yang Excel lama baca dengan benar. */
export function susunCsv(header: readonly string[], baris: readonly (readonly unknown[])[]): string {
  return '﻿' + [barisCsv(header), ...baris.map(barisCsv)].join('\r\n') + '\r\n';
}

export function createExportHandlers(pool: Pool): Record<string, unknown> {
  return {
    async getReportExport(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const q = req.query as { type?: string; from?: string; to?: string; outlet_id?: string };

      const jenis = q.type as Jenis;
      if (!JENIS.includes(jenis)) {
        throw new HttpError(
          400,
          'VALIDATION_ERROR',
          `Parameter type harus salah satu dari: ${JENIS.join(', ')}.`
        );
      }
      const { from, to, outletId } = assertRentang(q);

      const csv = await withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        if (outletId !== null) await assertOutletVisible(client, outletId);

        if (jenis === 'sales') {
          const p = await ambilPenjualan(client, { from, to, outletId });
          return susunCsv(
            ['metrik', 'nilai'],
            [
              ['omzet_kotor', p.omzetKotor],
              ['nilai_dibatalkan', p.voidAmount],
              ['refund', p.refundAmount],
              ['omzet_bersih', p.omzetBersih],
              ['pajak_terkumpul', p.pajakTerkumpul],
              ['jumlah_transaksi', p.jumlahTransaksi],
              ['rata_rata_per_transaksi', p.rataRataPerTransaksi],
            ]
          );
        }

        if (jenis === 'products') {
          const produk = await ambilProduk(client, { from, to, outletId });
          return susunCsv(
            ['variation_id', 'produk', 'varian', 'kuantitas_x1000', 'kuantitas', 'nilai_kotor'],
            produk.map((b) => [
              b.variationId,
              b.itemName,
              b.variationName,
              b.kuantitas,
              b.kuantitasTampil,
              b.nilaiKotor,
            ])
          );
        }

        if (jenis === 'cashiers') {
          const kasir = await ambilKasir(client, { from, to, outletId });
          return susunCsv(
            [
              'user_id',
              'nama',
              'jumlah_transaksi',
              'omzet_kotor',
              'nilai_dibatalkan',
              'refund',
              'omzet_bersih',
              'pajak_terkumpul',
            ],
            kasir.map((k) => [
              k.userId,
              k.name,
              k.penjualan.jumlahTransaksi,
              k.penjualan.omzetKotor,
              k.penjualan.voidAmount,
              k.penjualan.refundAmount,
              k.penjualan.omzetBersih,
              k.penjualan.pajakTerkumpul,
            ])
          );
        }

        const { metode } = await ambilPembayaran(client, { from, to, outletId });
        return susunCsv(
          ['metode', 'jumlah_transaksi', 'total_diterima'],
          metode.map((m) => [m.method, m.jumlahTransaksi, m.totalDiterima])
        );
      });

      // ⛔ Nama berkas memuat jenis dan rentang. Merchant mengunduh empat
      // laporan untuk tiga bulan dan berakhir dengan dua belas berkas di
      // folder yang sama; `export.csv` dua belas kali tidak dapat dibedakan.
      const namaBerkas = `lumi-${jenis}-${from}_${to}.csv`;
      reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="${namaBerkas}"`);
      return csv;
    },
  };
}
