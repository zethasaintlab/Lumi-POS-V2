import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import { enqueue } from '../../../../packages/sync-client/src/enqueue.ts';
import { simpanHlc } from '../lokal/hlc.ts';

/**
 * K-12 Tutup Kas + K-13 Laporan Shift (FR-D2, FR-D3, FR-D4, FR-D8).
 *
 * ## ⛔ Kontrol yang menentukan bentuk seluruh modul ini
 *
 * `spec-d` FR-D2: kasir memasukkan hitungan fisik **sebelum** sistem
 * menampilkan angka terhitung. *"Ini kontrol, bukan preferensi UX — kasir yang
 * melihat angka target akan menghitung mundur ke angka itu."*
 *
 * Karena itu `ringkasanSebelumHitung` dan `catatHitungan` adalah dua fungsi
 * terpisah, dan yang pertama TIDAK PERNAH mengembalikan saldo terhitung —
 * bukan mengembalikannya sebagai `null`, melainkan tidak memuat field-nya
 * sama sekali. Field yang ada tapi kosong tetap dapat dibaca dari devtools,
 * dan itu sama saja.
 *
 * ## ⛔ BATAS YANG HARUS DINYATAKAN, bukan dipura-purakan
 *
 * Spec menuntut angka terhitung *"tidak dikirim ke klien"* lewat endpoint
 * terpisah. Saat **offline** itu mustahil: seluruh datanya sudah ada di
 * perangkat, dan siapa pun yang dapat membaca SQLite lokal dapat menghitung
 * sendiri. Menyembunyikannya di UI tidak mengubah itu.
 *
 * Yang tersisa dan benar-benar berlaku adalah kontrol **audit**: setiap
 * hitungan tercatat sebagai percobaan, percobaan pertama tercatat sebelum
 * angka mana pun terungkap, dan riwayatnya tidak dapat ditimpa. Kasir yang
 * "memperbaiki" hitungannya meninggalkan jejak — dan itu yang membuat laporan
 * exception Modul G berguna.
 *
 * Perlindungan endpoint-terpisah tetap berlaku pada jalur ONLINE, di server.
 */

/** `spec-d` FR-D4. Inklusif — selisih tepat sebesar ini MEMICU otorisasi. */
export const AMBANG_SELISIH = 20000;

export const ALASAN_SELISIH = [
  { kode: 'kelebihan_kembalian', label: 'Kelebihan kembalian' },
  { kode: 'kekurangan_kembalian', label: 'Kekurangan kembalian' },
  { kode: 'uang_palsu', label: 'Uang palsu' },
  { kode: 'kesalahan_hitung', label: 'Kesalahan hitung' },
  { kode: 'belum_teridentifikasi', label: 'Belum teridentifikasi' },
  { kode: 'lainnya', label: 'Lainnya' },
] as const;

interface BarisShift {
  id: string;
  tenant_id: string;
  outlet_id: string;
  device_id: string;
  business_date: string;
  status: string;
  opening_float: number;
  opened_by: string | null;
  opened_at: string | null;
  counted_amount: number | null;
  expected_amount: number | null;
  difference: number | null;
  count_attempts: string | null;
  closed_by: string | null;
  approved_by: string | null;
  closed_at: string | null;
  variance_reason_code: string | null;
}

interface BarisPembayaran {
  method: string;
  amount: number;
  /** `1` masuk, `-1` keluar. */
  arah: number;
}

async function ambilShift(db: DbLokal, shiftId: string): Promise<BarisShift | null> {
  const baris = await db.getAll<BarisShift>(
    `SELECT id, tenant_id, outlet_id, device_id, business_date, status, opening_float, opened_by, opened_at,
            counted_amount, expected_amount, difference, count_attempts,
            closed_by, approved_by, closed_at, variance_reason_code
       FROM cash_drawer_shift WHERE id = ?`,
    [shiftId]
  );
  return baris[0] ?? null;
}

/**
 * Pembayaran TUNAI shift ini, beserta arahnya.
 *
 * Hanya tunai: QRIS dan kartu tidak masuk laci, jadi tidak boleh masuk saldo
 * seharusnya. Memasukkannya membuat setiap shift terlihat kekurangan sebesar
 * seluruh penjualan non-tunai.
 */
