import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Pool } from './db.ts';

/**
 * F6 — observability sisi server. `ARCH:294` § 10.
 *
 * ## ⛔ Yang TIDAK ada di sini, dan kenapa
 *
 * `ARCH` § 10 mendaftar delapan metrik. Lima di antaranya **tidak dapat
 * dihasilkan server ini**, dan itu bukan kelalaian:
 *
 * | Metrik `ARCH:296` | Kenapa tidak di sini |
 * |---|---|
 * | Umur antrean sinkronisasi tertua per device | ⛔ Antrean yang menua adalah penjualan yang **belum pernah sampai** ke server. Tidak ada baris untuk dihitung. Yang server lihat hanyalah `device.last_seen_at` yang basi — hal yang BERBEDA, dan sudah muncul di dasbor owner (FR-H8) |
 * | Item gagal sinkron per device | Sama: item `failed` hidup di `outbox_local`, di perangkat |
 * | Latensi p95 tambah item ke keranjang | Terjadi di perangkat, tanpa jaringan |
 * | Crash rate per versi | Klien |
 * | Rasio waktu offline per outlet | Klien |
 *
 * Ketiganya menuntut **telemetri klien**: buffer persisten di perangkat +
 * endpoint ingest. `ARCH:307` menuntut buffer itu offline-first dan
 * fire-and-forget, dan itu subsistem tersendiri yang belum ada.
 *
 * ## ⛔ Kenapa TANPA data tenant sama sekali
 *
 * Metrik operasional bersifat lintas-tenant menurut sifatnya ("berapa oversell
 * di SELURUH merchant"). Aplikasi ini terhubung sebagai user yang **tunduk
 * RLS** (invariant #8): agregasi lintas-tenant menuntut pembaca ber-`BYPASSRLS`
 * — koneksi kedua, kredensial kedua, dan keputusan deployment yang bukan
 * kewenangan kode ini.
 *
 * Jadi yang diekspor di sini adalah metrik **PROSES**: berapa permintaan,
 * seberapa lambat, berapa yang gagal, dan seberapa penuh pool koneksi.
 * Semuanya nyata, semuanya berguna sebagai hal pertama yang dilihat saat
 * server terasa sakit, dan tidak satu pun menyentuh baris merchant.
 *
 * `ARCH:309` — **batas etis**: tidak pernah mengirim nama produk, harga, nilai
 * transaksi, data pelanggan, atau nama merchant. Berkas ini tidak dapat
 * melanggarnya karena ia tidak pernah membaca satu tabel pun.
 *
 * ## Format
 *
 * Teks eksposisi Prometheus. Ia standar de-facto dan tidak menambah satu
 * dependensi pun — teksnya dirakit dengan `join`.
 */

/** Label rute: POLA Fastify, bukan URL mentah. */
function polaRute(req: FastifyRequest): string {
  const pola = req.routeOptions?.url;
  // Permintaan yang tidak cocok rute mana pun dikelompokkan jadi satu.
  // ⛔ Memakai `req.url` mentah di sini membuat kardinalitas metrik meledak:
  // setiap `/orders/<uuid>` menjadi deret waktu tersendiri, dan monitoring
  // yang penuh deret waktu sekali-pakai berhenti dapat dipakai.
  return pola ?? '__tidak_dikenal__';
}

function kelasStatus(kode: number): string {
  if (kode >= 500) return '5xx';
  if (kode >= 400) return '4xx';
  if (kode >= 300) return '3xx';
  return '2xx';
}

/**
 * Batas histogram, **MILIDETIK bilangan bulat**.
 *
 * Dipilih untuk pertanyaan yang benar-benar ditanyakan di POS: "apakah masih
 * di bawah 100 ms" (`ARCH:300` memakai ambang itu untuk jalur keranjang) dan
 * "apakah ada yang menggantung lebih dari sedetik".
 *
 * ## ⛔ Kenapa milidetik dan bukan detik
 *
 * Ditulis sebagai detik, daftarnya berbunyi `[0.01, 0.025, 0.05, 0.1, …]` —
 * dan penjaga invariant #7 (`tests/domain/tax-invariant.test.js`) MENANDAINYA
 * sebagai angka tarif pajak di luar `TaxCalculator`. Penjaga itu benar untuk
 * menandainya: `0.1` telanjang di kode server tidak dapat dibedakan dari 10%
 * tanpa membaca konteksnya.
 *
 * Yang diperbaiki adalah KODE ini, bukan penjaganya. Daftar pengecualian akan
 * bertambah panjang sampai penjaganya tidak menjaga apa pun — dan `ARCH:300`
 * memang menyebut ambangnya dalam milidetik, jadi bilangan bulat justru lebih
 * dekat dengan cara orang membicarakannya.
 *
 * Prometheus menuntut `le` dalam detik; pembagiannya terjadi saat render.
 */
const EMBER_MS = [10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000];
const PER_DETIK = 1_000;

interface Akumulator {
  /** `metode|pola|kelas` → jumlah */
  jumlah: Map<string, number>;
  /** `metode|pola` → { total detik, hitungan, ember } */
  durasi: Map<string, { total: number; n: number; ember: number[] }>;
}

export interface Metrik {
  catat(req: FastifyRequest, reply: FastifyReply, detik: number): void;
  render(): string;
  /** Dipakai test: keadaan mentah, tanpa mengurai teks Prometheus. */
  keadaan(): { jumlah: Map<string, number>; durasi: Akumulator['durasi'] };
}

