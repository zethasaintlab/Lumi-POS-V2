import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import type { KonfigPerangkat } from '../../../../packages/sync-client/src/perangkat.ts';
import { enqueue } from '../../../../packages/sync-client/src/enqueue.ts';
import { simpanHlc } from '../lokal/hlc.ts';
import { counterpartUntuk, deltaBertanda } from '../../../../packages/domain/src/buku-kas.ts';
import { tanggalBisnis } from '../../../../packages/domain/src/tanggal-bisnis.ts';
import type { Sesi } from '../identitas/login.ts';

/**
 * K-02 — buka shift offline (FR-D1).
 *
 * `spec-d:3` menyebutnya pembeda utama produk: "Odoo tidak dapat membuka sesi
 * POS baru tanpa internet; Toast tidak dapat login saat offline. Skenario
 * nyatanya: listrik dan internet mati semalam, pagi hari kasir tidak dapat
 * mulai berjualan."
 *
 * ## ⛔ Penulisan entitas bisnis PERTAMA yang dilakukan aplikasi
 *
 * Sebelum berkas ini, satu-satunya yang pernah menyentuh `outbox_local` adalah
 * berkas harness. Jalur naik lewat aplikasi sungguhan — tulis lokal → outbox →
 * relay → REST idempoten → server — belum pernah hidup sama sekali.
 *
 * Seluruh I/O lewat port `DbLokal`; waktu dan id di-inject. Itu prasyarat DST
 * (`CLAUDE.md`), dan ia juga yang membuat tanggal bisnis dini hari dapat diuji
 * tanpa menunggu pukul satu pagi.
 */

export interface ShiftAktif {
  id: string;
  businessDate: string;
  openingFloat: number;
}

export type HasilBukaShift =
  | { status: 'terbuka'; shift: ShiftAktif }
  | { status: 'sudah_ada'; shiftId: string }
  | { status: 'outlet_belum_siap'; pesan: string }
  | { status: 'saldo_tidak_valid'; pesan: string };

interface BarisOutlet {
  id: string;
  timezone: string;
  business_day_ends_at: string;
}

interface BarisShift {
  id: string;
  business_date: string;
  opening_float: number;
}

/**
 * Shift `open` milik SATU perangkat.
 *
 * Per DEVICE, bukan per outlet (`spec-d`): kafe dengan dua kasir punya dua
 * shift terbuka bersamaan, dan itu normal.
 */
export async function shiftAktif(db: DbLokal, deviceId: string): Promise<ShiftAktif | null> {
  const baris = await db.getAll<BarisShift>(
    `SELECT id, business_date, opening_float FROM cash_drawer_shift
      WHERE device_id = ? AND status = 'open'`,
    [deviceId]
  );
  const b = baris[0];
  if (!b) return null;
  return { id: b.id, businessDate: b.business_date, openingFloat: b.opening_float };
}

const MAKS_RUPIAH = Number.MAX_SAFE_INTEGER;

/**
 * Saldo awal laci.
 *
 * Aturannya sama dengan `assertOpeningFloatValid` di server, dan itu
 * disengaja: klien yang menerima nilai yang server tolak akan menyimpan shift
 * lokal yang tidak akan pernah naik, dan kasir baru tahu berjam-jam kemudian
 * lewat indikator merah yang tidak menjelaskan apa-apa.
 */
export function validasiSaldoAwal(nilai: unknown): string | null {
  if (typeof nilai !== 'number' || Number.isNaN(nilai)) return 'Saldo awal harus berupa angka.';
  if (!Number.isInteger(nilai)) return 'Saldo awal harus rupiah bulat, tanpa desimal.';
  if (nilai < 0) return 'Saldo awal tidak boleh negatif.';
  if (nilai > MAKS_RUPIAH) return 'Saldo awal terlalu besar.';
  return null;
}

