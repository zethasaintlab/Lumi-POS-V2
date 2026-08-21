import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import { cetakStruk, type HasilCetak, type PeripheralPort } from './port.ts';
import type { PrinterProfile, ReceiptDocument } from './escpos.ts';

/**
 * F4 — antrean cetak (`ERD:447`, tabel `print_job`).
 *
 * Tabelnya ada sejak F0 dan **tidak pernah ditulis siapa pun**. Akibatnya:
 * struk yang gagal dicetak hilang seketika, dan satu-satunya jalan
 * memulihkannya adalah membangun ulang dokumennya dari database — yang
 * menghasilkan struk yang mungkin BERBEDA, karena kode di antaranya berubah.
 *
 * ## ⛔ Dokumen disimpan APA ADANYA
 *
 * `db/local/001-initial.sql` sudah menuliskan alasannya sebagai komentar:
 * *"Retry karena itu mencetak persis yang gagal — bukan dokumen yang dibangun
 * ulang dan mungkin berbeda."* FR-B11 menuntut cetak ulang identik dengan
 * cetakan pertama, dan itu hanya dapat dijamin bila yang dicetak ulang adalah
 * byte yang sama, bukan hasil render kedua.
 *
 * ## ⛔ MURNI LOKAL
 *
 * Struk adalah artefak PERANGKAT. Printer yang gagal di kasir 1 tidak dapat
 * dicetak ulang oleh kasir 2, dan mengirim antrean cetak ke server berarti
 * server menyimpan dokumen yang tidak dapat dipakainya.
 *
 * ## ⛔ Invariant #3 tidak berubah bentuknya
 *
 * Seluruh berkas ini berjalan SETELAH penjualan ter-commit, dan tidak satu pun
 * fungsinya melempar. Antrean cetak yang gagal ditulis tidak boleh menjatuhkan
 * penjualan yang uangnya sudah masuk laci.
 */

export interface JobCetak {
  id: string;
  order_id: string | null;
  peripheral_id: string | null;
  /** `ReceiptDocument` ter-JSON. Dicetak ulang APA ADANYA. */
  document: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
}

/**
 * Batas percobaan sebelum job berhenti dicoba otomatis.
 *
 * ⛔ Job yang dicoba tanpa batas akan mencetak struk kemarin saat printer
 * akhirnya menyala — di tengah antrean pelanggan, tanpa ada yang memintanya.
 * Setelah batas ini ia tetap TERSIMPAN dan tetap dapat dicetak manual dari
 * K-09; yang berhenti hanyalah percobaan otomatisnya.
 */
export const MAKS_PERCOBAAN_CETAK = 5;

/**
 * Mencatat satu percobaan cetak.
 *
 * ## ⛔ `tanpa_printer` TIDAK menulis apa pun
 *
 * Merchant tanpa printer adalah kasus SAH (`CLAUDE.md` § F4), dan perangkatnya
 * akan mencetak nol struk selamanya. Menuliskan setiap penjualan sebagai job
 * `pending` di perangkat seperti itu menghasilkan antrean yang tumbuh tanpa
 * batas dan tidak pernah dapat terkuras — lalu setiap layar yang menghitungnya
 * melaporkan ribuan "cetak tertunda" yang tidak berarti apa-apa.
 *
 * Yang ditulis hanya percobaan yang benar-benar menyentuh printer: `tercetak`
 * (untuk cetak ulang FR-B11) dan `gagal` (untuk retry).
 */
