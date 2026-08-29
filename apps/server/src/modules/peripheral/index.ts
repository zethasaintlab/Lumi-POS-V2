import { randomUUID } from 'node:crypto';
import type { Pool } from '../../db.ts';
import { withTenantTransaction } from '../../db.ts';
import { HttpError } from '../../http-error.ts';
import { getTenantId, getActorId } from '../../tenant-context.ts';
import { assertUserVisible, assertBoleh } from '../identity/index.ts';
import { recordAuditEvent } from '../audit/index.ts';
import {
  findIdempotencyKey,
  claimIdempotencyKey,
  completeIdempotencyKey,
  insertOutboxEvent,
} from '../sync/index.ts';
import type { Hlc } from '../../../../../packages/domain/src/hlc.ts';
import {
  JENIS_PERIPHERAL,
  KONEKSI_PERIPHERAL,
  adalahJenisPeripheral,
  adalahKoneksiPeripheral,
} from '../../../../../packages/domain/src/peripheral.ts';
import type { PeristiwaAudit } from '../../../../../packages/domain/src/audit-peristiwa.ts';
import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Modul `peripheral` — `ARCH:86`, tabel `peripheral` dan `printer_profile`.
 *
 * Lahir 25 Agustus 2026 dengan dua operasi, dan itu seluruh permukaannya.
 *
 * ## ⛔ Apa yang sebenarnya rusak sebelum ini
 *
 * `printer_profile` sudah turun ke perangkat sejak F4, dan K-09/K-15 memilih
 * profil dengan `p[0]` — baris PERTAMA yang query kembalikan, dari query yang
 * tidak punya `ORDER BY` sama sekali. Merchant dengan tiga model printer
 * mencetak dengan profil yang dipilih urutan baris, bukan dengan profil
 * printer yang benar-benar tercolok. Tidak ada satu pun error: struk 80 mm
 * dipotong di kolom 32, atau perintah potong tercetak sebagai karakter sampah
 * di printer tanpa pemotong.
 *
 * Yang hilang adalah **jalan untuk mengatakan printer mana yang ada di
 * perangkat ini**, dan `peripheral` adalah tabel yang ERD siapkan untuk itu.
 *
 * ## ⛔ Ia jalur PERANGKAT, dan karena itu `sesiOpsional`
 *
 * K-15 bertanda ✅ offline (`IA:65`). Pilihan profil ditulis lokal lebih dulu
 * lalu di-relay — dan rute jalur perangkat yang hanya `DIKECUALIKAN` dari RBAC
 * dijawab **401** oleh penjaga sesi, lalu berhenti permanen di antrean. Bentuk
 * cacat yang PERSIS sama dengan refund offline (21 Agustus) dan kas manual
 * (24 Agustus). Ini kemunculan keempatnya.
 *
 * ## ⛔ Perintah printer TIDAK diterima dari klien
 *
 * `POST /peripherals` menerima `printerProfileId`, bukan `initCommand` dan
 * kawan-kawannya. `ERD:445` menetapkan `printer_profile` adalah "data, bukan
 * kode", dan datanya milik KAMI — tabelnya dikecualikan RLS, sejajar
 * `app_release`. Perangkat yang dapat mengarang perintahnya sendiri adalah
 * perangkat yang dapat mengirim byte apa pun ke printer merchant.
 */

interface BarisPeripheral {
  id: string;
  tenant_id: string;
  device_id: string | null;
  outlet_id: string;
  type: string;
  connection: string;
  address: string | null;
  printer_profile_id: string | null;
  last_test_at: string | null;
}

export interface PeripheralInput {
  id?: unknown;
  deviceId?: unknown;
  outletId?: unknown;
  type?: unknown;
  connection?: unknown;
  address?: unknown;
  printerProfileId?: unknown;
  hlc?: unknown;
  occurredAt?: unknown;
}

const EVENT: PeristiwaAudit = 'peripheral_configured';

function teksWajib(nilai: unknown, nama: string): string {
  if (typeof nilai !== 'string' || nilai.trim() === '') {
    throw new HttpError(400, 'VALIDATION_ERROR', `${nama} wajib diisi.`);
  }
  return nilai;
}

