import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import { getTenantId } from '../../../tenant-context.ts';
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  findIdempotencyKey,
} from '../../sync/index.ts';
import { adalahEventTelemetri, MAKS_TIPE } from '../../../../../../packages/domain/src/telemetri.ts';
import { ambilBearer, ambilDevice, verifikasiPerangkat } from '../kredensial-perangkat.ts';

/**
 * F6 — ingest telemetri klien. `ARCH:294` § 10.
 *
 * `apps/server/src/metrik.ts` mendaftar lima metrik `ARCH:296` yang **tidak
 * dapat dihasilkan server**, dan alasannya sama untuk kelimanya: keadaan yang
 * mereka ukur hidup di perangkat, sebagian besar justru saat perangkat tidak
 * terhubung. Endpoint ini satu-satunya jalan mereka masuk.
 *
 * ## ⛔ BATAS ETIS ditegakkan DI SINI juga, bukan dipercayakan ke klien
 *
 * `ARCH:309`: metrik dan tipe error saja. Klien sudah menyaring
 * (`apps/kasir/src/telemetri/rekam.ts`), dan itu tidak cukup — perangkat yang
 * di-root mengirim apa pun yang mau. Yang menahannya di sisi ini: daftar
 * event TERTUTUP, nilai yang wajib `number` berhingga, `type` yang dipotong,
 * dan tabel tanpa satu pun kolom JSON bebas.
 *
 * ## ⛔ Diautentikasi SECRET PERANGKAT, bukan sesi
 *
 * Telemetri dikirim penjadwal latar, sering saat tidak ada orang yang login.
 * Kredensialnya sama dengan `POST /devices/{id}/sync-token`, lewat modul yang
 * sama — dua endpoint perangkat yang menolak dengan aturan berbeda adalah dua
 * endpoint yang salah satunya lebih longgar tanpa ada yang memutuskannya.
 *
 * ⛔ Perangkat dengan kredensial kedaluwarsa DITOLAK, seperti sync-token.
 * Yang hilang bukan datanya: klien tidak menghapus buffer sampai server
 * menjawab, jadi jendela itu terkirim setelah perangkat di-provisioning
 * ulang.
 */

/** Maksimum agregat per permintaan. Klien meringkas, jadi ini longgar. */
const MAKS_RINGKASAN = 200;

interface RingkasanMasuk {
  event: string;
  type: string | null;
  count: number;
  total: number;
  min: number;
  max: number;
  p95: number;
}

interface MuatanMasuk {
  appVersion?: unknown;
  windowStart?: unknown;
  windowEnd?: unknown;
  events?: unknown;
}

function angka(nilai: unknown, nama: string): number {
  // ⛔ `Number.isFinite`, bukan `typeof === 'number'`. `NaN` dan `Infinity`
  // adalah number, lolos ke `double precision`, dan merusak setiap agregasi
  // sesudahnya tanpa satu pun error.
  if (typeof nilai !== 'number' || !Number.isFinite(nilai)) {
    throw new HttpError(400, 'VALIDATION_ERROR', `${nama} harus angka berhingga.`);
  }
  return nilai;
}

function waktu(nilai: unknown, nama: string): string {
  if (typeof nilai !== 'string' || Number.isNaN(Date.parse(nilai))) {
    throw new HttpError(400, 'VALIDATION_ERROR', `${nama} harus timestamp ISO 8601.`);
  }
  return nilai;
}

/**
 * ⛔ Agregat yang TIDAK MUNGKIN ditolak, bukan disimpan apa adanya.
 *
 * Ini bukan kerapian. Fastify menyalakan koersi AJV secara bawaan, dan
 * `null` pada kolom bertipe `number` menjadi **0** sebelum handler ini
 * melihatnya — pengukuran yang tidak pernah terjadi, tidak dapat dibedakan
 * dari nol yang sungguhan, dan tidak menghasilkan satu pun error. Ditemukan
 * lewat test, bukan lewat review.
 *
 * Yang menangkapnya adalah aritmetika yang harus berlaku untuk agregat mana
 * pun: setiap sampel ada di `[min, max]`, jadi `total` ada di
 * `[min × count, max × count]`, dan `p95` adalah salah satu sampel.
 * `total = 0` dengan `min = 20` melanggar itu, apa pun sebabnya.
 */
