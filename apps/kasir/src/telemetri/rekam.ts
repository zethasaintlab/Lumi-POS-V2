import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import {
  BATAS_BUFFER,
  bersihkanPeristiwa,
  eventUntukMode,
  jumlahDibuang,
  ringkas,
  type EventTelemetri,
  type ModeTelemetri,
  type PeristiwaTelemetri,
  type RingkasEvent,
} from '../../../../packages/domain/src/telemetri.ts';

/**
 * Telemetri klien — buffer lokal dan pembacanya. `ARCH:294` § 10.
 *
 * ## ⛔ TIDAK PERNAH melempar, dan tidak pernah menunggu
 *
 * `ARCH:307`: *"tidak pernah menghambat aplikasi — fire-and-forget dengan
 * timeout pendek."* Pemanggil `rekam()` adalah jalur penjualan, jalur cetak,
 * dan penangan crash. Telemetri yang menggagalkan salah satunya lebih
 * berbahaya daripada telemetri yang tidak ada sama sekali.
 *
 * Karena itu `rekam()` menelan SETIAP kegagalan — termasuk `no such table`
 * pada perangkat yang migrasinya belum jalan. Yang hilang hanya satu titik
 * data.
 *
 * ## ⛔ Buffer BERBATAS
 *
 * Perangkat yang berbulan-bulan offline menghasilkan puluhan ribu peristiwa.
 * Disk yang penuh membuat `outbox_local` **gagal menulis penjualan** — dan
 * telemetri dapat dibuang sementara penjualan tidak. Pemangkasan membuang
 * yang **terlama**: metrik yang menjelaskan keadaan SEKARANG adalah yang
 * berguna saat merchant menelepon.
 *
 * ## ⛔ Batas etis ditegakkan DI SINI, bukan dipercayakan ke pemanggil
 *
 * `bersihkanPeristiwa` membuang apa pun yang bukan angka sebelum satu baris
 * pun ditulis. `ARCH:309` menyebutnya batas etis; pemanggil yang keliru
 * mengoper pesan error tidak dapat membocorkan apa pun lewat jalur ini.
 */

/** Berapa sering pemangkasan buffer diperiksa — satu dari sekian penulisan. */
const SETIAP_PANGKAS = 100;

let sejakPangkas = 0;

export interface DepsRekam {
  db: DbLokal;
  mode: ModeTelemetri;
  waktu?: () => Date;
  idBaru?: () => string;
}

/**
 * Mencatat satu peristiwa. Selalu `void` — pemanggil tidak pernah menunggu
 * dan tidak pernah tahu apakah ia berhasil.
 */
export async function rekam(
  deps: DepsRekam,
  event: EventTelemetri,
  nilai: number,
  tipe: string | null = null
): Promise<void> {
  try {
    const diizinkan = eventUntukMode(deps.mode);
    if (!diizinkan.has(event)) return;

    const waktu = deps.waktu ?? (() => new Date());
    const bersih = bersihkanPeristiwa({
      event,
      nilai,
      tipe,
      padaWaktu: waktu().toISOString(),
    });
    // ⛔ `null` berarti buang, bukan lempar. Lihat `bersihkanPeristiwa`.
    if (bersih === null) return;

    const idBaru = deps.idBaru ?? (() => crypto.randomUUID());
    await deps.db.execute(
      `INSERT INTO telemetry_local (id, event, nilai, tipe, pada_waktu)
       VALUES (?, ?, ?, ?, ?)`,
      [idBaru(), bersih.event, bersih.nilai, bersih.tipe, bersih.padaWaktu]
    );

    sejakPangkas += 1;
    if (sejakPangkas >= SETIAP_PANGKAS) {
      sejakPangkas = 0;
      await pangkas(deps.db);
    }
  } catch {
    // ⛔ DITELAN. Lihat catatan kepala berkas — pemanggilnya jalur penjualan.
  }
}

/**
 * Memangkas buffer ke `BATAS_BUFFER`, membuang yang TERLAMA.
 *
 * Diekspor supaya dapat diuji sendiri, dan supaya boot dapat memanggilnya
 * sekali: perangkat yang baru menyala setelah lama offline sudah melewati
 * batas sebelum satu penulisan pun terjadi.
 */
export async function pangkas(db: DbLokal, batas: number = BATAS_BUFFER): Promise<void> {
  try {
    const baris = await db.getAll<{ n: number | bigint | string }>(
      'SELECT count(*) AS n FROM telemetry_local'
    );
    // ⛔ `Number(...)` atas ketiga bentuk: `@powersync/web` mengembalikan kolom
    // `INTEGER` besar sebagai `bigint`, `node:sqlite` sebagai `number`.
    const buang = jumlahDibuang(Number(baris[0]?.n ?? 0), batas);
    if (buang <= 0) return;
    // ⛔ `ORDER BY pada_waktu` — yang TERLAMA. Membuang yang terbaru akan
    // menyisakan metrik bulan lalu, yang tidak menjelaskan apa pun tentang
    // keadaan yang sedang merchant keluhkan.
    await db.execute(
      `DELETE FROM telemetry_local WHERE id IN (
         SELECT id FROM telemetry_local ORDER BY pada_waktu ASC LIMIT ?
       )`,
      [buang]
    );
  } catch {
    // Ditelan, alasan yang sama.
  }
}