export async function bukaShift({
  db,
  konfig,
  sesi,
  saldoAwal,
  waktu,
  idBaru,
  idOutbox,
  hlc,
}: {
  db: DbLokal;
  konfig: KonfigPerangkat;
  sesi: Sesi;
  saldoAwal: number;
  waktu: () => Date;
  idBaru: () => string;
  idOutbox: () => string;
  hlc: () => bigint;
}): Promise<HasilBukaShift> {
  const galatSaldo = validasiSaldoAwal(saldoAwal);
  if (galatSaldo) return { status: 'saldo_tidak_valid', pesan: galatSaldo };

  const sudah = await shiftAktif(db, konfig.deviceId);
  if (sudah) return { status: 'sudah_ada', shiftId: sudah.id };

  const outlet = (
    await db.getAll<BarisOutlet>(
      `SELECT id, timezone, business_day_ends_at FROM outlet WHERE id = ?`,
      [konfig.outletId]
    )
  )[0];

  if (!outlet) {
    // ⛔ Gagal TERANG, bukan menebak.
    //
    // Tanpa `timezone` dan `business_day_ends_at`, tanggal bisnisnya harus
    // ditebak — dan tebakan yang salah menaruh seluruh penjualan hari itu di
    // tanggal yang keliru, lalu bentrok dengan
    // `UNIQUE(device_id, business_date, sequence)` begitu shift yang benar
    // dibuka. Kegagalan itu muncul jauh dari sebabnya.
    return {
      status: 'outlet_belum_siap',
      pesan:
        'Konfigurasi outlet belum sampai ke perangkat ini. Hubungkan ke internet sekali untuk mengunduhnya.',
    };
  }

  const sekarang = waktu();
  const businessDate = tanggalBisnis(sekarang, outlet.timezone, outlet.business_day_ends_at);
  const shiftId = idBaru();
  const occurredAt = sekarang.toISOString();

  // Invariant #1 berlaku juga di klien: shift yang tersimpan tanpa item
  // outbox tidak akan pernah sampai ke server, dan item outbox tanpa shift
  // mengirim baris yang tidak ada di perangkat.
  const hlcValue = hlc();

  await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO cash_drawer_shift
         (id, tenant_id, outlet_id, device_id, business_date, status, opening_float, opened_by, opened_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
      [
        shiftId,
        konfig.tenantId,
        konfig.outletId,
        konfig.deviceId,
        businessDate,
        saldoAwal,
        sesi.userId,
        occurredAt,
      ]
    );

    // Buku kas — modal awal adalah movement, bukan hanya kolom di shift
    // (`spec-d:189`). Tanpanya laci hanya dapat direkonstruksi bila seseorang
    // juga membaca `cash_drawer_shift.opening_float` dari tabel lain, dan
    // buku kas berhenti menjadi catatan yang lengkap.
    //
    // ⛔ `saldoSeharusnya` MENGECUALIKAN tipe ini dan memakai kolom shift
    // secara langsung. Menjumlahkan keduanya akan menghitung modal awal DUA
    // KALI — setiap shift akan terlihat kelebihan sebesar modalnya sendiri.
    await tx.execute(
      `INSERT INTO cash_movement
         (id, shift_id, type, delta, counterpart_type, created_by, occurred_at, hlc)
       VALUES (?, ?, 'opening_float', ?, ?, ?, ?, ?)`,
      [
        idBaru(),
        shiftId,
        deltaBertanda('opening_float', saldoAwal),
        counterpartUntuk('opening_float'),
        sesi.userId,
        occurredAt,
        Number(hlcValue),
      ]
    );

    // Di dalam transaksi yang sama — sama seperti penjualan. Di luarnya ada
    // jendela tempat perangkat dapat mati setelah shift ter-commit tapi
    // sebelum HLC tersimpan, dan tick berikutnya dapat menghasilkan nilai
    // yang sudah dipakai.
    await simpanHlc(tx, hlcValue);

    await enqueue(tx, {
      id: idOutbox(),
      entityType: 'shift',
      entityId: shiftId,
      operation: 'create',
      // Bentuknya PERSIS `required` di `POST /shifts`. Payload yang tidak
      // cocok baru ketahuan saat relay mengirimnya — dan item itu akan
      // membakar hitungan percobaannya sampai `failed` permanen.
      payload: {
        id: shiftId,
        outletId: konfig.outletId,
        deviceId: konfig.deviceId,
        businessDate,
        openingFloat: saldoAwal,
      },
      // Idempotency-Key = id shift. Retry membawa kunci yang sama, dan server
      // menjawab respons aslinya alih-alih membuka shift kedua.
      idempotencyKey: shiftId,
      createdAt: occurredAt,
      // Aktor DIBEKUKAN sekarang. Antrean dapat terkuras setelah pergantian
      // shift; membacanya saat pengiriman akan mencatat shift Sari atas nama
      // Budi.
      actorId: sesi.userId,
    });
  });

  return {
    status: 'terbuka',
    shift: { id: shiftId, businessDate, openingFloat: saldoAwal },
  };
}