export function createPeripheralHandlers(pool: Pool, hlc: Hlc): Record<string, unknown> {
  return {
    /**
     * `GET /printer-profiles` — daftar referensi.
     *
     * ⛔ TANPA `assertBoleh`. Ia data referensi hardware global tanpa
     * `tenant_id`, dan tidak satu pun kolomnya menyebut merchant mana pun —
     * konsekuensi yang sama yang `app_release` nyatakan. Yang dijaga tetap
     * sesi: daftar model printer bukan rahasia, tapi ia juga bukan endpoint
     * publik.
     *
     * ⛔ `ORDER BY name` DINYATAKAN. Query tanpa urutan adalah tepat cacat
     * yang seluruh task ini perbaiki, dan mengulanginya di endpoint yang
     * memperbaikinya akan lucu kalau tidak berbahaya.
     */
    async listPrinterProfiles(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        const { rows } = await client.query(
          `SELECT id, name, paper_width_mm, chars_per_line, codepage,
                  has_cutter, init_command, cut_command, drawer_command, image_support
             FROM printer_profile
            ORDER BY name`
        );
        return rows.map((r) => ({
          id: r.id,
          name: r.name,
          paperWidthMm: r.paper_width_mm,
          charsPerLine: r.chars_per_line,
          codepage: r.codepage,
          hasCutter: r.has_cutter,
          initCommand: r.init_command,
          cutCommand: r.cut_command,
          drawerCommand: r.drawer_command,
          imageSupport: r.image_support,
        }));
      });
    },

    /**
     * `GET /peripherals` — apa yang terpasang, per outlet atau per perangkat.
     */
    async listPeripherals(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const q = (req.query ?? {}) as { device_id?: string; outlet_id?: string };
      const deviceId = q.device_id === undefined || q.device_id === '' ? null : q.device_id;
      const outletId = q.outlet_id === undefined || q.outlet_id === '' ? null : q.outlet_id;

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        const { rows } = await client.query<BarisPeripheral>(
          `SELECT id, tenant_id, device_id, outlet_id, type, connection,
                  address, printer_profile_id, last_test_at::text AS last_test_at
             FROM peripheral
            WHERE ($1::text IS NULL OR device_id = $1)
              AND ($2::text IS NULL OR outlet_id = $2)
            ORDER BY type, id`,
          [deviceId, outletId]
        );
        return rows.map((r) => ({
          id: r.id,
          deviceId: r.device_id,
          outletId: r.outlet_id,
          type: r.type,
          connection: r.connection,
          address: r.address,
          printerProfileId: r.printer_profile_id,
          lastTestAt: r.last_test_at,
        }));
      });
    },

    /**
     * `POST /peripherals` — mendaftarkan atau memperbarui satu peripheral.
     *
     * ## ⛔ Idempoten lewat PRIMARY KEY, dan itu SENGAJA berbeda dari yang lain
     *
     * `id` di-generate klien (ULID/UUIDv7, konvensi repo ini), dan pengiriman
     * ulang dengan `id` yang sama **memperbarui barisnya**, bukan ditolak
     * `ID_ALREADY_EXISTS`. Alasannya perilaku yang dimodelkan: kasir mengubah
     * profil printer perangkatnya berkali-kali sampai strukanya benar, dan
     * setiap perubahan adalah konfigurasi ULANG peripheral yang sama — bukan
     * peripheral baru. Tabel `peripheral` bukan tabel transaksional; invariant
     * #2 menjaga transaksi selesai dan katalog, bukan setelan perangkat.
     *
     * Yang tetap dijaga: setiap perubahan menulis `audit_event` baru, dan
     * `before` memuat keadaan sebelumnya. Riwayat konfigurasinya ada di sana,
     * bukan di barisnya.
     */
    async configurePeripheral(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const body = (req.body ?? {}) as PeripheralInput;

      const idempotencyKey = req.headers['idempotency-key'];
      if (typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '') {
        throw new HttpError(400, 'MISSING_IDEMPOTENCY_KEY', 'Header Idempotency-Key wajib.');
      }

      const id = teksWajib(body.id, 'id');
      const outletId = teksWajib(body.outletId, 'outletId');
      const type = teksWajib(body.type, 'type');
      const connection = teksWajib(body.connection, 'connection');

      // ⛔ Daftar TERTUTUP, dan pesannya MENYEBUT pilihannya. Nilai di luar
      // CHECK constraint akan ditolak database dengan galat yang tidak
      // menunjuk ke sebabnya sama sekali.
      if (!adalahJenisPeripheral(type)) {
        throw new HttpError(
          400,
          'VALIDATION_ERROR',
          `type harus salah satu dari: ${JENIS_PERIPHERAL.join(', ')}.`
        );
      }
      if (!adalahKoneksiPeripheral(connection)) {
        throw new HttpError(
          400,
          'VALIDATION_ERROR',
          `connection harus salah satu dari: ${KONEKSI_PERIPHERAL.join(', ')}.`
        );
      }

      const deviceId =
        typeof body.deviceId === 'string' && body.deviceId.trim() !== '' ? body.deviceId : null;
      const address =
        typeof body.address === 'string' && body.address.trim() !== '' ? body.address : null;
      const printerProfileId =
        typeof body.printerProfileId === 'string' && body.printerProfileId.trim() !== ''
          ? body.printerProfileId
          : null;

      const hlcValue =
        body.hlc === undefined ? hlc.tick() : hlc.update(BigInt(body.hlc as string));

      const hasil = await withTenantTransaction(pool, tenantId, async (client) => {
        const cached = await findIdempotencyKey(client, idempotencyKey);
        if (cached !== null && cached.completed) {
          return { kind: 'cached' as const, record: cached };
        }
        await assertUserVisible(client, actorId);
        // ⛔ `shift_open_close`, bukan operasi baru. `IA:65` memberi K-15 ke
        // "Manajer+", dan itu himpunan yang sama; operasi karangan membuat
        // matriks `spec-f` berhenti dapat dibaca berdampingan dengan kode.
        // `[ASUMSI]` yang dinyatakan.
        await assertBoleh(client, actorId, 'shift_open_close', 'mengonfigurasi peripheral');

        // FK klien-suplai ke tabel ber-`tenant_id` (temuan F1): FK PostgreSQL
        // TIDAK tunduk RLS, jadi `outlet_id` milik tenant lain akan tersimpan
        // dengan 201 tanpa ini.
        const outlet = await client.query('SELECT id FROM outlet WHERE id = $1', [outletId]);
        if (outlet.rowCount === 0) {
          throw new HttpError(404, 'OUTLET_NOT_FOUND', `Outlet ${outletId} tidak ditemukan.`);
        }
        if (deviceId !== null) {
          const device = await client.query('SELECT id FROM device WHERE id = $1', [deviceId]);
          if (device.rowCount === 0) {
            throw new HttpError(404, 'DEVICE_NOT_FOUND', `Perangkat ${deviceId} tidak ditemukan.`);
          }
        }
        if (printerProfileId !== null) {
          // ⛔ `printer_profile` DIKECUALIKAN dari RLS, jadi pemeriksaan ini
          // bukan soal tenant — ia soal profil yang tidak ada sama sekali. FK
          // akan menolaknya juga, tapi dengan galat yang menyebut nama
          // constraint alih-alih menyebut apa yang salah.
          const profil = await client.query('SELECT id FROM printer_profile WHERE id = $1', [
            printerProfileId,
          ]);
          if (profil.rowCount === 0) {
            throw new HttpError(
              404,
              'PRINTER_PROFILE_NOT_FOUND',
              `Profil printer ${printerProfileId} tidak ditemukan.`
            );
          }
        }

        const lama = await client.query<BarisPeripheral>(
          `SELECT id, tenant_id, device_id, outlet_id, type, connection,
                  address, printer_profile_id, last_test_at::text AS last_test_at
             FROM peripheral WHERE id = $1`,
          [id]
        );
        const sebelum = lama.rows[0] ?? null;

        await claimIdempotencyKey(client, {
          key: idempotencyKey,
          tenantId,
          requestHash: `${id}:${printerProfileId ?? ''}`,
        });

        await client.query(
          `INSERT INTO peripheral
             (id, tenant_id, device_id, outlet_id, type, connection, address, printer_profile_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (id) DO UPDATE SET
             device_id = EXCLUDED.device_id,
             outlet_id = EXCLUDED.outlet_id,
             type = EXCLUDED.type,
             connection = EXCLUDED.connection,
             address = EXCLUDED.address,
             printer_profile_id = EXCLUDED.printer_profile_id`,
          [id, tenantId, deviceId, outletId, type, connection, address, printerProfileId]
        );

        await recordAuditEvent(client, {
          id: randomUUID(),
          tenantId,
          outletId,
          deviceId,
          actorUserId: actorId,
          approverUserId: null,
          eventType: EVENT,
          entityType: 'peripheral',
          entityId: id,
          // ⛔ `null` keduanya, dan dinyatakan. Konfigurasi peripheral bukan
          // tindakan yang menuntut alasan dari daftar tertutup — berbeda dari
          // void, no-sale, dan kas manual, yang alasannya justru kontrolnya.
          reasonCode: null,
          reasonNote: null,
          // ⛔ `before` memuat keadaan SEBELUMNYA, dan `null` untuk pendaftaran
          // pertama. Audit yang menjawab "diubah dari apa" dengan nilai barunya
          // sendiri lolos setiap test yang hanya memeriksa kolomnya terisi.
          before:
            sebelum === null
              ? null
              : {
                  type: sebelum.type,
                  connection: sebelum.connection,
                  address: sebelum.address,
                  printerProfileId: sebelum.printer_profile_id,
                },
          after: { type, connection, address, printerProfileId },
          hlc: hlcValue,
          occurredAt: typeof body.occurredAt === 'string' ? body.occurredAt : null,
        });

        await insertOutboxEvent(client, {
          id: randomUUID(),
          tenantId,
          aggregateType: 'peripheral',
          aggregateId: id,
          eventType: 'peripheral.configured',
          payload: { id, type, connection, printerProfileId },
        });

        const jawab = {
          id,
          deviceId,
          outletId,
          type,
          connection,
          address,
          printerProfileId,
          // ⛔ Dinyatakan supaya klien tidak menebaknya dari status HTTP.
          // Keduanya 201 (lihat catatan pada handler), dan perbedaan
          // "baru didaftarkan" vs "dikonfigurasi ulang" adalah kalimat yang
          // berbeda di layar.
          baru: sebelum === null,
        };
        await completeIdempotencyKey(client, {
          key: idempotencyKey,
          responseStatus: 201,
          responseBody: jawab,
        });
        return { kind: 'baru' as const, jawab };
      });

      if (hasil.kind === 'cached') {
        return reply.code(hasil.record.responseStatus ?? 200).send(hasil.record.responseBody);
      }
      return reply.code(201).send(hasil.jawab);
    },
  };
}