function periksaKoheren(a: {
  i: number;
  count: number;
  total: number;
  min: number;
  max: number;
  p95: number;
}): void {
  // Toleransi RELATIF: nilainya milidetik dan detik, dan penjumlahan di klien
  // memakai double. Absolut akan menolak agregat besar yang benar.
  const skala = Math.max(1, Math.abs(a.min), Math.abs(a.max), Math.abs(a.total));
  const eps = skala * 1e-6;
  const salah = (pesan: string): never => {
    throw new HttpError(400, 'VALIDATION_ERROR', `events[${a.i}]: ${pesan}`);
  };
  if (a.min > a.max + eps) salah('min lebih besar dari max.');
  if (a.p95 < a.min - eps || a.p95 > a.max + eps) salah('p95 di luar [min, max].');
  if (a.total < a.min * a.count - eps || a.total > a.max * a.count + eps) {
    salah('total di luar [min × count, max × count].');
  }
}

function bacaRingkasan(mentah: unknown): RingkasanMasuk[] {
  if (!Array.isArray(mentah)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'events harus larik.');
  }
  if (mentah.length > MAKS_RINGKASAN) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      `events maksimum ${MAKS_RINGKASAN} agregat per permintaan.`
    );
  }
  return mentah.map((baris, i) => {
    const b = baris as Record<string, unknown>;
    // ⛔ Daftar TERTUTUP, dan pesannya TIDAK menyebut daftarnya. Berbeda dari
    // `reasonCode` no-sale, yang menyebut pilihannya karena kasir harus dapat
    // memperbaiki masukannya: di sini pemanggilnya kode, dan event asing
    // berarti klien lebih baru daripada server — bukan salah ketik orang.
    if (!adalahEventTelemetri(b.event)) {
      throw new HttpError(400, 'VALIDATION_ERROR', `events[${i}].event tidak dikenal.`);
    }
    const count = angka(b.count, `events[${i}].count`);
    if (!Number.isInteger(count) || count <= 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', `events[${i}].count harus bilangan bulat > 0.`);
    }
    const total = angka(b.total, `events[${i}].total`);
    const min = angka(b.min, `events[${i}].min`);
    const max = angka(b.max, `events[${i}].max`);
    const p95 = angka(b.p95, `events[${i}].p95`);
    periksaKoheren({ i, count, total, min, max, p95 });
    return {
      event: b.event,
      // Dipotong, tidak ditolak. Panjang yang berlebih adalah pemanggil yang
      // keliru mengoper PESAN error alih-alih tipenya, dan menolak seluruh
      // muatan karenanya membuang metrik yang baik bersama yang buruk.
      type:
        typeof b.type === 'string' && b.type.trim() !== ''
          ? b.type.trim().slice(0, MAKS_TIPE)
          : null,
      count,
      total,
      min,
      max,
      p95,
    };
  });
}