async function pembayaranTunai(db: DbLokal, shiftId: string): Promise<BarisPembayaran[]> {
  return db.getAll<BarisPembayaran>(
    `SELECT p.method, p.amount,
            CASE WHEN o.status = 'voided' THEN -1 ELSE 1 END AS arah
       FROM payment p
       JOIN "order" o ON o.id = p.order_id
      WHERE o.shift_id = ?`,
    [shiftId]
  );
}

export interface RingkasanAwal {
  shiftId: string;
  businessDate: string;
  saldoAwal: number;
  jumlahTransaksi: number;
  /**
   * ⛔ TUNAI hanya membawa JUMLAH transaksi, tanpa total.
   *
   * `total: null` untuk `cash` bukan kelalaian. Kasir tahu saldo awal — ia
   * yang memasukkannya saat buka shift — jadi menampilkan total tunai berarti
   * menampilkan saldo seharusnya lewat satu penjumlahan. Itu persis yang
   * FR-D2 cegah: *"kasir yang melihat angka target akan menghitung mundur ke
   * angka itu."*
   *
   * `spec-d` menulis layar awal memuat "rincian per metode pembayaran", dan
   * pembacaan harfiahnya membocorkan angkanya. Yang dipertahankan adalah
   * MAKSUD aturannya; metode non-tunai tetap bertotal, karena keduanya tidak
   * masuk laci dan tidak membantu menebak isinya.
   *
   * `[KEPUTUSAN]` — pembacaan spec, bukan spec itu sendiri.
   */
  perMetode: { metode: string; jumlah: number; total: number | null }[];
}

/**
 * Yang boleh dilihat kasir SEBELUM menghitung (FR-D2).
 *
 * ⛔ Bentuk kembaliannya sengaja TIDAK memuat field saldo terhitung maupun
 * selisih — bukan `null`, melainkan tidak ada. Ada test yang memeriksa
 * `Object.keys`, karena field kosong tetap terbaca dari devtools.
 */
export async function ringkasanSebelumHitung(
  db: DbLokal,
  shiftId: string
): Promise<RingkasanAwal | null> {
  const shift = await ambilShift(db, shiftId);
  if (!shift) return null;

  const bayar = await pembayaranTunai(db, shiftId);
  const perMetode = new Map<string, { jumlah: number; total: number }>();
  for (const b of bayar) {
    const kini = perMetode.get(b.method) ?? { jumlah: 0, total: 0 };
    kini.jumlah += 1;
    kini.total += b.amount * b.arah;
    perMetode.set(b.method, kini);
  }

  return {
    shiftId: shift.id,
    businessDate: shift.business_date,
    saldoAwal: shift.opening_float,
    jumlahTransaksi: bayar.length,
    perMetode: [...perMetode].map(([metode, v]) => ({
      metode,
      jumlah: v.jumlah,
      // Lihat catatan di `RingkasanAwal.perMetode`.
      total: metode === 'cash' ? null : v.total,
    })),
  };
}

export function hitungSaldoSeharusnya({
  saldoAwal,
  tunaiMasuk,
  tunaiKeluar,
}: {
  saldoAwal: number;
  tunaiMasuk: number;
  tunaiKeluar: number;
}): number {
  return saldoAwal + tunaiMasuk - tunaiKeluar;
}

async function saldoSeharusnya(db: DbLokal, shift: BarisShift): Promise<number> {
  const bayar = await pembayaranTunai(db, shift.id);
  let masuk = 0;
  let keluar = 0;
  for (const b of bayar) {
    if (b.method !== 'cash') continue;
    if (b.arah > 0) masuk += b.amount;
    else keluar += b.amount;
  }
  return hitungSaldoSeharusnya({ saldoAwal: shift.opening_float, tunaiMasuk: masuk, tunaiKeluar: keluar });
}

export interface Percobaan {
  hitungan: number;
  pada: string;
}

/**
 * Mencatat satu percobaan hitungan, lalu mengembalikan selisihnya.
 *
 * ⛔ Percobaan DITAMBAHKAN, tidak pernah menimpa. `spec-d`: "Kasir tidak dapat
 * mengubah hitungan fisik setelah melihat selisih. Untuk mengoreksi, kasir
 * memasukkan hitungan ulang yang tercatat sebagai PERCOBAAN KEDUA di audit
 * trail." Riwayat yang dapat ditimpa adalah riwayat yang tidak membuktikan
 * apa pun.
 */
