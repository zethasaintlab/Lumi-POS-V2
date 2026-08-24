import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import type { KonfigPerangkat } from '../../../../packages/sync-client/src/perangkat.ts';
import { enqueue } from '../../../../packages/sync-client/src/enqueue.ts';
import {
  periksaKas,
  tipeMovement,
  type ArahKas,
} from '../../../../packages/domain/src/kas-manual.ts';
import { simpanHlc } from '../lokal/hlc.ts';
import type { Sesi } from '../identitas/login.ts';

/**
 * FR-D5 di perangkat — kas masuk & kas keluar, offline.
 *
 * ## ⛔ Kenapa ia harus ada di PERANGKAT, bukan hanya di back-office
 *
 * Uang keluar dari laci di konter, saat shift berjalan, dan sering saat
 * internet mati — itu justru saat orang membayar pemasok tunai. Fitur yang
 * hanya ada di back-office berarti kasir menunggu sampai malam untuk
 * mencatatnya, dan tutup kas terjadi sebelum itu.
 *
 * Saldo laci adalah `saldo_awal + SUM(cash_movement.delta)` (`spec-d:14`), dan
 * `saldoSeharusnya` di `kas/tutup.ts` membacanya dari tabel lokal — jadi baris
 * yang ditulis di sini langsung menjelaskan selisih yang tanpanya menuntut
 * otorisasi manajer.
 *
 * ## ⛔ Aturannya dari DOMAIN, dan server memakai fungsi yang sama
 *
 * `periksaKas` menurunkan tanda `delta`, memeriksa alasan, dan menolak nol.
 * Aturan yang hanya hidup di server berarti kasir mengetik jumlah nol, barisnya
 * tersimpan lokal, lalu berhenti `gagal-permanen` di antrean berjam-jam
 * kemudian — bentuk cacat yang sama persis dengan refund offline
 * (`CLAUDE.md`).
 *
 * ## ⛔ Tanpa PIN manajer
 *
 * Ditiru dari keputusan void 1 Agustus 2026. Lihat
 * `packages/domain/src/kas-manual.ts` untuk alasannya.
 */

export type HasilKasManual =
  | { status: 'tercatat'; id: string; delta: bigint }
  | { status: 'shift_tidak_terbuka' }
  | { status: 'ditolak'; kode: string; pesan: string };

export async function catatKasManual({
  db,
  konfig,
  sesi,
  shiftId,
  arah,
  jumlah,
  alasan,
  waktu,
  idBaru,
  hlc,
}: {
  db: DbLokal;
  konfig: KonfigPerangkat;
  sesi: Sesi;
  shiftId: string;
  arah: ArahKas;
  /** Rupiah utuh POSITIF. Arahnya dinyatakan `arah`, bukan tandanya. */
  jumlah: bigint;
  alasan: { kode: string; catatan: string | null };
  waktu: () => Date;
  idBaru: () => string;
  hlc: () => bigint;
}): Promise<HasilKasManual> {
  const shift = (
    await db.getAll<{ id: string; outlet_id: string; device_id: string; status: string }>(
      `SELECT id, outlet_id, device_id, status FROM cash_drawer_shift WHERE id = ?`,
      [shiftId]
    )
  )[0];
  // ⛔ Shift yang sudah ditutup menolak, alasan yang sama dengan no-sale:
  // saldo dan selisihnya sudah dihitung dan disetujui, dan baris baru
  // sesudahnya mengubah angka yang seseorang sudah tanda tangani.
  if (!shift || shift.status !== 'open') return { status: 'shift_tidak_terbuka' };

  const periksa = periksaKas({ arah, jumlah, alasan: alasan.kode, catatan: alasan.catatan });
  if (!periksa.ok) return { status: 'ditolak', kode: periksa.kode, pesan: periksa.pesan };

  const id = idBaru();
  const occurredAt = waktu().toISOString();
  const hlcValue = hlc();

  await db.transaction(async (tx) => {
    // ⛔ Movement DAN auditnya dalam satu transaksi. Uang yang berpindah tanpa
    // siapa pun bertanggung jawab adalah persis yang FR-D5 ada untuk mencegah.
    await tx.execute(
      `INSERT INTO cash_movement
         (id, shift_id, type, delta, order_id, counterpart_type,
          reason_code, note, created_by, occurred_at, hlc)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        shiftId,
        tipeMovement(arah),
        // ⛔ `delta` BERTANDA, dan tandanya dari domain. Klien yang
        // mengirimkan tanda sendiri akan mengurangi laci yang seharusnya
        // bertambah, dan angkanya benar sementara arahnya tidak.
        Number(periksa.delta),
        periksa.counterpart,
        alasan.kode,
        alasan.catatan,
        sesi.userId,
        occurredAt,
        Number(hlcValue),
      ]
    );

    await tx.execute(
      `INSERT INTO audit_event
         (id, tenant_id, outlet_id, device_id, actor_user_id, approver_user_id,
          event_type, entity_type, entity_id, reason_code, reason_note, occurred_at, hlc)
       VALUES (?, ?, ?, ?, ?, NULL, ?, 'cash_movement', ?, ?, ?, ?, ?)`,
      [
        idBaru(),
        konfig.tenantId,
        shift.outlet_id,
        shift.device_id,
        sesi.userId,
        periksa.eventType,
        id,
        alasan.kode,
        alasan.catatan,
        occurredAt,
        Number(hlcValue),
      ]
    );

    // ⛔ Keadaan HLC ditulis DI DALAM transaksi. Di luarnya ada jendela tempat
    // perangkat dapat mati setelah barisnya ter-commit tapi sebelum `hlc_teks`
    // tersimpan, dan boot berikutnya dapat menghasilkan HLC yang sudah dipakai
    // (pelanggaran I10 tanpa error).
    await simpanHlc(tx, hlcValue);

    await enqueue(tx, {
      id: idBaru(),
      entityType: 'cash_movement',
      // `entity_id` adalah SHIFT: rutenya bersarang di bawahnya, dan saldo
      // laci dihitung per shift. Pola yang sama dengan no-sale.
      entityId: shiftId,
      operation: 'create',
      payload: {
        id,
        arah,
        // ⛔ STRING, dan POSITIF. Server menurunkan tandanya sendiri lewat
        // `periksaKas` yang sama — dua tempat yang menurunkan tanda akan
        // menyimpang, dan yang menyimpang menggandakan atau membatalkan
        // pergerakan uangnya.
        jumlah: jumlah.toString(),
        reasonCode: alasan.kode,
        reasonNote: alasan.catatan,
        hlc: hlcValue.toString(),
        occurredAt,
      },
      idempotencyKey: id,
      createdAt: occurredAt,
      actorId: sesi.userId,
    });
  });

  return { status: 'tercatat', id, delta: periksa.delta };
}
