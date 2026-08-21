// FR-H2 & FR-H3 -- status antrean yang terlihat kasir.
//
// Seluruh isi berkas ini adalah keputusan, bukan penggambaran: apa yang
// ditampilkan, dengan teks apa, dan dari baris mana. React hanya menggambar
// hasilnya. Pemisahan itu yang membuat `spec-h:224` ("indikator diperbarui
// < 1 detik") dapat dipenuhi tanpa menebak -- dan yang membuat seluruh aturan
// di sini dapat diuji `node --test`.

import { BATAS_BATCH } from './relay.ts';
import type { BarisOutbox, DbLokal } from './ports.ts';

/** Empat state `SyncIndicator` design system. */
export type StateIndikator = 'ok' | 'queued' | 'failed' | 'offline-only';

export interface RingkasanAntrean {
  /** `pending` + `sending`. Dari sisi kasir keduanya sama: belum sampai. */
  menunggu: number;
  gagal: number;
  /** `created_at` item BELUM TERKIRIM yang tertua. Metrik kesehatan #1. */
  tertuaPada: string | null;
  /** `last_attempt_at` terakhir yang berhasil. Jalur NAIK saja. */
  terakhirTerkirimPada: string | null;
}

/**
 * Ringkasan antrean dalam satu query.
 *
 * `tertuaPada` sengaja dihitung dari yang BELUM terkirim saja. Dihitung dari
 * seluruh baris, satu item `sent` dari kemarin membuat antrean yang sehat
 * terlihat berumur satu hari -- dan `spec-h:302` memakai umur tertua sebagai
 * ambang peringatan 4 jam / 24 jam / 72 jam.
 *
 * `terakhirTerkirimPada` adalah waktu jalur NAIK. Jalur turun punya jamnya
 * sendiri di PowerSync; menggabungkan keduanya jadi satu angka akan
 * menyembunyikan keadaan yang `spec-h:381` sebut eksplisit -- penjualan naik
 * lancar sementara katalog basi berhari-hari.
 */
export async function ringkasanAntrean(db: DbLokal): Promise<RingkasanAntrean> {
  const [baris] = await db.getAll<{
    menunggu: number;
    gagal: number;
    tertua: string | null;
    terakhir: string | null;
  }>(
    `SELECT
       sum(CASE WHEN status IN ('pending','sending') THEN 1 ELSE 0 END) AS menunggu,
       sum(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)               AS gagal,
       min(CASE WHEN status IN ('pending','sending','failed') THEN created_at END) AS tertua,
       max(CASE WHEN status = 'sent' THEN last_attempt_at END)          AS terakhir
     FROM outbox_local`
  );

  return {
    menunggu: baris?.menunggu ?? 0,
    gagal: baris?.gagal ?? 0,
    tertuaPada: baris?.tertua ?? null,
    terakhirTerkirimPada: baris?.terakhir ?? null,
  };
}

export interface KeadaanIndikator {
  state: StateIndikator;
  count: number;
}

/**
 * Memetakan ringkasan ke state `SyncIndicator`.
 *
 * `failed` menang atas `queued`, dan itu bukan urutan sembarang: item gagal
 * tidak akan pernah pergi sendiri, sementara yang mengantre akan. Indikator
 * yang menampilkan "3 menunggu" sambil menyembunyikan 2 item gagal permanen
 * menyembunyikan satu-satunya keadaan yang menuntut tindakan orang.
 *
 * `offline-only` TIDAK diproduksi di sini. Ia untuk data yang memang tidak
 * pernah naik, dan di jalur ini tidak ada yang seperti itu.
 */
export function keadaanIndikator(r: { menunggu: number; gagal: number }): KeadaanIndikator {
  if (r.gagal > 0) return { state: 'failed', count: r.gagal };
  if (r.menunggu > 0) return { state: 'queued', count: r.menunggu };
  return { state: 'ok', count: 0 };
}

/**
 * Teks indikator, PERSIS seperti `spec-h:210-217`.
 *
 * Ditulis di sini alih-alih di komponen karena aturan design system #5
 * ("status tidak pernah warna saja") menuntut teksnya selalu ada, dan
 * `spec-h:222` menuntutnya mengikuti design system persis. Yang dapat diuji
 * hanya yang dapat dipanggil.
 */
export function teksIndikator({ state, count }: KeadaanIndikator): string {
  switch (state) {
    case 'ok':
      return 'Tersinkron';
    case 'queued':
      return `Offline · ${count} menunggu`;
    case 'failed':
      return `Gagal kirim (${count}) · Coba lagi`;
    case 'offline-only':
      return 'Hanya di perangkat ini';
  }
}