async function simpan(
  client: PoolClient,
  params: {
    tenantId: string;
    deviceId: string;
    appVersion: string | null;
    windowStart: string;
    windowEnd: string;
    events: readonly RingkasanMasuk[];
  }
): Promise<void> {
  for (const e of params.events) {
    await client.query(
      `INSERT INTO device_telemetry (
         id, tenant_id, device_id, app_version, event, type,
         window_start, window_end, sample_count, total_value, min_value, max_value, p95_value
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        randomUUID(),
        params.tenantId,
        params.deviceId,
        params.appVersion,
        e.event,
        e.type,
        params.windowStart,
        params.windowEnd,
        e.count,
        e.total,
        e.min,
        e.max,
        e.p95,
      ]
    );
  }
}

interface BarisRingkasan {
  event: string;
  type: string | null;
  sample_count: string | number;
  total_value: number;
  min_value: number;
  max_value: number;
  max_p95: number;
  window_end: string;
}

export function createTelemetryHandlers(pool: Pool): Record<string, unknown> {
  return {
    async ingestDeviceTelemetry(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const { deviceId } = req.params as { deviceId: string };
      const secret = ambilBearer(req);
      const body = (req.body ?? {}) as MuatanMasuk;

      const idempotencyKey = req.headers['idempotency-key'];
      if (typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '') {
        throw new HttpError(400, 'MISSING_IDEMPOTENCY_KEY', 'Header Idempotency-Key wajib.');
      }

      const windowStart = waktu(body.windowStart, 'windowStart');
      const windowEnd = waktu(body.windowEnd, 'windowEnd');
      if (Date.parse(windowEnd) < Date.parse(windowStart)) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'windowEnd tidak boleh mendahului windowStart.');
      }
      const events = bacaRingkasan(body.events);
      const appVersion = typeof body.appVersion === 'string' ? body.appVersion.slice(0, 32) : null;

      const hasil = await withTenantTransaction(pool, tenantId, async (client) => {
        const cached = await findIdempotencyKey(client, idempotencyKey);
        if (cached !== null && cached.completed) {
          return { kind: 'cached' as const, record: cached };
        }
        // Kredensial diverifikasi SEBELUM satu baris pun ditulis, dan
        // pencariannya tunduk RLS — `X-Tenant-Id` tetap dituntut.
        await verifikasiPerangkat(client, deviceId, secret);

        await claimIdempotencyKey(client, {
          key: idempotencyKey,
          tenantId,
          requestHash: `${deviceId}:${windowStart}:${windowEnd}:${events.length}`,
        });

        await simpan(client, { tenantId, deviceId, appVersion, windowStart, windowEnd, events });

        const jawab = { deviceId, diterima: events.length };
        await completeIdempotencyKey(client, {
          key: idempotencyKey,
          responseStatus: 202,
          responseBody: jawab,
        });
        return { kind: 'fresh' as const, jawab };
      });

      if (hasil.kind === 'cached') {
        reply.code(hasil.record.responseStatus ?? 200);
        return hasil.record.responseBody;
      }
      // 202, bukan 201: yang dijanjikan adalah "diterima dan disimpan", bukan
      // sumber daya baru yang punya alamat. Tidak ada `GET /telemetry/{id}`,
      // dan tidak akan ada — barisnya agregat, bukan entitas.
      reply.code(202);
      return hasil.jawab;
    },

    /**
     * Ringkasan telemetri satu perangkat — pembaca tabel ini, dan yang
     * membuatnya bukan tabel tulis-saja. B-28 (`IA:207`).
     *
     * ⛔ Ia TIDAK lintas-tenant. Ambang alarm `ARCH:296` bersifat operasional
     * ("berapa crash di SELURUH merchant") dan itu menuntut pembaca
     * ber-`BYPASSRLS` — koneksi kedua dan keputusan deployment, sama seperti
     * yang sudah dicatat di `metrik.ts`. Yang dijawab di sini adalah
     * pertanyaan merchant tentang perangkatnya sendiri.
     */
    async getDeviceTelemetry(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const { deviceId } = req.params as { deviceId: string };
      const q = req.query as { sejak?: string };
      const sejak = q.sejak === undefined ? null : waktu(q.sejak, 'sejak');

      const baris = await withTenantTransaction(pool, tenantId, async (client) => {
        // FK klien-suplai ke tabel ber-`tenant_id` (temuan F1). Tanpa ini,
        // `deviceId` milik tenant lain hanya menghasilkan larik kosong — dan
        // "kosong" tidak dapat dibedakan dari "perangkat ini belum pernah
        // mengirim apa pun".
        //
        // ⛔ Perangkat yang DICABUT tetap dapat dibaca di sini, berbeda dari
        // `assertDeviceVisible`: riwayat crash sebuah perangkat adalah
        // justru yang dicari saat perangkat itu ditarik dari peredaran.
        if ((await ambilDevice(client, deviceId)) === null) {
          throw new HttpError(404, 'DEVICE_NOT_FOUND', `Device ${deviceId} tidak ditemukan.`);
        }
        const { rows } = await client.query<BarisRingkasan>(
          `SELECT event,
                  type,
                  sum(sample_count)  AS sample_count,
                  sum(total_value)   AS total_value,
                  min(min_value)     AS min_value,
                  max(max_value)     AS max_value,
                  -- ⛔ MAX dari p95, bukan p95 dari p95. Persentil tidak dapat
                  -- dirata-ratakan; yang dilaporkan adalah jendela terburuk,
                  -- dan itu dinyatakan namanya (p95Terburuk).
                  max(p95_value)     AS max_p95,
                  max(window_end)    AS window_end
             FROM device_telemetry
            WHERE device_id = $1
              AND ($2::timestamptz IS NULL OR window_end >= $2::timestamptz)
            GROUP BY event, type
            ORDER BY event, type NULLS FIRST`,
          [deviceId, sejak]
        );
        return rows;
      });

      reply.code(200);
      return {
        deviceId,
        events: baris.map((b) => ({
          event: b.event,
          type: b.type,
          count: Number(b.sample_count),
          total: Number(b.total_value),
          min: Number(b.min_value),
          max: Number(b.max_value),
          p95Terburuk: Number(b.max_p95),
          terakhirPada: b.window_end,
        })),
      };
    },
  };
}
