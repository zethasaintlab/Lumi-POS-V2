import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import type { KonfigPerangkat } from '../../../../packages/sync-client/src/perangkat.ts';
import { enqueue } from '../../../../packages/sync-client/src/enqueue.ts';
import {
  ALASAN_NO_SALE,
  AMBANG_NO_SALE,
  EVENT_NO_SALE,
  adalahAlasanNoSale,
  rencanaNoSale,
  type RencanaNoSale,
} from '../../../../packages/domain/src/no-sale.ts';
import { bacaAmbangOutlet } from './diskon.ts';
import { simpanHlc } from '../lokal/hlc.ts';
import type { Sesi } from '../identitas/login.ts';

/**
 * K-16 — buka laci (no-sale), sisi perangkat. FR-D7.
 *
 * ## ⛔ Berjalan PENUH tanpa jaringan
 *
 * `IA:66` menandai K-16 offline-capable, dan itu bukan kemewahan: menukar uang
 * pecahan adalah hal yang terjadi justru saat sibuk, dan sibuk adalah saat
 * jaringan paling sering putus. Ambangnya karena itu dihitung dari
 * `audit_event` **lokal** — yang sama dengan yang server hitung, karena
 * keduanya menghitung baris yang sama.
 *
 * ## ⛔ Yang dicatat adalah PERINTAH, bukan bukti laci terbuka
 *
 * `spec-d:231`: sinyalnya satu arah. Perangkat tanpa printer sama sekali tetap
 * mencatat pembukaannya — yang hilang hanya perintah fisiknya, dan itu
 * dikembalikan sebagai keadaan alih-alih didiamkan.
 *
 * ## ⛔ TIDAK menulis `cash_movement`
 *
 * No-sale tidak memindahkan uang. Movement bernilai nol akan membuat buku kas
 * — satu-satunya definisi saldo laci (`spec-d:14`) — memuat baris yang tidak
 * menjelaskan apa pun.
 */

export type HasilNoSale =
  | { status: 'tersimpan'; id: string; urutan: number; laciTerbuka: boolean }
  | { status: 'shift_tidak_terbuka' }
  | { status: 'alasan_tidak_berlaku'; pesan: string }
  | { status: 'butuh_penyetuju'; urutan: number }
  | { status: 'penyetuju_sama_dengan_aktor' };

/** Berapa kali laci sudah dibuka lewat no-sale dalam shift ini, dari lokal. */
export async function hitungNoSaleLokal(db: DbLokal, shiftId: string): Promise<number> {
  const baris = await db.getAll<{ n: number | bigint | string }>(
    `SELECT count(*) AS n FROM audit_event
      WHERE event_type = ? AND entity_type = 'cash_drawer_shift' AND entity_id = ?`,
    [EVENT_NO_SALE, shiftId]
  );
  return Number(baris[0]?.n ?? 0);
}

/**
 * Rencana no-sale untuk shift ini, dengan ambang OUTLET-nya.
 *
 * ⛔ Ambangnya dibaca dari `outlet`, bukan dari konstanta domain. B-26
 * membuatnya dapat disetel merchant, dan ia turun ke perangkat justru karena
 * buka laci berjalan tanpa jaringan — perangkat yang memakai bawaan sementara
 * server memakai angka yang merchant setel meminta PIN pada pembukaan yang
 * merchant janjikan bebas.
 *
 * Shift yang tidak ditemukan memakai bawaan: itu keadaan yang sudah ditolak
 * `bukaLaci` sesudahnya, dan menebak "tanpa ambang" di sini membuat kontrolnya
 * mati pada jalur yang paling tidak terduga.
 */
export async function rencanaNoSaleLokal(db: DbLokal, shiftId: string): Promise<RencanaNoSale> {
  const baris = await db.getAll<{ outlet_id: string }>(
    `SELECT outlet_id FROM cash_drawer_shift WHERE id = ?`,
    [shiftId]
  );
  const outletId = baris[0]?.outlet_id ?? null;
  const ambang =
    outletId === null ? AMBANG_NO_SALE : (await bacaAmbangOutlet(db, outletId)).noSale;
  return rencanaNoSale(await hitungNoSaleLokal(db, shiftId), ambang);
}

