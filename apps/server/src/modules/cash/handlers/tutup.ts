import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { Pool } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import { getActorId, getTenantId } from '../../../tenant-context.ts';
import type { Hlc } from '../../../../../../packages/domain/src/hlc.ts';
import {
  butuhOtorisasiSelisih,
  saldoLaci,
} from '../../../../../../packages/domain/src/buku-kas.ts';
import { assertUserVisible, assertApproverVisible, bolehkahAktor } from '../../identity/index.ts';
import { bacaAmbangOutlet } from '../../tenancy/index.ts';
import { ambangBerlaku } from '../../../../../../packages/domain/src/ambang.ts';
import { recordAuditEvent } from '../../audit/index.ts';

/**
 * `POST /shifts/{shiftId}/close` — menutup shift di SERVER.
 *
 * ## ⛔ Ini yang membuka blokade B-04 dan B-05
 *
 * Sampai sekarang tutup kas hanya terjadi di perangkat, dan hasilnya tidak
 * pernah sampai ke server: jalur naik hanya mengenal empat jenis entitas, dan
 * `shift_closed` bukan salah satunya (`PENYELIDIKAN-b02-b04.md` §3). Akibatnya
 * setiap shift di server berstatus `open` selamanya, dengan `counted_amount`,
 * `difference`, dan `closed_at` permanen NULL.
 *
 * ## ⛔ Aturannya DIPAKAI BERSAMA dengan perangkat, bukan ditulis ulang
 *
 * `saldoLaci` dan `butuhOtorisasiSelisih` datang dari
 * `packages/domain/src/buku-kas.ts`. Ambang Rp 20.000 sebelumnya hanya hidup
 * di aplikasi kasir; dua salinan angka yang sama akan menyimpang, dan bentuk
 * penyimpangannya buruk — perangkat menuntut otorisasi untuk selisih yang
 * server terima diam-diam, pada shift yang sama.
 *
 * ## ⛔ Saldo seharusnya dari `cash_movement`, BUKAN dari `payment`
 *
 * `spec-d:14`. Cacat F3 yang tercatat di `CLAUDE.md` lahir persis dari sini:
 * saldo yang dihitung dari `payment` membuat refund tunai tidak pernah
 * mengurangi laci, kasir terlihat kurang sebesar nilai refund, dan tutup
 * kasnya menuntut otorisasi manajer untuk selisih yang tidak ada.
 *
 * `opening_float` DIKECUALIKAN dari penjumlahan dan dipakai sebagai saldo
 * awal — menjumlahkan keduanya menghitung modal awal dua kali, dan setiap
 * shift terlihat kelebihan sebesar modalnya sendiri.
 *
 * ## ⛔ Siapa yang boleh menutup
 *
 * Kasir yang membuka shift itu, atau manajer. Bukan kasir mana pun: shift
 * memegang uang yang dipertanggungjawabkan satu orang, dan kasir yang dapat
 * menutup shift rekannya dapat menyembunyikan selisihnya sendiri di sana.
 *
 * "Manajer" diturunkan dari `approve_cash_variance` — operasi yang matriks
 * `spec-f` berikan kepada owner, manajer area, dan manajer outlet, dan yang
 * memang berarti "berwenang atas selisih kas".
 */

interface BarisShift {
  id: string;
  outlet_id: string;
  device_id: string;
  status: string;
  opening_float: string;
  opened_by: string;
}

function assertJumlah(nilai: unknown, nama: string): bigint {
  if (nilai === undefined || nilai === null || nilai === '') {
    throw new HttpError(400, 'VALIDATION_ERROR', `${nama} wajib diisi.`);
  }
  let n: bigint;
  try {
    n = typeof nilai === 'bigint' ? nilai : BigInt(String(nilai).trim());
  } catch {
    throw new HttpError(400, 'VALIDATION_ERROR', `${nama} harus bilangan bulat rupiah.`);
  }
  if (n < 0n) {
    // Hitungan fisik tidak dapat negatif — laci tidak dapat berisi uang minus.
    // Selisihnya boleh negatif; yang dihitung tidak.
    throw new HttpError(400, 'VALIDATION_ERROR', `${nama} tidak boleh negatif.`);
  }
  return n;
}