export async function catatHitungan({
  db,
  shiftId,
  hitungan,
  waktu,
}: {
  db: DbLokal;
  shiftId: string;
  hitungan: number;
  waktu: () => Date;
}): Promise<{ percobaan: number; selisih: number; saldoSeharusnya: number }> {
  const shift = await ambilShift(db, shiftId);
  if (!shift) throw new Error(`Shift ${shiftId} tidak ditemukan.`);

  const seharusnya = await saldoSeharusnya(db, shift);
  const riwayat: Percobaan[] = shift.count_attempts ? (JSON.parse(shift.count_attempts) as Percobaan[]) : [];
  riwayat.push({ hitungan, pada: waktu().toISOString() });

  await db.execute(`UPDATE cash_drawer_shift SET count_attempts = ? WHERE id = ?`, [
    JSON.stringify(riwayat),
    shiftId,
  ]);

  return { percobaan: riwayat.length, selisih: hitungan - seharusnya, saldoSeharusnya: seharusnya };
}

/** `spec-d` FR-D4 — inklusif, dan berlaku untuk kelebihan maupun kekurangan. */
export function butuhOtorisasiSelisih(selisih: number): boolean {
  return Math.abs(selisih) >= AMBANG_SELISIH;
}

export type HasilTutup =
  | { status: 'tertutup'; selisih: number; saldoSeharusnya: number }
  | { status: 'tidak_ditemukan' }
  | { status: 'sudah_tertutup' }
  | { status: 'butuh_otorisasi'; selisih: number }
  | { status: 'butuh_alasan'; selisih: number }
  | { status: 'penyetuju_sama_dengan_aktor' };

export async function tutupKas({
  db,
  shiftId,
  hitungan,
  sesi,
  approverId,
  alasan,
  waktu,
  idBaru,
  hlc,
}: {
  db: DbLokal;
  shiftId: string;
  hitungan: number;
  sesi: { userId: string };
  approverId: string | null;
  alasan: { kode: string; catatan: string | null } | null;
  waktu: () => Date;
  idBaru: () => string;
  hlc: () => bigint;
}): Promise<HasilTutup> {
  const shift = await ambilShift(db, shiftId);
  if (!shift) return { status: 'tidak_ditemukan' };
  // Shift yang sudah tertutup TIDAK dapat dibuka ulang (`spec-d` state
  // machine: `CLOSED` tidak punya transisi keluar).
  if (shift.status === 'closed') return { status: 'sudah_tertutup' };

  const seharusnya = await saldoSeharusnya(db, shift);
  const selisih = hitungan - seharusnya;

  if (butuhOtorisasiSelisih(selisih)) {
    if (!approverId) return { status: 'butuh_otorisasi', selisih };
    if (!alasan) return { status: 'butuh_alasan', selisih };
    // ⛔ `spec-f:91`: "Kasir yang menghitung laci TIDAK BOLEH menjadi orang
    // yang menyetujui selisihnya." Ditegakkan di perangkat DAN oleh CHECK di
    // `audit_event`; di sini supaya kasir tahu sebelum kas ditutup, bukan
    // setelah antrean gagal terkirim.
    if (approverId === sesi.userId) return { status: 'penyetuju_sama_dengan_aktor' };
  }

  const closedAt = waktu().toISOString();
  const hlcValue = hlc();

  await db.transaction(async (tx) => {
    await tx.execute(
      `UPDATE cash_drawer_shift
          SET status = 'closed', counted_amount = ?, expected_amount = ?, difference = ?,
              variance_reason_code = ?, variance_note = ?, closed_by = ?, approved_by = ?, closed_at = ?
        WHERE id = ?`,
      [
        // FR-D3: ketiganya disimpan TERPISAH. `difference` ikut disimpan agar
        // laporan tidak menghitung ulang — dan agar laporan yang dicetak
        // ulang berbulan-bulan kemudian menunjukkan angka yang sama.
        hitungan, seharusnya, selisih,
        alasan?.kode ?? null, alasan?.catatan ?? null,
        sesi.userId, approverId, closedAt, shiftId,
      ]
    );

    await tx.execute(
      // ⛔ tenant/outlet/device dibaca dari BARIS SHIFT, bukan diisi NULL.
      // Ketiganya `NOT NULL` di `audit_event`, dan versi pertama berkas ini
      // mengisinya NULL — lolos seluruh test karena fake `DbLokal` tidak
      // menegakkan constraint, lalu gagal keras di SQLite sungguhan.
      // Bentuk kegagalan yang sama dengan `ON CONFLICT` dulu: hijau di
      // `node:sqlite`, merah di `wa-sqlite`.
      `INSERT INTO audit_event
         (id, tenant_id, outlet_id, device_id, actor_user_id, approver_user_id,
          event_type, entity_type, entity_id, reason_code, reason_note, occurred_at, hlc)
       VALUES (?, ?, ?, ?, ?, ?, 'shift_closed', 'cash_drawer_shift', ?, ?, ?, ?, ?)`,
      [
        idBaru(), shift.tenant_id, shift.outlet_id, shift.device_id,
        sesi.userId, approverId, shiftId,
        alasan?.kode ?? null, alasan?.catatan ?? null, closedAt, Number(hlcValue),
      ]
    );

    await enqueue(tx, {
      id: idBaru(),
      entityType: 'shift',
      entityId: shiftId,
      operation: 'close',
      payload: {
        id: shiftId,
        countedAmount: hitungan,
        ...(alasan ? { varianceReasonCode: alasan.kode, varianceNote: alasan.catatan } : {}),
        ...(approverId ? { approvedBy: approverId } : {}),
        closedAt,
      },
      idempotencyKey: `${shiftId}-close`,
      createdAt: closedAt,
      actorId: sesi.userId,
    });

    await simpanHlc(tx, hlcValue);
  });

  return { status: 'tertutup', selisih, saldoSeharusnya: seharusnya };
}