export async function bukaLaci({
  db,
  konfig,
  sesi,
  shiftId,
  alasan,
  approverId,
  bukaLaciFisik,
  waktu,
  idBaru,
  hlc,
}: {
  db: DbLokal;
  konfig: KonfigPerangkat;
  sesi: Sesi;
  shiftId: string;
  alasan: { kode: string; catatan: string | null };
  approverId: string | null;
  /**
   * Perintah fisik ke laci. Boleh gagal, dan boleh tidak ada sama sekali —
   * merchant tanpa printer adalah kasus yang sah (`cetak/aktif.ts`).
   */
  bukaLaciFisik?: () => Promise<boolean>;
  waktu: () => Date;
  idBaru: () => string;
  hlc: () => bigint;
}): Promise<HasilNoSale> {
  const shift = (
    await db.getAll<{ id: string; outlet_id: string; device_id: string; status: string }>(
      `SELECT id, outlet_id, device_id, status FROM cash_drawer_shift WHERE id = ?`,
      [shiftId]
    )
  )[0];
  // ⛔ Shift yang sudah ditutup menolak. Membuka laci setelah kas dihitung
  // berarti selisih yang sudah disetujui manajer tidak lagi menjelaskan
  // isinya.
  if (!shift || shift.status !== 'open') return { status: 'shift_tidak_terbuka' };

  if (!adalahAlasanNoSale(alasan.kode)) {
    return {
      status: 'alasan_tidak_berlaku',
      pesan: `Pilih alasan dari daftar (${ALASAN_NO_SALE.join(', ')}).`,
    };
  }

  const rencana = await rencanaNoSaleLokal(db, shiftId);
  if (rencana.butuhPenyetuju) {
    if (approverId === null || approverId === '') {
      return { status: 'butuh_penyetuju', urutan: rencana.urutan };
    }
    // ⛔ Diperiksa DI SINI juga, bukan hanya di dialog otorisasi.
    // `audit_event` punya CHECK yang menolaknya di server; kalau perangkat
    // meloloskannya, kasir baru tahu setelah antrean terkuras.
    if (approverId === sesi.userId) return { status: 'penyetuju_sama_dengan_aktor' };
  }

  const id = idBaru();
  const occurredAt = waktu().toISOString();
  const hlcValue = hlc();

  await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO audit_event
         (id, tenant_id, outlet_id, device_id, actor_user_id, approver_user_id,
          event_type, entity_type, entity_id, reason_code, reason_note, occurred_at, hlc)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'cash_drawer_shift', ?, ?, ?, ?, ?)`,
      [
        id,
        konfig.tenantId,
        shift.outlet_id,
        shift.device_id,
        sesi.userId,
        rencana.butuhPenyetuju ? approverId : null,
        EVENT_NO_SALE,
        shiftId,
        alasan.kode,
        alasan.catatan,
        occurredAt,
        Number(hlcValue),
      ]
    );

    // ⛔ Keadaan HLC ditulis DI DALAM transaksi. Di luarnya ada jendela tempat
    // perangkat dapat mati setelah event ter-commit tapi sebelum `hlc_teks`
    // tersimpan, dan boot berikutnya dapat menghasilkan HLC yang sudah
    // dipakai (pelanggaran I10 tanpa error).
    await simpanHlc(tx, hlcValue);

    await enqueue(tx, {
      id: idBaru(),
      entityType: 'no_sale',
      // `entity_id` adalah SHIFT: rutenya bersarang di bawahnya, dan
      // ambangnya dihitung per shift.
      entityId: shiftId,
      operation: 'create',
      payload: {
        id,
        reasonCode: alasan.kode,
        reasonNote: alasan.catatan,
        hlc: hlcValue.toString(),
        occurredAt,
      },
      idempotencyKey: id,
      createdAt: occurredAt,
      actorId: sesi.userId,
      // ⛔ Penyetuju ikut, dan HANYA bila ambangnya terlewati — nilai yang
      // sama persis dengan yang ditulis ke `audit_event` di atas.
      //
      // Tanpa ini, pembukaan laci KEEMPAT dan seterusnya yang dilakukan
      // offline dijawab `403 APPROVAL_REQUIRED` lalu berhenti permanen di
      // antrean: laci sudah terbuka, PIN manajer sudah dimasukkan, dan
      // servernya tidak pernah tahu. Bentuk cacat yang SAMA dengan refund
      // offline (`tests/ordering/refund-offline-relay.test.js`) — dan yang
      // kedua ini ditemukan justru karena yang pertama menghasilkan aturan.
      approverId: rencana.butuhPenyetuju ? approverId : null,
    });
  });

  // ⛔ Perintah fisik SETELAH commit, dan kegagalannya tidak pernah
  // me-rollback catatannya. Aturan yang sama dengan invariant #3 untuk cetak:
  // laci yang tidak terbuka adalah masalah yang dapat diselesaikan dengan
  // kunci; catatan yang hilang tidak dapat dipulihkan.
  let laciTerbuka = false;
  if (bukaLaciFisik) {
    try {
      laciTerbuka = await bukaLaciFisik();
    } catch {
      laciTerbuka = false;
    }
  }

  return { status: 'tersimpan', id, urutan: rencana.urutan, laciTerbuka };
}
