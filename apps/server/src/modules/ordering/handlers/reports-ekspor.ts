import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import { getActorId, getTenantId } from '../../../tenant-context.ts';
import { assertUserVisible } from '../../identity/index.ts';
import { assertOutletVisible } from '../../tenancy/index.ts';
import { catatPerubahanServer } from '../../audit/index.ts';
import { assertRentang } from './rentang.ts';
import { ambilPenjualan } from './reports.ts';
import { ambilProduk } from './reports-produk.ts';
import { ambilKasir } from './reports-kasir.ts';
import { ambilPembayaran } from './reports-pembayaran.ts';
import { ambilRekap } from './reports-rekap.ts';

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

const JENIS = ['sales', 'products', 'cashiers', 'payments', 'recap'] as const;
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

/**
 * FR-C13 — rekapitulasi, beserta tanggal dibuat dan rentangnya DI DALAM
 * berkas (AC FR-C13 ketiga).
 *
 * ⛔ `dibuatPada` dibaca dari jam DATABASE, tidak pernah `new Date()` di Node.
 * Aturan yang sama dengan `occurred_at` dan `effective_from` (`CLAUDE.md`):
 * di produksi keduanya mesin terpisah, dan berkas pelaporan yang menyebut
 * waktu pembuatan berbeda dari waktu yang tercatat di server adalah berkas
 * yang tidak dapat dipertanggungjawabkan saat diperiksa.
 */
async function bacaRekapUntukEkspor(
  client: import('../../../db.ts').PoolClient,
  { from, to, outletId }: { from: string; to: string; outletId: string | null }
) {
  const { rows } = await client.query<{ sekarang: string }>(
    'SELECT to_char(now() AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS"Z"\') AS sekarang'
  );
  return {
    from,
    to,
    outletId,
    dibuatPada: rows[0].sekarang,
    rekap: await ambilRekap(client, { from, to, outletId }),
  };
}

type RekapEkspor = Awaited<ReturnType<typeof bacaRekapUntukEkspor>>;

/**
 * Bentuk PANJANG (`bagian,keterangan,rincian,nilai`), bukan satu baris lebar.
 *
 * Rekapitulasi memuat tiga hal yang bentuknya berbeda — ringkasan periode,
 * pajak per kelompok, dan pembayaran per metode. Satu tabel lebar memaksa
 * kolom pajak dinamai `pajak_1`, `pajak_2`, dan seterusnya; berkas untuk dua
 * periode berbeda lalu punya jumlah kolom berbeda, dan akuntan yang
 * menumpuknya di satu spreadsheet mendapat kolom yang bergeser.
 *
 * Bentuk panjang tetap dapat di-pivot, dan kolom `nilai`-nya tetap dapat
 * dijumlahkan.
 */
