import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import type { KonfigPerangkat } from '../../../../packages/sync-client/src/perangkat.ts';
import { nomorStruk } from '../../../../packages/domain/src/tanggal-bisnis.ts';
import { muatanOrder, type DrafTerkirim } from './penjualan.ts';
import type { Keranjang } from './keranjang.ts';

/**
 * FR-C3 + FR-C14 — jalur penjualan ONLINE-FIRST untuk QRIS dinamis.
 *
 * ## ⛔ Kenapa jalur ini harus terbalik dari semua jalur lain
 *
 * Setiap penjualan lain di produk ini menulis LOKAL lebih dulu lalu me-relay:
 * itu yang membuat kasir tetap dapat berjualan tanpa internet, dan itu seluruh
 * nilai jual produk ini. QRIS dinamis tidak dapat mengikutinya, dan bukan
 * karena pilihan rancangan — `spec-c:320` melarang sistem menandai lunas tanpa
 * konfirmasi GATEWAY, dan gateway hanya dapat dihubungi server kami. Perangkat
 * tidak punya cara mengetahui pelanggan sudah membayar.
 *
 * Jadi urutannya:
 *
 * ```
 * cadangkan nomor struk (lokal)
 *   → POST /orders            (draf, status `open` di server)
 *   → POST /orders/{id}/payments  (qris_dynamic → QR)
 *   → tampilkan QR, polling status
 *   → confirmed → simpanPenjualan({ draf })   ← satu transaksi lokal
 * ```
 *
 * ## ⛔ Nomor struk dicadangkan SEBELUM QR, dan itu keputusan yang disengaja
 *
 * Server menuntut `receiptNumber` saat order dibuat, dan counternya LOKAL
 * (`CLAUDE.md`: "tidak pernah minta ke server"). Konsekuensinya: pelanggan
 * yang tidak jadi membayar membakar satu nomor.
 *
 * Yang TIDAK boleh terjadi adalah LUBANG di urutan struk — nomor 41 dan 43 ada
 * sementara 42 tidak pernah ada di mana pun tidak dapat dijelaskan siapa pun
 * saat diperiksa. Karena itu draf yang batal TIDAK dihapus: ordernya tetap ada
 * di server dengan nomor itu, ditandai `abandoned`. Nomor yang terpakai untuk
 * order yang dibatalkan jauh lebih baik daripada nomor yang hilang.
 *
 * ## ⛔ Drafnya BERTAHAN di perangkat
 *
 * `spec-c:328`: *"Aplikasi mati di tengah polling → setelah restart, payment
 * masih `pending_confirmation` dan polling dilanjutkan."* Antara draf terkirim
 * dan konfirmasi ada jendela sampai lima menit tempat uang sudah (atau sedang)
 * berpindah dan perangkat belum menulis apa pun. Tab yang ter-refresh di sana
 * membuat kasir kehilangan seluruh jejaknya.
 */

/** Satu perangkat menunggu paling banyak satu QR. Lihat DDL. */
const KUNCI = 'kini';

/** Batas polling `spec-c:300` — 2 detik, maksimum 5 menit. */
export const JEDA_POLLING_MS = 2_000;
export const BATAS_POLLING_MS = 5 * 60_000;

export interface PengirimApi {
  (
    jalur: string,
    opsi: { metode: 'GET' | 'POST'; body?: unknown; idempotencyKey?: string }
  ): Promise<{ status: number; body: unknown }>;
}

export interface DrafTersimpan {
  draf: DrafTerkirim;
  muatan: Record<string, unknown>;
  orderId: string;
  paymentId: string;
  shiftId: string;
  qrString: string | null;
}

/**
 * Mencadangkan nomor struk dan menyusun muatan order.
 *
 * ⛔ Ia MENAIKKAN counter, dan itu satu-satunya efeknya di database. Tidak ada
 * baris `order` lokal yang ditulis di sini — penjualan baru ada setelah
 * `simpanPenjualan`, dan menulis order lokal berstatus `open` mengembalikan
 * persis masalah yang KEP-21 hindari.
 */