export interface LaporanShift {
  shiftId: string;
  businessDate: string;
  saldoAwal: number;
  saldoSeharusnya: number;
  hitunganFisik: number | null;
  selisih: number | null;
  percobaan: Percobaan[];
  dibukaOleh: string | null;
  ditutupOleh: string | null;
  disetujuiOleh: string | null;
  alasanSelisih: string | null;
  perMetode: { metode: string; jumlah: number; total: number }[];
}

/**
 * K-13 — laporan shift, dari data LOKAL (AC FR-D8).
 *
 * Yang disimpan dibaca apa adanya, bukan dihitung ulang: laporan yang dicetak
 * ulang berbulan-bulan kemudian harus menunjukkan angka yang sama dengan yang
 * kasir lihat saat menutup, bahkan bila baris pembayaran kelak dipangkas dari
 * jendela riwayat lokal.
 */
export async function laporanShift(db: DbLokal, shiftId: string): Promise<LaporanShift | null> {
  const shift = await ambilShift(db, shiftId);
  if (!shift) return null;
  // ⛔ Rincian di LAPORAN memuat total tunai penuh — kontrol FR-D2 sudah
  // lewat, kasnya sudah ditutup, dan laporan yang menyembunyikan angka tunai
  // tidak berguna bagi siapa pun.
  const bayar = await pembayaranTunai(db, shiftId);
  const perMetode = new Map<string, { jumlah: number; total: number }>();
  for (const b of bayar) {
    const kini = perMetode.get(b.method) ?? { jumlah: 0, total: 0 };
    kini.jumlah += 1;
    kini.total += b.amount * b.arah;
    perMetode.set(b.method, kini);
  }

  return {
    shiftId: shift.id,
    businessDate: shift.business_date,
    saldoAwal: shift.opening_float,
    saldoSeharusnya: shift.expected_amount ?? (await saldoSeharusnya(db, shift)),
    hitunganFisik: shift.counted_amount,
    selisih: shift.difference,
    percobaan: shift.count_attempts ? (JSON.parse(shift.count_attempts) as Percobaan[]) : [],
    dibukaOleh: shift.opened_by,
    ditutupOleh: shift.closed_by,
    disetujuiOleh: shift.approved_by,
    alasanSelisih: shift.variance_reason_code,
    perMetode: [...perMetode].map(([metode, v]) => ({ metode, ...v })),
  };
}