export function susunCsvRekap(d: RekapEkspor): string {
  const r = d.rekap;
  const baris: (readonly unknown[])[] = [
    // AC FR-C13 ketiga — periode dan tanggal dibuat ADA DI DALAM berkas.
    // Nama berkas hilang begitu seseorang menyimpannya ulang.
    ['periode', 'dari', '', d.from],
    ['periode', 'sampai', '', d.to],
    ['periode', 'outlet', '', d.outletId ?? '(semua outlet)'],
    ['periode', 'dibuat_pada', '', d.dibuatPada],

    ['ringkasan', 'jumlah_transaksi', '', r.jumlahTransaksi],
    ['ringkasan', 'omzet_kotor', '', r.omzetKotor],
    ['ringkasan', 'nilai_dibatalkan', '', r.voidAmount],
    ['ringkasan', 'refund', '', r.refundAmount],
    ['ringkasan', 'diskon_order', '', r.totalDiskonOrder],
    ['ringkasan', 'diskon_baris', '', r.totalDiskonBaris],
    ['ringkasan', 'service_charge', '', r.totalServiceCharge],
    ['ringkasan', 'pembulatan', '', r.totalPembulatan],
    ['ringkasan', 'pajak_terkumpul', '', r.pajakTerkumpul],
    ['ringkasan', 'omzet_bersih', '', r.omzetBersih],
  ];

  for (const p of r.pajak) {
    // ⛔ Nama dan yurisdiksi yang tidak tercatat ditulis apa adanya sebagai
    // "(tidak tercatat)", bukan dikosongkan. Sel kosong di kolom yurisdiksi
    // terbaca sebagai "pusat" oleh siapa pun yang tidak tahu kolom itu baru
    // ada sejak migrasi 0028.
    baris.push([
      'pajak',
      p.nama ?? '(tidak tercatat)',
      p.yurisdiksi ?? '(tidak tercatat)',
      p.total,
    ]);
  }

  for (const m of r.pembayaran) {
    baris.push(['pembayaran', m.method, 'total_diterima', m.totalDiterima]);
    // ⛔ Sel KOSONG untuk metode tanpa perkiraan, bukan nol. "0" di kolom
    // potongan kartu EDC berarti "kartu tidak dipotong", dan itu tidak benar
    // — yang benar adalah kami tidak tahu berapa.
    baris.push(['pembayaran', m.method, 'perkiraan_mdr', m.perkiraanMdr ?? '']);
    baris.push(['pembayaran', m.method, 'perkiraan_settlement', m.perkiraanSettlement]);
    if (m.tanpaPerkiraan > 0) {
      baris.push(['pembayaran', m.method, 'baris_tanpa_perkiraan', m.tanpaPerkiraan]);
    }
  }

  baris.push(['settlement', 'total_diterima', '', r.totalDiterima]);
  baris.push(['settlement', 'total_perkiraan_mdr', '', r.totalPerkiraanMdr]);
  baris.push(['settlement', 'total_perkiraan_settlement', '', r.totalPerkiraanSettlement]);
  // Kata "perkiraan" ikut ke berkas, bukan hanya ke layar (AC FR-C12 kedua).
  baris.push([
    'catatan',
    'perkiraan',
    '',
    'Angka MDR dan settlement adalah PERKIRAAN, bukan nilai final. ' +
      'Yang menentukan potongan sebenarnya adalah penyelenggara, per settlement.',
  ]);

  return susunCsv(['bagian', 'keterangan', 'rincian', 'nilai'], baris);
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

        // FR-F6 + `spec-f:300` (`data_exported`).
        //
        // ⛔ Peristiwa audit pada endpoint GET, dan itu disengaja. Ekspor
        // TIDAK mengubah apa pun di sistem — yang berubah adalah di mana
        // datanya berada: sesudah ini ia ada di laptop seseorang, di luar
        // seluruh kontrol akses yang produk ini punya. Justru karena itu
        // `spec-f:300` mendaftarkannya, dan justru karena itu ia satu-satunya
        // pembacaan yang meninggalkan jejak.
        //
        // ⛔ Yang dicatat LINGKUPNYA, bukan isinya. Menyalin CSV-nya ke
        // `after` menaruh omzet, nama kasir, dan seluruh angka penjualan ke
        // dalam tabel yang bertahan lima tahun — dan menggandakan setiap data
        // yang diekspor, di tempat yang tidak seorang pun kira memuatnya.
        await catatPerubahanServer(client, {
          tenantId,
          actorUserId: actorId,
          eventType: 'data_exported',
          entityType: 'report',
          entityId: jenis,
          outletId,
          after: { jenis, from, to, format: 'csv' },
        });

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
          // ⛔ TANPA margin, dan itu batas yang DINYATAKAN — bukan kelalaian.
          //
          // Kolom CSV yang berubah menurut peran pengekspor menghasilkan dua
          // berkas bernama sama dengan isi berbeda, dan akuntan merchant yang
          // menerimanya tidak punya cara mengetahui mana yang ia pegang.
          // Ekspor bermargin menuntut nama berkas dan metadata yang
          // menyatakannya (`spec-g:§G.5` menuntut metadata di dalam
          // berkasnya), dan itu pekerjaan tersendiri.
          //
          // Margin dibaca di layar (`GET /reports/products`), yang RBAC-nya
          // ditegakkan per permintaan.
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

        if (jenis === 'payments') {
          const { metode } = await ambilPembayaran(client, { from, to, outletId });
          return susunCsv(
            [
              'metode',
              'jumlah_transaksi',
              'total_diterima',
              'perkiraan_mdr',
              'perkiraan_settlement',
            ],
            metode.map((m) => [
              m.method,
              m.jumlahTransaksi,
              m.totalDiterima,
              // ⛔ Sel KOSONG untuk metode tanpa perkiraan, bukan nol. "0" di
              // kolom potongan kartu EDC berarti "kartu tidak dipotong", dan
              // itu tidak benar — yang benar adalah kami tidak tahu berapa.
              m.perkiraanMdr ?? '',
              m.perkiraanSettlement,
            ])
          );
        }

        return susunCsvRekap(await bacaRekapUntukEkspor(client, { from, to, outletId }));
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
