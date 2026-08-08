import { BATAS_PERCOBAAN_GAGAL, sqlJatuhTempo } from './backoff.ts';
import { klasifikasi } from './klasifikasi.ts';
import type { BarisOutbox, DbLokal, RelayDeps } from './ports.ts';

/** spec-h:60 -- "Batch maksimum 50 item per request". */
export const BATAS_BATCH = 50;

export interface HasilBatch {
  terkirim: number;
  gagalSementara: number;
  gagalPermanen: number;
  /** Item yang dilewati karena dependensinya belum selesai. */
  ditunda: number;
}

/**
 * Mengembalikan item yang tertinggal berstatus `sending` menjadi `pending`.
 *
 * Item bisa tertinggal `sending` hanya dengan satu cara: aplikasi mati di
 * antara "ditandai sedang dikirim" dan "jawaban diterima". Tanpa pemulihan
 * ini, item itu diam selamanya — penjualan yang tidak pernah naik dan tidak
 * pernah dilaporkan.
 *
 * Aman justru karena `idempotency_key` ditulis saat item DIBUAT, bukan saat
 * dikirim (lihat `enqueue`). Kalau permintaan pertama ternyata sampai, retry
 * memakai key yang sama dan menerima respons cache atau
 * `409 ID_ALREADY_EXISTS` — keduanya berarti `terkirim`.
 *
 * `attempts` sengaja TIDAK dinaikkan: mati mendadak bukan kegagalan server,
 * dan menghitungnya sebagai percobaan mendekatkan item sehat ke batas 20.
 */
export async function pulihkanSetelahMati(db: DbLokal): Promise<number> {
  const tertinggal = await db.getAll<{ id: string }>(
    `SELECT id FROM outbox_local WHERE status = 'sending'`
  );
  if (tertinggal.length > 0) {
    await db.execute(`UPDATE outbox_local SET status = 'pending' WHERE status = 'sending'`);
  }
  return tertinggal.length;
}

/**
 * Memilih item yang boleh dikirim sekarang.
 *
 * Dua syarat di SQL, supaya `LIMIT 50` jatuh pada item yang benar-benar dapat
 * dikirim:
 *
 *   1. `status = 'pending'` — `sent` sudah selesai, `failed` tidak pernah
 *      dicoba lagi (spec-h:63), `sending` sedang berjalan.
 *   2. sudah jatuh tempo menurut tangga backoff.
 *
 * Dependensi SENGAJA TIDAK disaring di sini, dan itu bukan kelalaian.
 *
 * Versi pertama menyaringnya di SQL (`d.status IN ('sent','failed')`) dan
 * salah dengan cara yang halus: saat batch dipilih, shift masih `pending`,
 * jadi order yang bergantung padanya TIDAK PERNAH ikut terpilih. Keduanya
 * tidak akan pernah naik dalam satu putaran — order selalu menunggu putaran
 * berikutnya, dan pada antrean yang panjang itu berarti satu putaran per
 * order.
 *
 * Yang menyelamatkan bentuk ini adalah urutan `created_at`: dependensi selalu
 * dibuat lebih dulu daripada yang bergantung padanya, jadi ia selalu terpilih
 * lebih dulu di batch yang sama. Penjagaan dependensinya kemudian dilakukan
 * di dalam loop, tempat status yang baru saja berubah sudah terlihat.
 */
async function pilihBatch(db: DbLokal, sekarang: number): Promise<BarisOutbox[]> {
  const tempo = sqlJatuhTempo('o', sekarang);
  return db.getAll<BarisOutbox>(
    `SELECT o.* FROM outbox_local o
      WHERE o.status = 'pending'
        AND ${tempo.sql}
      ORDER BY o.created_at, o.id
      LIMIT ${BATAS_BATCH}`,
    tempo.params
  );
}

/**
 * Satu putaran pengiriman.
 *
 * Item dikirim SATU PER SATU dan berurutan, bukan paralel. Itu bukan
 * kelalaian: spec-h:59 menuntut urutan dependensi dihormati, dan pengiriman
 * paralel membuat order tiba sebelum shift-nya walaupun urutan pemilihannya
 * benar.
 */
export async function kirimBatch(deps: RelayDeps): Promise<HasilBatch> {
  const { db, now, kirim } = deps;
  const hasil: HasilBatch = { terkirim: 0, gagalSementara: 0, gagalPermanen: 0, ditunda: 0 };

  const batch = await pilihBatch(db, now());

  // Dependensi yang terkirim DI DALAM batch ini ikut dihitung, supaya shift
  // dan order miliknya dapat naik dalam satu putaran alih-alih menunggu
  // putaran berikutnya.
  const selesaiDiBatchIni = new Set<string>();

  for (const baris of batch) {
    if (baris.depends_on && !selesaiDiBatchIni.has(baris.depends_on)) {
      const [dep] = await db.getAll<{ status: string }>(
        `SELECT status FROM outbox_local WHERE id = ?`,
        [baris.depends_on]
      );
      // Dependensi yang statusnya berubah menjadi menahan setelah batch
      // dipilih (mis. gagal pada iterasi ini). Dilewati TANPA menambah
      // `attempts` — menunggu bukan kegagalan, dan menghitungnya sebagai
      // percobaan akan menandai order yang sempurna sebagai `failed`
      // permanen hanya karena shift-nya lambat.
      if (dep && dep.status !== 'sent' && dep.status !== 'failed') {
        hasil.ditunda += 1;
        continue;
      }
    }

    await db.execute(`UPDATE outbox_local SET status = 'sending' WHERE id = ?`, [baris.id]);

    let jawaban;
    try {
      jawaban = await kirim(baris);
    } catch (e) {
      // Pengirim yang melempar diperlakukan sama dengan respons yang hilang:
      // permintaannya mungkin sudah sampai.
      jawaban = { status: null, pesan: (e as Error).message };
    }

    const keputusan = klasifikasi(jawaban);
    const waktu = new Date(now()).toISOString();

    if (keputusan === 'terkirim') {
      await db.execute(
        `UPDATE outbox_local SET status = 'sent', last_attempt_at = ?, last_error = NULL WHERE id = ?`,
        [waktu, baris.id]
      );
      selesaiDiBatchIni.add(baris.id);
      hasil.terkirim += 1;
      continue;
    }

    const attempts = baris.attempts + 1;
    const pesan = jawaban.pesan ?? jawaban.code ?? (jawaban.status === null ? 'jaringan' : `HTTP ${jawaban.status}`);

    if (keputusan === 'gagal-permanen' || attempts >= BATAS_PERCOBAAN_GAGAL) {
      await db.execute(
        `UPDATE outbox_local SET status = 'failed', attempts = ?, last_attempt_at = ?, last_error = ? WHERE id = ?`,
        [attempts, waktu, pesan, baris.id]
      );
      hasil.gagalPermanen += 1;
      continue;
    }

    await db.execute(
      `UPDATE outbox_local SET status = 'pending', attempts = ?, last_attempt_at = ?, last_error = ? WHERE id = ?`,
      [attempts, waktu, pesan, baris.id]
    );
    hasil.gagalSementara += 1;
  }

  return hasil;
}