export function buatMetrik(pool: Pool, sekarang: () => number = () => Date.now()): Metrik {
  const mulai = sekarang();
  const akum: Akumulator = { jumlah: new Map(), durasi: new Map() };

  function tambahDurasi(kunci: string, detik: number) {
    let d = akum.durasi.get(kunci);
    if (!d) {
      d = { total: 0, n: 0, ember: new Array(EMBER_MS.length).fill(0) };
      akum.durasi.set(kunci, d);
    }
    d.total += detik;
    d.n += 1;
    const ms = detik * PER_DETIK;
    for (let i = 0; i < EMBER_MS.length; i += 1) {
      if (ms <= EMBER_MS[i]) d.ember[i] += 1;
    }
  }

  return {
    catat(req, reply, detik) {
      const pola = polaRute(req);
      const kunci = `${req.method}|${pola}`;
      const kelas = kelasStatus(reply.statusCode);
      akum.jumlah.set(`${kunci}|${kelas}`, (akum.jumlah.get(`${kunci}|${kelas}`) ?? 0) + 1);
      tambahDurasi(kunci, detik);
    },

    keadaan() {
      return { jumlah: akum.jumlah, durasi: akum.durasi };
    },

    render() {
      const baris: string[] = [];

      baris.push('# HELP lumi_up Server menjawab.');
      baris.push('# TYPE lumi_up gauge');
      baris.push('lumi_up 1');

      baris.push('# HELP lumi_uptime_seconds Detik sejak proses menerima permintaan pertama.');
      baris.push('# TYPE lumi_uptime_seconds gauge');
      baris.push(`lumi_uptime_seconds ${((sekarang() - mulai) / 1000).toFixed(3)}`);

      baris.push('# HELP lumi_http_requests_total Permintaan HTTP yang selesai.');
      baris.push('# TYPE lumi_http_requests_total counter');
      for (const [kunci, n] of [...akum.jumlah].sort()) {
        const [metode, pola, kelas] = kunci.split('|');
        baris.push(
          `lumi_http_requests_total{method="${metode}",route="${lolos(pola)}",status="${kelas}"} ${n}`
        );
      }

      baris.push('# HELP lumi_http_request_duration_seconds Lama permintaan HTTP.');
      baris.push('# TYPE lumi_http_request_duration_seconds histogram');
      for (const [kunci, d] of [...akum.durasi].sort()) {
        const [metode, pola] = kunci.split('|');
        const label = `method="${metode}",route="${lolos(pola)}"`;
        for (let i = 0; i < EMBER_MS.length; i += 1) {
          // `le` dalam DETIK — itu yang Prometheus tuntut. Sumbernya tetap
          // milidetik bilangan bulat; lihat komentar di `EMBER_MS`.
          const le = EMBER_MS[i] / PER_DETIK;
          baris.push(
            `lumi_http_request_duration_seconds_bucket{${label},le="${le}"} ${d.ember[i]}`
          );
        }
        baris.push(`lumi_http_request_duration_seconds_bucket{${label},le="+Inf"} ${d.n}`);
        baris.push(`lumi_http_request_duration_seconds_sum{${label}} ${d.total.toFixed(6)}`);
        baris.push(`lumi_http_request_duration_seconds_count{${label}} ${d.n}`);
      }

      // ⛔ Pool koneksi. Ia yang pertama jenuh saat server tersendat, dan
      // `waiting > 0` yang berkelanjutan berarti permintaan mengantre untuk
      // koneksi — gejala yang terlihat pengguna sebagai "aplikasi lambat"
      // tanpa satu pun error.
      const p = pool as unknown as { totalCount?: number; idleCount?: number; waitingCount?: number };
      baris.push('# HELP lumi_db_pool_connections Koneksi di pool PostgreSQL.');
      baris.push('# TYPE lumi_db_pool_connections gauge');
      baris.push(`lumi_db_pool_connections{state="total"} ${p.totalCount ?? 0}`);
      baris.push(`lumi_db_pool_connections{state="idle"} ${p.idleCount ?? 0}`);
      baris.push(`lumi_db_pool_connections{state="waiting"} ${p.waitingCount ?? 0}`);

      return `${baris.join('\n')}\n`;
    },
  };
}

/** Label Prometheus: `\`, `"`, dan newline wajib di-escape. */
function lolos(nilai: string): string {
  return nilai.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/**
 * Memasang pencatat dan endpoint `GET /metrics`.
 *
 * ⛔ `onResponse`, bukan `onSend`: yang diukur adalah permintaan yang
 * SELESAI, termasuk yang gagal. Hook yang hanya berjalan pada jalur sukses
 * menghasilkan grafik yang paling cerah tepat saat server paling sakit.
 *
 * ⛔ `/metrics` sendiri TIDAK dicatat. Scraper memanggilnya setiap belasan
 * detik, dan membiarkannya masuk membuat rute tersibuk di grafik adalah
 * monitoring itu sendiri.
 */
export function pasangMetrik(app: FastifyInstance, metrik: Metrik): void {
  app.addHook('onResponse', async (req, reply) => {
    if (req.routeOptions?.url === '/metrics') return;
    // `elapsedTime` Fastify dalam milidetik; Prometheus memakai detik.
    metrik.catat(req, reply, reply.elapsedTime / 1000);
  });

  app.get('/metrics', async (_req, reply) => {
    reply.header('content-type', 'text/plain; version=0.0.4; charset=utf-8');
    return metrik.render();
  });
}