export async function cadangkanNomor(
  db: DbLokal,
  businessDate: string,
  deviceCode: string
): Promise<{ sequence: number; receiptNumber: string }> {
  return db.transaction(async (tx) => {
    const baris = await tx.getAll<{
      receipt_sequence: number;
      sequence_business_date: string | null;
    }>(`SELECT receipt_sequence, sequence_business_date FROM device_config WHERE id = 1`);
    const kini = baris[0];
    const sama = kini?.sequence_business_date === businessDate;
    const sequence = sama ? (kini?.receipt_sequence ?? 0) + 1 : 1;
    await tx.execute(
      `UPDATE device_config SET receipt_sequence = ?, sequence_business_date = ? WHERE id = 1`,
      [sequence, businessDate]
    );
    return { sequence, receiptNumber: nomorStruk(deviceCode, businessDate, sequence) };
  });
}

export async function simpanDraf(db: DbLokal, d: DrafTersimpan, sekarang: string): Promise<void> {
  await db.execute(
    `INSERT INTO draf_qris_lokal
       (id, order_id, payment_id, shift_id, draf, muatan, qr_string, dibuat_pada)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       order_id = excluded.order_id,
       payment_id = excluded.payment_id,
       shift_id = excluded.shift_id,
       draf = excluded.draf,
       muatan = excluded.muatan,
       qr_string = excluded.qr_string,
       dibuat_pada = excluded.dibuat_pada`,
    [
      KUNCI,
      d.orderId,
      d.paymentId,
      d.shiftId,
      // ⛔ `hlc` adalah `bigint` dan `JSON.stringify` MELEMPAR padanya —
      // pelajaran yang sama dengan keranjang berdiskon (KEP-21). Ditulis
      // sebagai string dan dibaca kembali menjadi `bigint`.
      JSON.stringify(d.draf, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
      JSON.stringify(d.muatan),
      d.qrString,
      sekarang,
    ]
  );
}

export async function bersihkanDraf(db: DbLokal): Promise<void> {
  await db.execute('DELETE FROM draf_qris_lokal WHERE id = ?', [KUNCI]);
}

/**
 * Memulihkan draf yang tertinggal, bila ada dan bila milik shift ini.
 *
 * ⛔ Draf milik shift LAIN dibuang, alasan yang sama persis dengan keranjang
 * (KEP-21): kasir berikutnya yang menemukan QR pelanggan kemarin akan
 * menutupnya sebagai penjualannya sendiri.
 */
export async function pulihkanDraf(db: DbLokal, shiftId: string): Promise<DrafTersimpan | null> {
  const baris = (
    await db.getAll<{
      order_id: string;
      payment_id: string;
      shift_id: string;
      draf: string;
      muatan: string;
      qr_string: string | null;
    }>(
      `SELECT order_id, payment_id, shift_id, draf, muatan, qr_string
         FROM draf_qris_lokal WHERE id = ?`,
      [KUNCI]
    )
  )[0];
  if (!baris) return null;
  if (baris.shift_id !== shiftId) {
    await bersihkanDraf(db);
    return null;
  }
  try {
    const mentah = JSON.parse(baris.draf) as Record<string, unknown>;
    if (typeof mentah.hlc !== 'string' || !/^\d+$/.test(mentah.hlc)) return null;
    const draf = { ...mentah, hlc: BigInt(mentah.hlc) } as unknown as DrafTerkirim;
    return {
      draf,
      muatan: JSON.parse(baris.muatan) as Record<string, unknown>,
      orderId: baris.order_id,
      paymentId: baris.payment_id,
      shiftId: baris.shift_id,
      qrString: baris.qr_string,
    };
  } catch {
    // ⛔ Draf rusak DIBUANG, tidak melempar. Ia kenyamanan pemulihan; satu
    // baris yang tidak dapat diurai tidak boleh membuat layar pembayaran
    // gagal dibuka sama sekali.
    await bersihkanDraf(db);
    return null;
  }
}

export type HasilQr =
  | { status: 'qr'; qrString: string; paymentId: string; draf: DrafTerkirim }
  | { status: 'gagal'; pesan: string; paymentId: string | null };

/**
 * Mengirim draf ke server dan meminta QR.
 *
 * ⛔ Draf disimpan LOKAL sebelum permintaan gateway dikirim, bukan sesudah.
 * Alasannya sama dengan kenapa server menulis payment `pending_confirmation`
 * dan meng-commit-nya SEBELUM memanggil gateway (`CLAUDE.md` § gateway):
 * kegagalan di tengah tidak boleh menghapus satu-satunya jejak bahwa QR pernah
 * diminta — sementara pelanggan mungkin sudah membayar.
 */
export async function mintaQr({
  db,
  kirim,
  konfig,
  shiftId,
  keranjang,
  draf,
  channel,
  total,
  idBaru,
  sekarang,
}: {
  db: DbLokal;
  kirim: PengirimApi;
  konfig: KonfigPerangkat;
  shiftId: string;
  keranjang: Keranjang;
  draf: DrafTerkirim;
  channel: 'dine_in' | 'takeaway';
  total: bigint;
  idBaru: () => string;
  sekarang: string;
}): Promise<HasilQr> {
  const muatan = muatanOrder({
    orderId: draf.orderId,
    konfig,
    shiftId,
    receiptNumber: draf.receiptNumber,
    businessDate: draf.businessDate,
    sequence: draf.sequence,
    channel,
    checkId: draf.checkId,
    hlc: draf.hlc,
    occurredAt: draf.occurredAt,
    total,
    keranjang,
    idBaru,
  });
  const paymentId = draf.paymentIds[0];

  await simpanDraf(
    db,
    { draf, muatan, orderId: draf.orderId, paymentId, shiftId, qrString: null },
    sekarang
  );

  const order = await kirim('/orders', {
    metode: 'POST',
    body: muatan,
    idempotencyKey: draf.orderId,
  });
  // ⛔ 409 `ID_ALREADY_EXISTS` adalah SUKSES di sini, bukan kegagalan.
  // Percobaan kedua atas draf yang sama — kasir menekan ulang setelah jaringan
  // menggantung — harus melanjutkan ke permintaan QR, bukan menyerah pada
  // order yang sudah benar-benar ada di server.
  const orderOk =
    (order.status >= 200 && order.status < 300) ||
    (order.status === 409 && kodeGalat(order.body) === 'ID_ALREADY_EXISTS');
  if (!orderOk) {
    return { status: 'gagal', pesan: pesanGalat(order.body, 'Order tidak dapat dibuat di server.'), paymentId: null };
  }

  const bayar = await kirim(`/orders/${encodeURIComponent(draf.orderId)}/payments`, {
    metode: 'POST',
    body: { id: paymentId, method: 'qris_dynamic', amount: Number(total) },
    // ⛔ Kunci idempotensi diturunkan dari `paymentId`, dan ia TETAP sama pada
    // setiap percobaan. `spec-c:326`: retry memakai kunci yang sama dan tidak
    // membuat transaksi gateway baru — QR kedua untuk uang yang sama adalah
    // cara paling langsung menagih pelanggan dua kali.
    idempotencyKey: paymentId,
  });
  if (bayar.status < 200 || bayar.status >= 300) {
    return {
      status: 'gagal',
      pesan: pesanGalat(bayar.body, 'Gateway tidak dapat dihubungi.'),
      // ⛔ `paymentId` DIKEMBALIKAN meski gagal. Payment mungkin sudah ada di
      // server sebagai `pending_confirmation`, dan tombol "Cek status" adalah
      // satu-satunya jalan menemukannya lagi (`spec-c:313`).
      paymentId,
    };
  }

  const qr = bacaQr(bayar.body);
  if (qr === null) {
    return { status: 'gagal', pesan: 'Server tidak mengembalikan QR.', paymentId };
  }
  await simpanDraf(
    db,
    { draf, muatan, orderId: draf.orderId, paymentId, shiftId, qrString: qr },
    sekarang
  );
  return { status: 'qr', qrString: qr, paymentId, draf };
}

export type StatusBayar = 'confirmed' | 'pending' | 'gagal' | 'kedaluwarsa';

/**
 * Satu kali cek status ke server.
 *
 * ⛔ Status yang TIDAK DIKENAL dibaca `pending`, tidak pernah `confirmed`.
 * Aturan yang sama dengan adapter gateway di server (`CLAUDE.md`): menandai
 * lunas berdasarkan kata yang tidak dimengerti adalah menyerahkan barang tanpa
 * uang. Kegagalan jaringan juga `pending` — ia tidak mengatakan apa pun
 * tentang apakah pelanggan sudah membayar.
 */
export async function cekStatus(
  kirim: PengirimApi,
  paymentId: string
): Promise<StatusBayar> {
  let jawab: { status: number; body: unknown };
  try {
    jawab = await kirim(`/payments/${encodeURIComponent(paymentId)}/check-status`, {
      metode: 'POST',
      body: {},
    });
  } catch {
    return 'pending';
  }
  if (jawab.status < 200 || jawab.status >= 300) return 'pending';
  const status = bacaStatus(jawab.body);
  if (status === 'confirmed') return 'confirmed';
  if (status === 'failed') return 'gagal';
  if (status === 'expired') return 'kedaluwarsa';
  return 'pending';
}

/**
 * Menandai order draf sebagai ditinggalkan di server.
 *
 * ⛔ Ia TIDAK menghapus apa pun. Order-nya tetap ada dengan nomor struknya —
 * lihat catatan kepala tentang lubang di urutan struk. Yang berubah hanya
 * statusnya, supaya ia tidak tertinggal `open` selamanya dan muncul di laporan
 * sebagai penjualan yang belum ditutup.
 */
export async function tinggalkanDraf(
  kirim: PengirimApi,
  orderId: string,
  alasan: string
): Promise<boolean> {
  try {
    const jawab = await kirim(`/orders/${encodeURIComponent(orderId)}/abandon`, {
      metode: 'POST',
      body: { reasonCode: alasan },
      idempotencyKey: `abandon-${orderId}`,
    });
    return jawab.status >= 200 && jawab.status < 300;
  } catch {
    return false;
  }
}

// --- pembacaan respons -------------------------------------------------------

function objek(body: unknown): Record<string, unknown> | null {
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;
}

function kodeGalat(body: unknown): string | null {
  const o = objek(body);
  const galat = o === null ? null : objek(o.error);
  return galat !== null && typeof galat.code === 'string' ? galat.code : null;
}

function pesanGalat(body: unknown, bawaan: string): string {
  const o = objek(body);
  const galat = o === null ? null : objek(o.error);
  return galat !== null && typeof galat.message === 'string' ? galat.message : bawaan;
}

function bacaQr(body: unknown): string | null {
  const o = objek(body);
  if (o === null) return null;
  const langsung = o.qrString;
  if (typeof langsung === 'string' && langsung !== '') return langsung;
  const bayar = objek(o.payment);
  if (bayar !== null && typeof bayar.qrString === 'string' && bayar.qrString !== '') {
    return bayar.qrString;
  }
  return null;
}

function bacaStatus(body: unknown): string | null {
  const o = objek(body);
  if (o === null) return null;
  if (typeof o.status === 'string') return o.status;
  const bayar = objek(o.payment);
  return bayar !== null && typeof bayar.status === 'string' ? bayar.status : null;
}