export async function catatCetak(
  db: DbLokal,
  {
    id,
    orderId,
    dokumen,
    hasil,
    waktu,
    peripheralId,
  }: {
    id: string;
    orderId: string | null;
    dokumen: ReceiptDocument;
    hasil: HasilCetak;
    waktu: string;
    peripheralId?: string | null;
  }
): Promise<void> {
  if (hasil.status === 'tanpa_printer') return;

  const status = hasil.status === 'tercetak' ? 'printed' : 'failed';
  await db.execute(
    `INSERT INTO print_job
       (id, order_id, peripheral_id, document, status, attempts, last_error, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    [
      id,
      orderId,
      peripheralId ?? null,
      JSON.stringify(dokumen),
      status,
      hasil.status === 'gagal' ? (hasil.pesan ?? null) : null,
      waktu,
    ]
  );
}

/**
 * Mencetak DAN mencatat, dalam satu panggilan.
 *
 * ⛔ Satu pintu, supaya tidak ada jalur cetak yang lupa mencatat. Jalur yang
 * lupa adalah jalur yang strukanya hilang saat gagal — dan itu tepat jalur
 * yang paling butuh antreannya.
 *
 * TIDAK PERNAH melempar: kegagalan menulis job dikembalikan sebagai hasil
 * cetak yang apa adanya. Struk adalah efek samping (invariant #3).
 */
export async function cetakDanCatat(
  db: DbLokal,
  port: PeripheralPort | null | undefined,
  dokumen: ReceiptDocument,
  profil: PrinterProfile | null | undefined,
  {
    id,
    orderId,
    waktu,
    perangkatId,
  }: { id: string; orderId: string | null; waktu: string; perangkatId?: string }
): Promise<HasilCetak> {
  const hasil = await cetakStruk(port, dokumen, profil, perangkatId);
  try {
    await catatCetak(db, {
      id,
      orderId,
      dokumen,
      hasil,
      waktu,
      peripheralId: perangkatId ?? null,
    });
  } catch {
    // Gagal MENCATAT tidak mengubah kenyataan bahwa struknya tercetak (atau
    // tidak). Melemparnya ke pemanggil membuat penjualan yang sudah tersimpan
    // terlihat gagal.
  }
  return hasil;
}

/**
 * Job yang masih perlu dicoba, terlama dulu.
 *
 * ⛔ Hanya `failed`. `pending` tidak pernah ditulis berkas ini — lihat
 * `catatCetak`. Baris `pending` yang ditemukan di sini berasal dari versi
 * lama, dan ia tetap ikut supaya tidak ada job yang terjebak selamanya.
 */
export async function antreanCetakTertunda(db: DbLokal, batas = 50): Promise<JobCetak[]> {
  return db.getAll<JobCetak>(
    `SELECT * FROM print_job
      WHERE status IN ('pending', 'failed') AND attempts < ?
      ORDER BY created_at, id
      LIMIT ?`,
    [MAKS_PERCOBAAN_CETAK, batas]
  );
}

/** Berapa job yang masih dapat dicoba. Untuk lencana di layar. */
export async function jumlahCetakTertunda(db: DbLokal): Promise<number> {
  const [b] = await db.getAll<{ n: number }>(
    `SELECT count(*) AS n FROM print_job WHERE status IN ('pending','failed') AND attempts < ?`,
    [MAKS_PERCOBAAN_CETAK]
  );
  return Number(b?.n ?? 0);
}

export interface HasilAntrean {
  dicoba: number;
  berhasil: number;
  gagal: number;
}

/**
 * Mencoba ulang seluruh job yang tertunda.
 *
 * ## ⛔ Dokumen dibaca dari BARIS, bukan dibangun ulang
 *
 * Itu seluruh gunanya kolom `document`. Membangun ulang dari database
 * menghasilkan struk yang dapat berbeda dari yang gagal — dan FR-B11 menuntut
 * cetak ulang identik dengan cetakan pertama.
 *
 * ## ⛔ Perangkat tanpa printer keluar SEBELUM loop, bukan di dalamnya
 *
 * Perangkat tanpa printer akan "mencoba" setiap kali layar dibuka. Menaikkan
 * `attempts` di sana berarti job-job itu habis percobaan tanpa pernah menyentuh
 * printer sama sekali — struk yang gagal hilang dari antrean karena seseorang
 * membuka layar lima kali.
 *
 * Penjagaannya adalah `if (!port || !profil) return` di baris pertama, dan itu
 * SATU-SATUNYA tempat keadaan ini ditangani. Versi pertama juga memeriksa
 * `cetak.status === 'tanpa_printer'` di dalam loop; sabotase membuktikan
 * cabang itu **tidak pernah menyala** — `cetakStruk` mengembalikan
 * `tanpa_printer` hanya untuk `!port || !profil`, dan keduanya sudah dijawab
 * di atas. Kode mati yang menyamar sebagai kehati-hatian, kelas yang sama
 * dengan cabang `arah = -1` di tutup kas (`CLAUDE.md` § F3).
 *
 * Tidak pernah melempar; satu job yang gagal tidak menghentikan sisanya.
 */
export async function prosesAntreanCetak(
  db: DbLokal,
  port: PeripheralPort | null | undefined,
  profil: PrinterProfile | null | undefined,
  { batas = 50 }: { batas?: number } = {}
): Promise<HasilAntrean> {
  const hasil: HasilAntrean = { dicoba: 0, berhasil: 0, gagal: 0 };
  if (!port || !profil) return hasil;

  const job = await antreanCetakTertunda(db, batas);
  for (const j of job) {
    let dok: ReceiptDocument;
    try {
      dok = JSON.parse(j.document) as ReceiptDocument;
    } catch {
      // Dokumen yang tidak dapat diurai tidak akan pernah dapat dicetak.
      // Ditandai habis percobaan alih-alih dicoba selamanya, dan alasannya
      // disimpan supaya support punya sesuatu untuk dibaca.
      await db.execute(
        `UPDATE print_job SET status = 'failed', attempts = ?, last_error = ? WHERE id = ?`,
        [MAKS_PERCOBAAN_CETAK, 'Dokumen tersimpan tidak dapat dibaca.', j.id]
      );
      continue;
    }

    hasil.dicoba += 1;
    const cetak = await cetakStruk(port, dok, profil, j.peripheral_id ?? undefined);
    if (cetak.status === 'tercetak') {
      hasil.berhasil += 1;
      await db.execute(
        `UPDATE print_job SET status = 'printed', attempts = attempts + 1, last_error = NULL WHERE id = ?`,
        [j.id]
      );
    } else {
      hasil.gagal += 1;
      // ⛔ `cetak.status === 'gagal'` di sini adalah PENYEMPITAN TIPE, bukan
      // cabang: `tanpa_printer` mustahil karena `port` dan `profil` sudah
      // dijamin ada di baris pertama fungsi ini. TypeScript tidak dapat
      // membuktikannya lewat dua pemeriksaan yang terpisah, dan justru
      // kegagalan typecheck itulah yang menunjukkan cabangnya memang mati.
      const alasan = cetak.status === 'gagal' ? cetak.pesan : null;
      await db.execute(
        `UPDATE print_job SET status = 'failed', attempts = attempts + 1, last_error = ? WHERE id = ?`,
        [alasan, j.id]
      );
    }
  }
  return hasil;
}