/**
 * Status satu record, dari baris outbox miliknya (`spec-h:221`).
 *
 * `null` berarti tidak ada entri outbox -- sudah dipangkas, atau memang tidak
 * pernah antre. Keduanya berarti tidak ada yang menunggu dikirim.
 *
 * Status yang TIDAK DIKENAL dibaca `queued`, bukan `ok`. Sejajar aturan
 * gateway di `CLAUDE.md`: menebak ke arah "beres" berarti memberi tahu kasir
 * bahwa penjualannya aman berdasarkan kata yang tidak dimengerti.
 */
export function statusRecord(baris?: { status: string } | null): StateIndikator {
  if (!baris) return 'ok';
  if (baris.status === 'sent') return 'ok';
  if (baris.status === 'failed') return 'failed';
  return 'queued';
}

const PERINGKAT: Record<StateIndikator, number> = {
  ok: 0,
  'offline-only': 1,
  queued: 2,
  failed: 3,
};

/**
 * Status untuk banyak entitas sekaligus.
 *
 * Satu entitas dapat punya LEBIH DARI SATU baris outbox: `payment` dan
 * `order_cancel` memakai `entity_id` order yang sama. Yang terburuk menang --
 * order yang pembayarannya gagal terkirim tidak boleh terlihat `ok` hanya
 * karena order-nya sendiri sudah naik.
 */
export async function statusRecordBanyak(
  db: DbLokal,
  entityIds: string[]
): Promise<Record<string, StateIndikator>> {
  const hasil: Record<string, StateIndikator> = {};
  for (const id of entityIds) hasil[id] = 'ok';
  if (entityIds.length === 0) return hasil;

  const tanda = entityIds.map(() => '?').join(', ');
  const baris = await db.getAll<{ entity_id: string; status: string }>(
    `SELECT entity_id, status FROM outbox_local WHERE entity_id IN (${tanda})`,
    entityIds
  );

  for (const b of baris) {
    const kini = statusRecord(b);
    if (PERINGKAT[kini] > PERINGKAT[hasil[b.entity_id] ?? 'ok']) hasil[b.entity_id] = kini;
  }
  return hasil;
}

/**
 * `spec-h:262`: "Detail item gagal menampilkan alasan yang dapat dipahami,
 * bukan stack trace."
 *
 * Yang tidak dikenal TETAP DITAMPILKAN, hanya dirapikan. Menyembunyikannya
 * di balik "terjadi kesalahan" membuang satu-satunya petunjuk yang dimiliki
 * support saat merchant menelepon.
 */
export function pesanGagal(baris: { last_error?: string | null }): string {
  const mentah = (baris.last_error ?? '').trim();
  if (!mentah) return 'Gagal terkirim tanpa keterangan. Coba kirim ulang; bila tetap gagal, hubungi support.';

  if (mentah.includes('IDEMPOTENCY_KEY_REUSED')) {
    return 'Transaksi ini dikirim ulang dengan isi berbeda. Datanya perlu diperiksa sebelum dapat dikirim.';
  }
  if (/HTTP 401|HTTP 403/.test(mentah)) {
    return 'Perangkat tidak lagi dikenali server. Masuk lagi, lalu coba kirim ulang.';
  }
  if (/HTTP 404/.test(mentah)) {
    return 'Data tujuan tidak ditemukan di server — misalnya shift atau order yang sudah tidak ada.';
  }
  if (/HTTP 4\d\d/.test(mentah)) {
    return `Server menolak data ini (${mentah}). Ia tidak akan berhasil dikirim ulang tanpa perbaikan.`;
  }
  if (/HTTP 5\d\d/.test(mentah)) {
    return `Server sedang bermasalah (${mentah}). Akan dicoba lagi otomatis.`;
  }
  if (/jaringan/i.test(mentah)) {
    return 'Koneksi terputus sebelum server menjawab. Akan dicoba lagi otomatis.';
  }

  // Baris pertama saja, dan bingkai stack dibuang. Stack trace di layar kasir
  // tidak menolong siapa pun yang sedang berdiri di depan antrean pelanggan.
  const baris1 = mentah.split('\n')[0].replace(/\s+at\s+\S+.*$/, '').trim();
  return baris1;
}

/**
 * Umur dalam bahasa Indonesia, untuk "Tertua: 2 jam lalu" (`spec-h:242`).
 *
 * Waktu di MASA DEPAN dibaca "baru saja". Jam perangkat dapat mundur
 * (`spec-h:351`), dan umur negatif yang ditampilkan apa adanya menghasilkan
 * "-3 jam lalu" di layar kasir.
 */