/**
 * Bentuk KAWAT, bukan bentuk domain.
 *
 * Namanya Inggris karena seluruh REST di repo ini begitu (`packages/contracts/
 * openapi.yaml`), sementara `RingkasEvent` di domain memakai nama Indonesia.
 * Penerjemahannya terjadi persis di sini — satu tempat, dan bukan tersebar di
 * pemanggil.
 */
export interface Muatan {
  appVersion: string;
  windowStart: string;
  windowEnd: string;
  events: {
    event: string;
    type: string | null;
    count: number;
    total: number;
    min: number;
    max: number;
    p95: number;
  }[];
}

function keKawat(r: RingkasEvent): Muatan['events'][number] {
  return {
    event: r.event,
    type: r.tipe,
    count: r.jumlah,
    total: r.total,
    min: r.min,
    max: r.maks,
    p95: r.p95,
  };
}

/**
 * Menyusun muatan kirim dari buffer, TANPA menghapusnya.
 *
 * ⛔ Penghapusan terjadi setelah server menjawab (`tandaiTerkirim`). Menghapus
 * lebih dulu berarti kegagalan jaringan membuang metrik yang justru
 * menjelaskan kegagalan itu.
 *
 * `null` bila tidak ada apa pun untuk dikirim — pemanggil tidak boleh
 * mengirim muatan kosong; permintaan HTTP yang tidak membawa apa-apa adalah
 * biaya jaringan tanpa imbalan, dan perangkat offline melakukannya berulang.
 */
export async function susunMuatan(
  db: DbLokal,
  { appVersion, hanyaId }: { appVersion: string; hanyaId?: readonly string[] }
): Promise<{ muatan: Muatan; idTerbaca: string[] } | null> {
  // ⛔ `hanyaId` mempersempit ke batch yang PERNAH dikirim tapi belum
  // dikonfirmasi. Tanpa itu, percobaan ulang setelah respons yang hilang
  // menyusun jendela yang lebih LEBAR daripada yang pertama — dan bila yang
  // pertama sebenarnya sampai, selisihnya terhitung dua kali.
  if (hanyaId !== undefined && hanyaId.length === 0) return null;
  const tanya = hanyaId === undefined ? '' : ` WHERE id IN (${hanyaId.map(() => '?').join(',')})`;
  const baris = await db.getAll<{
    id: string;
    event: string;
    nilai: number;
    tipe: string | null;
    pada_waktu: string;
  }>(
    `SELECT id, event, nilai, tipe, pada_waktu FROM telemetry_local${tanya} ORDER BY pada_waktu ASC`,
    hanyaId === undefined ? [] : [...hanyaId]
  );

  if (baris.length === 0) return null;

  const peristiwa: PeristiwaTelemetri[] = [];
  for (const b of baris) {
    // Dibersihkan LAGI saat dibaca. Baris dapat berasal dari versi aplikasi
    // yang lebih lama dengan daftar event berbeda; yang tidak dikenal dibuang
    // alih-alih dikirim ke server yang akan menolaknya.
    const bersih = bersihkanPeristiwa({
      event: b.event,
      nilai: Number(b.nilai),
      tipe: b.tipe,
      padaWaktu: b.pada_waktu,
    });
    if (bersih !== null) peristiwa.push(bersih);
  }
  if (peristiwa.length === 0) {
    // Seluruhnya tidak dapat dibaca — buang, jangan tumpuk selamanya.
    return {
      muatan: {
        appVersion,
        windowStart: baris[0].pada_waktu,
        windowEnd: baris[baris.length - 1].pada_waktu,
        events: [],
      },
      idTerbaca: baris.map((b) => b.id),
    };
  }

  return {
    muatan: {
      appVersion,
      windowStart: peristiwa[0].padaWaktu,
      windowEnd: peristiwa[peristiwa.length - 1].padaWaktu,
      events: ringkas(peristiwa).map(keKawat),
    },
    idTerbaca: baris.map((b) => b.id),
  };
}

/** Menghapus baris yang sudah benar-benar terkirim. */
export async function tandaiTerkirim(db: DbLokal, id: readonly string[]): Promise<void> {
  if (id.length === 0) return;
  const tanya = id.map(() => '?').join(',');
  await db.execute(`DELETE FROM telemetry_local WHERE id IN (${tanya})`, [...id]);
}

/** Dipakai test untuk mengembalikan penghitung pemangkasan ke nol. */
export function resetPenghitungPangkas(): void {
  sejakPangkas = 0;
}