export function createTutupHandlers(pool: Pool, hlc: Hlc): Record<string, unknown> {
  return {
    async closeShift(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const { shiftId } = req.params as { shiftId: string };
      const body = (req.body ?? {}) as {
        countedAmount?: string | number;
        varianceReasonCode?: string | null;
        varianceNote?: string | null;
      };
      const approverId = req.headers['x-approver-id'];

      const counted = assertJumlah(body.countedAmount, 'countedAmount');

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);

        // ⛔ `FOR UPDATE`: dua penutupan bersamaan atas shift yang sama akan
        // sama-sama membaca `open`, sama-sama menghitung selisih, dan yang
        // kedua menimpa percobaan yang pertama.
        const { rows } = await client.query<BarisShift>(
          `SELECT id, outlet_id, device_id, status, opening_float::text, opened_by
             FROM cash_drawer_shift WHERE id = $1 FOR UPDATE`,
          [shiftId]
        );
        if (rows.length === 0) {
          throw new HttpError(404, 'NOT_FOUND', `Shift ${shiftId} tidak ditemukan.`);
        }
        const shift = rows[0];

        if (shift.status === 'closed') {
          throw new HttpError(409, 'SHIFT_ALREADY_CLOSED', `Shift ${shiftId} sudah ditutup.`);
        }

        // ⛔ Pemilik shift ATAU manajer. Lihat catatan kepala berkas.
        const manajer = await bolehkahAktor(client, actorId, 'approve_cash_variance');
        if (shift.opened_by !== actorId && !manajer) {
          throw new HttpError(
            403,
            'FORBIDDEN',
            'Hanya kasir yang membuka shift ini atau manajer yang dapat menutupnya.'
          );
        }

        // Saldo seharusnya — `cash_movement`, tanpa `opening_float`.
        const { rows: gerak } = await client.query<{ delta: string }>(
          `SELECT delta::text FROM cash_movement
            WHERE shift_id = $1 AND type <> 'opening_float'`,
          [shiftId]
        );
        // ⛔ `saldoLaci` domain menerima `number`; nilainya di sini `bigint`.
        // Dijumlahkan sebagai bigint lebih dulu, lalu dibandingkan — rupiah
        // utuh melampaui 2^53 pada nilai yang masih mungkin di gudang uang,
        // dan pembulatan diam-diam di jalur kas adalah tepat yang dilarang.
        let expected = BigInt(shift.opening_float);
        for (const g of gerak) expected += BigInt(g.delta);

        // Pemeriksaan silang dengan fungsi domain, di skala yang aman untuk
        // `number`. Kalau keduanya berbeda, yang salah adalah salah satunya —
        // dan itu harus gagal keras, bukan diam.
        const kecil =
          expected <= BigInt(Number.MAX_SAFE_INTEGER) && expected >= -BigInt(Number.MAX_SAFE_INTEGER);
        if (kecil) {
          const lewatDomain = saldoLaci(
            Number(shift.opening_float),
            gerak.map((g) => Number(g.delta))
          );
          if (BigInt(lewatDomain) !== expected) {
            throw new Error(
              `Saldo laci berbeda antara perhitungan bigint (${expected}) dan domain (${lewatDomain}).`
            );
          }
        }

        const selisih = counted - expected;
        // ⛔ Ambang dibaca dari OUTLET, bukan dari konstanta.
        //
        // B-26 membuat angkanya dapat disetel merchant (`0033`), dan setelan
        // yang tidak dibaca di sini adalah layar pengaturan yang tidak
        // mengubah apa pun — bentuk kegagalan yang paling sulit dilihat,
        // karena layarnya menyimpan dengan benar dan menampilkannya kembali
        // dengan benar.
        //
        // `null` di kolomnya berarti bawaan; `ambangBerlaku` yang memutuskan,
        // dan ia memakai `??` supaya nol tetap berarti nol.
        const ambang = ambangBerlaku(await bacaAmbangOutlet(client, shift.outlet_id));
        const perluOtorisasi = kecil
          ? butuhOtorisasiSelisih(Number(selisih), Number(ambang.selisihKas))
          : true; // Selisih sebesar itu selalu menuntut manusia.

        const alasan =
          typeof body.varianceReasonCode === 'string' ? body.varianceReasonCode.trim() : '';

        if (perluOtorisasi) {
          if (alasan === '') {
            throw new HttpError(
              400,
              'VARIANCE_REASON_REQUIRED',
              'Selisih kas melewati ambang; alasan wajib diisi.'
            );
          }
          if (typeof approverId !== 'string' || approverId === '') {
            throw new HttpError(
              400,
              'APPROVER_REQUIRED',
              'Selisih kas melewati ambang; otorisasi manajer wajib.'
            );
          }
          if (approverId === actorId) {
            // Ditegakkan juga oleh CHECK di `audit_event`; ditolak lebih awal
            // di sini supaya pesannya menjelaskan sebabnya.
            throw new HttpError(
              400,
              'APPROVER_SAME_AS_ACTOR',
              'Penyetuju selisih tidak boleh orang yang sama dengan yang menghitung.'
            );
          }
          await assertApproverVisible(client, approverId);
        }

        // ⛔ Percobaan DITAMBAHKAN di SQL (`||`), tidak pernah dibaca lalu
        // ditulis ulang dari JavaScript. Dua alasan:
        //
        // 1. `spec-d`: "Kasir tidak dapat mengubah hitungan fisik setelah
        //    melihat selisih." Riwayat yang ditulis ulang seluruhnya adalah
        //    riwayat yang dapat kehilangan isinya karena satu kesalahan
        //    pemetaan — dan ia tidak membuktikan apa pun lagi.
        // 2. `pada` distempel `now()` DATABASE. Versi pertama berkas ini
        //    mengisinya dari Node lalu berniat "diperbaiki SQL"; jsonb tidak
        //    menstempel dirinya sendiri, dan hasilnya adalah waktu palsu yang
        //    terlihat sah.
        const { rows: hasil } = await client.query<{
          closed_at: string;
          jumlah_percobaan: number;
        }>(
          `UPDATE cash_drawer_shift
              SET status = 'closed',
                  counted_amount = $1,
                  expected_amount = $2,
                  difference = $3,
                  -- ⛔ Hitungan dikirim DUA KALI, sebagai $1 (bigint) dan $9
                  -- (text). Memakai $1 di kedua tempat membuat PostgreSQL
                  -- menyimpulkan dua tipe untuk satu parameter dan menolak
                  -- seluruh pernyataan: "inconsistent types deduced for
                  -- parameter $1" — 500, bukan 400, dan pesannya tidak
                  -- menyebut kolom mana pun.
                  count_attempts = COALESCE(count_attempts, '[]'::jsonb)
                                   || jsonb_build_object(
                                        'hitungan', $9::text,
                                        'pada', now(),
                                        'oleh', $4::text
                                      ),
                  variance_reason_code = $5,
                  variance_note = $6,
                  closed_by = $4,
                  approved_by = $7,
                  -- ⛔ Jam DATABASE, tidak pernah \`new Date()\` di Node.
                  closed_at = now()
            WHERE id = $8
        RETURNING closed_at::text, jsonb_array_length(count_attempts) AS jumlah_percobaan`,
          [
            counted.toString(),
            expected.toString(),
            selisih.toString(),
            actorId,
            alasan === '' ? null : alasan,
            typeof body.varianceNote === 'string' && body.varianceNote.trim() !== ''
              ? body.varianceNote.trim()
              : null,
            perluOtorisasi ? (approverId as string) : null,
            shiftId,
            counted.toString(),
          ]
        );

        await recordAuditEvent(client, {
          id: randomUUID(),
          tenantId,
          outletId: shift.outlet_id,
          deviceId: shift.device_id,
          actorUserId: actorId,
          approverUserId: perluOtorisasi ? (approverId as string) : null,
          eventType: 'shift_closed',
          entityType: 'cash_drawer_shift',
          entityId: shiftId,
          before: { status: shift.status, openingFloat: shift.opening_float },
          // ⛔ Uang sebagai STRING di jsonb. Cacat presisi yang PR #32
          // perbaiki di payload audit pembatalan lahir dari `Number()` di
          // tempat yang persis seperti ini.
          after: {
            status: 'closed',
            countedAmount: counted.toString(),
            expectedAmount: expected.toString(),
            difference: selisih.toString(),
          },
          reasonCode: alasan === '' ? null : alasan,
          reasonNote: typeof body.varianceNote === 'string' ? body.varianceNote : null,
          hlc: hlc.tick(),
        });

        // FR-F6 + `spec-f:293` (`cash_variance_approved`) — peristiwa
        // TERSENDIRI, bukan field di `shift_closed`.
        //
        // ⛔ Daftar `spec-f:293` menamainya sendiri, dan alasannya operasional:
        // laporan "siapa menyetujui selisih kas siapa" harus dapat dijawab
        // dengan menyaring satu jenis peristiwa. Menyembunyikannya sebagai
        // `approver_user_id` yang kadang terisi pada `shift_closed` berarti
        // setiap pembacanya harus tahu bahwa kolom itu bermakna berbeda
        // tergantung jenis barisnya.
        //
        // ⛔ Dua identitas WAJIB di sini (FR-F7), dan penyetuju yang sama
        // dengan aktor sudah ditolak di atas — ditegakkan lagi oleh CHECK di
        // database.
        if (perluOtorisasi) {
          await recordAuditEvent(client, {
            id: randomUUID(),
            tenantId,
            outletId: shift.outlet_id,
            deviceId: shift.device_id,
            actorUserId: actorId,
            approverUserId: approverId as string,
            eventType: 'cash_variance_approved',
            entityType: 'cash_drawer_shift',
            entityId: shiftId,
            after: { difference: selisih.toString() },
            reasonCode: alasan === '' ? null : alasan,
            reasonNote:
              typeof body.varianceNote === 'string' ? body.varianceNote : null,
            hlc: hlc.tick(),
          });
        }

        return {
          id: shiftId,
          status: 'closed',
          countedAmount: counted.toString(),
          expectedAmount: expected.toString(),
          difference: selisih.toString(),
          butuhOtorisasi: perluOtorisasi,
          approvedBy: perluOtorisasi ? (approverId as string) : null,
          closedAt: hasil[0]?.closed_at ?? null,
          jumlahPercobaan: hasil[0]?.jumlah_percobaan ?? 1,
        };
      });
    },
  };
}