export function umurRelatif(iso: string | null | undefined, sekarang: number): string {
  if (!iso) return 'belum pernah';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'belum pernah';

  const detik = Math.max(0, Math.floor((sekarang - t) / 1000));
  if (detik < 60) return 'baru saja';
  if (detik < 3600) return `${Math.floor(detik / 60)} menit lalu`;
  if (detik < 86_400) return `${Math.floor(detik / 3600)} jam lalu`;
  return `${Math.floor(detik / 86_400)} hari lalu`;
}

/**
 * Ukuran penyimpanan untuk layar Status Sinkronisasi (`spec-h:264`).
 *
 * Satuan SI (1 MB = 1.000.000 byte), bukan biner, karena angkanya datang dari
 * `navigator.storage.estimate()` dan browser melaporkannya begitu. Memakai
 * MiB sambil menulis "MB" akan membuat angka di layar tidak cocok dengan
 * angka mana pun yang bisa dicek merchant.
 *
 * `null` tidak dikarang jadi nol: "0 MB" berarti kosong, dan itu klaim yang
 * berbeda dari "tidak diketahui".
 */
export function formatUkuran(byte: number | null | undefined): string {
  if (byte === null || byte === undefined || Number.isNaN(byte)) return 'tidak diketahui';
  if (byte >= 1_000_000_000) return `${(byte / 1_000_000_000).toFixed(1).replace('.', ',')} GB`;
  return `${Math.round(byte / 1_000_000)} MB`;
}

/**
 * Satu halaman = satu batch. `spec-h:372` menuntut daftar 5.000 item
 * paginated; 50 dipakai karena ia satu-satunya angka yang sudah punya arti di
 * modul ini, dan dua angka berbeda akan menuntut penjelasan yang tidak ada.
 */
export const PER_HALAMAN = BATAS_BATCH;

export interface HalamanGagal {
  baris: BarisOutbox[];
  total: number;
}

/** Item `failed`, tertua dulu -- itu yang paling lama tidak tercatat di server. */
export async function daftarGagal(db: DbLokal, halaman: number): Promise<HalamanGagal> {
  const [{ n }] = await db.getAll<{ n: number }>(
    `SELECT count(*) AS n FROM outbox_local WHERE status = 'failed'`
  );
  const baris = await db.getAll<BarisOutbox>(
    `SELECT * FROM outbox_local WHERE status = 'failed'
      ORDER BY created_at, id LIMIT ? OFFSET ?`,
    [PER_HALAMAN, Math.max(0, halaman) * PER_HALAMAN]
  );
  return { baris, total: n ?? 0 };
}

/**
 * Ekspor darurat (`spec-h:256`).
 *
 * "Jaring pengaman terakhir dan harus selalu tersedia" -- yang membacanya
 * orang support saat perangkat rusak, bukan parser. Karena itu teks, bukan
 * JSON: `spec-h:263` menuntut "dapat dibaca manusia", dan JSON mentah dapat
 * dibaca mesin.
 *
 * Yang sudah `sent` tidak ikut: server sudah punya, dan menyertakannya
 * membuat berkas ini besar tanpa menyelamatkan apa pun.
 */
export async function buatEksporDarurat(
  db: DbLokal,
  { deviceCode, sekarang }: { deviceCode: string; sekarang: number }
): Promise<string> {
  const baris = await db.getAll<BarisOutbox>(
    `SELECT * FROM outbox_local WHERE status IN ('pending','sending','failed')
      ORDER BY created_at, id`
  );

  const kepala = [
    'EKSPOR DARURAT ANTREAN — LUMI POS',
    `Perangkat  : ${deviceCode}`,
    `Dibuat     : ${new Date(sekarang).toISOString()}`,
    `Isi        : ${baris.length} item belum terkirim`,
    '',
    'Berkas ini berisi transaksi yang BELUM tercatat di server.',
    'Simpan sampai antrean benar-benar kosong.',
    '',
  ];

  if (baris.length === 0) {
    kepala.push('Tidak ada item yang menunggu. Seluruh transaksi sudah tercatat di server.');
    return kepala.join('\n');
  }

  const blok = baris.map((b, i) => {
    let payload = b.payload;
    try {
      payload = JSON.stringify(JSON.parse(b.payload), null, 2);
    } catch {
      // Payload yang tidak dapat di-parse ditulis apa adanya. Ia tetap lebih
      // berguna daripada tidak ada.
    }
    return [
      `--- ${i + 1} / ${baris.length} ---`,
      `Status     : ${b.status === 'failed' ? 'Gagal terkirim' : 'Menunggu terkirim'}`,
      `Jenis      : ${b.entity_type}`,
      `ID entitas : ${b.entity_id}`,
      `ID antrean : ${b.id}`,
      `Dibuat     : ${b.created_at}`,
      `Percobaan  : ${b.attempts}`,
      ...(b.status === 'failed' ? [`Alasan     : ${pesanGagal(b)}`] : []),
      'Isi        :',
      payload,
      '',
    ].join('\n');
  });

  return [...kepala, ...blok].join('\n');
}

/**
 * Ekspor PEMULIHAN — JSON, untuk mesin.
 *
 * ## ⛔ Kenapa ada DUA ekspor, dan kenapa yang satu tidak cukup
 *
 * `buatEksporDarurat` di atas menghasilkan TEKS, dan `spec-h:263` menuntut
 * itu: *"dapat dibaca manusia"*. Yang membacanya orang support saat perangkat
 * rusak, bukan parser.
 *
 * Konsekuensinya baru terasa saat perangkat benar-benar mati: teks itu **tidak
 * dapat dikirim ulang**. Satu-satunya jalan memasukkan penjualannya kembali
 * adalah mengetiknya ulang satu per satu dari kertas — untuk transaksi yang
 * uangnya sudah masuk laci merchant. Runbook §10 mencatatnya sebagai alat
 * koreksi yang harus ada **sebelum insiden pertama** (gate F6).
 *
 * ## ⛔ Yang membuat pemulihan AMAN adalah idempotency key yang IKUT
 *
 * Setiap baris membawa `idempotency_key` yang dibuat saat item lahir, bukan
 * saat dikirim. Memutar ulang berkas ini karena itu **tidak dapat**
 * menghasilkan penjualan ganda: server mengenali key-nya dan mengembalikan
 * respons aslinya. Menjalankan pemulihan dua kali aman; itu sifat yang harus
 * dimiliki alat yang dipakai orang panik.
 *
 * ⛔ Key yang di-generate ulang saat pemulihan akan menghasilkan penjualan
 * ganda pada setiap item yang SEBENARNYA sudah sampai — persis kelas cacat
 * yang `enqueue` ada untuk mencegah.
 *
 * ## Yang TIDAK ikut
 *
 * Baris `sent`. Server sudah punya, dan menyertakannya membuat berkas ini
 * besar tanpa menyelamatkan apa pun — aturan yang sama dengan ekspor teks.
 */
export interface EksporPemulihan {
  versi: 1;
  deviceCode: string;
  dibuatPada: string;
  item: Array<{
    id: string;
    entityType: string;
    entityId: string;
    operation: string;
    idempotencyKey: string;
    actorId: string | null;
    createdAt: string;
    /** Payload APA ADANYA — string, bukan objek. Lihat komentar di bawah. */
    payload: string;
  }>;
}

export async function buatEksporPemulihan(
  db: DbLokal,
  { deviceCode, sekarang }: { deviceCode: string; sekarang: number }
): Promise<EksporPemulihan> {
  const baris = await db.getAll<BarisOutbox>(
    `SELECT * FROM outbox_local WHERE status IN ('pending','sending','failed')
      ORDER BY created_at, id`
  );

  return {
    versi: 1,
    deviceCode,
    dibuatPada: new Date(sekarang).toISOString(),
    item: baris.map((b) => ({
      id: b.id,
      entityType: b.entity_type,
      entityId: b.entity_id,
      operation: b.operation,
      idempotencyKey: b.idempotency_key,
      actorId: b.actor_id ?? null,
      createdAt: b.created_at,
      // ⛔ Payload disimpan sebagai STRING, tidak diurai lalu dirangkai ulang.
      //
      // Alasannya sama persis dengan yang tertulis di `http.ts`: server
      // menghitung hash request dari BODY untuk mendeteksi "key sama, body
      // berbeda" (`IDEMPOTENCY_KEY_REUSED`). Apa pun yang mengubah byte body
      // mengubah retry yang sah menjadi 422 permanen — dan V8 mengurutkan
      // ulang kunci yang menyerupai integer saat parse.
      //
      // Berkas pemulihan yang mengubah byte-nya adalah berkas yang setiap
      // itemnya ditolak, di hari yang paling buruk untuk menemukannya.
      payload: b.payload,
    })),
  };
}
