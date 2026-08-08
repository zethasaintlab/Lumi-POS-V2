// Penjadwal relay -- yang memanggil `kirimBatch`.
//
// Sampai sekarang tidak ada satu pun pemanggilnya (FR-H1 sengaja berhenti
// sebelum ini). Bentuknya diputuskan user 8 Agustus 2026, PLAN-pondasi-kasir
// §3.7: interval 15 detik selama antrean tidak kosong, plus dua pemicu segera
// -- penulisan lokal baru, dan koneksi yang kembali.
//
// Timer di-INJECT, sejajar `now` yang sudah di-inject di seluruh paket ini.
// Itu yang membuat "berjalan tiap 15 detik" dapat diuji dalam milidetik dan
// tanpa browser. `apps/kasir` menyuntikkan `setTimeout`/`clearTimeout`
// sungguhan dan menyambungkan pemicunya ke peristiwa `online`.

import { jedaBackoffMs } from './backoff.ts';
import type { Pemberitahu } from './pemberitahu.ts';
import type { DbLokal, HasilKirim, BarisOutbox } from './ports.ts';
import { kirimBatch, pulihkanSetelahMati } from './relay.ts';

/**
 * BATAS ATAS jeda antar putaran, bukan denyut tetap.
 *
 * `[ASUMSI]` 15 detik -- disetujui user 8 Agustus 2026. Tidak ada spec yang
 * menyebut angka ini; yang disebut spec adalah tangga backoff PER ITEM
 * (spec-h:62 -- 2/4/8/16/32/60 detik).
 *
 * Versi pertama memakainya sebagai denyut tetap, dan akibatnya baru terlihat
 * saat ditulis sebagai test: ketiga anak tangga di bawah 15 detik tidak
 * pernah tercapai, jadi penjualan yang gagal sekali karena gangguan sekejap
 * menunggu 15 detik alih-alih 2. Arahnya memang selalu lebih lambat -- tidak
 * pernah menghantam server lebih keras -- tapi ia membuat kode tidak sepakat
 * dengan spec yang jelas menyebut angka.
 *
 * Sekarang jeda berikutnya = waktu jatuh tempo TERDEKAT, dipotong di 15 detik.
 * Batas atasnya tetap perlu: item yang tertahan dependensi tidak punya waktu
 * jatuh tempo sama sekali, dan tanpa batas ini antrean seperti itu diam
 * selamanya.
 */
export const INTERVAL_MS = 15_000;

/**
 * Lantai jeda. Tanpa ini, item yang jatuh temponya sudah lewat -- misalnya
 * karena dilewati batas 50 per batch -- menghasilkan jeda nol, dan penjadwal
 * berputar tanpa henti.
 */
const JEDA_MINIMUM_MS = 250;

export interface DepsPenjadwal {
  db: DbLokal;
  now: () => number;
  kirim: (baris: BarisOutbox) => Promise<HasilKirim>;
  setTimer: (fn: () => unknown, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  /** Dipanggil bila satu putaran melempar. Tanpa ini kegagalan jadi senyap. */
  onGalat?: (e: Error) => void;
  intervalMs?: number;
  /**
   * Diberi tahu setiap kali satu putaran selesai -- yaitu setiap kali status
   * item di antrean mungkin berubah.
   *
   * Ada karena `watch()` PowerSync butuh ~1.000 ms untuk melihat perubahan
   * pada raw table (diukur), sementara `spec-h:224` menuntut indikator
   * diperbarui < 1 detik. Yang dikirim hanya isyarat baca-ulang, bukan
   * datanya.
   */
  pemberitahu?: Pemberitahu;
}

export interface Penjadwal {
  /** Putaran pertama, sekaligus pemulihan setelah aplikasi mati. */
  mulai(): Promise<void>;
  /** Menjalankan satu putaran segera. Digabung bila satu sedang berjalan. */
  picu(alasan: string): Promise<void>;
  berhenti(): void;
  readonly putaranSelesai: number;
  readonly menganggur: boolean;
  readonly alasanTerakhir: string | null;
}

export function buatPenjadwal(deps: DepsPenjadwal): Penjadwal {
  const interval = deps.intervalMs ?? INTERVAL_MS;

  let handle: unknown = null;
  let dihentikan = false;
  let putaranSelesai = 0;
  let menganggur = false;
  let alasanTerakhir: string | null = null;

  let jalan: Promise<void> | null = null;
  let tertunda: { alasan: string; promise: Promise<void>; selesai: () => void } | null = null;

  function batalkanTimer() {
    if (handle !== null) {
      deps.clearTimer(handle);
      handle = null;
    }
  }

  async function jumlahMenunggu(): Promise<number> {
    const [baris] = await deps.db.getAll<{ n: number }>(
      `SELECT count(*) AS n FROM outbox_local WHERE status IN ('pending','sending')`
    );
    return baris?.n ?? 0;
  }

  /**
   * Jeda sampai item terdekat jatuh tempo, dipotong di `interval`.
   *
   * Dikelompokkan per `attempts` supaya jumlah barisnya terbatas (paling
   * banyak 20, sebesar batas percobaan) alih-alih sebesar antrean. Antrean
   * 5.000 item disebut eksplisit di spec-h §H.6, dan membaca seluruhnya
   * setiap putaran hanya untuk mencari satu nilai minimum akan terasa di
   * perangkat kasir.
   *
   * Item yang belum pernah dicoba (`last_attempt_at IS NULL`) sengaja
   * DIABAIKAN di sini. Ia jatuh tempo sekarang, tapi kalau ia masih
   * `pending` setelah putaran barusan berarti ia tertahan dependensi -- dan
   * menjadwalkan putaran berikutnya nol milidetik lagi hanya menghasilkan
   * putaran sibuk yang tidak mengubah apa pun. Untuk item seperti itu, batas
   * atas 15 detik yang berlaku.
   */
  async function jedaBerikutnyaMs(sekarang: number): Promise<number> {
    const baris = await deps.db.getAll<{ attempts: number; paling_awal: string | null }>(
      `SELECT attempts, MIN(last_attempt_at) AS paling_awal
         FROM outbox_local
        WHERE status = 'pending' AND last_attempt_at IS NOT NULL
        GROUP BY attempts`
    );

    let jeda = interval;
    for (const b of baris) {
      const terakhir = Date.parse(b.paling_awal ?? '');
      if (Number.isNaN(terakhir)) return JEDA_MINIMUM_MS;
      // Jam perangkat dapat MUNDUR. `sudahJatuhTempo` memperlakukan
      // `last_attempt_at` di masa depan sebagai jatuh tempo sekarang; jeda di
      // sini harus setuju dengannya, kalau tidak penjadwal menunggu jam
      // menyusul sementara SQL sudah menganggap itemnya siap.
      const jatuhTempo = terakhir > sekarang ? sekarang : terakhir + jedaBackoffMs(b.attempts);
      jeda = Math.min(jeda, jatuhTempo - sekarang);
    }
    return Math.max(JEDA_MINIMUM_MS, Math.min(interval, jeda));
  }

  async function satuPutaran(alasan: string): Promise<void> {
    alasanTerakhir = alasan;
    try {
      // Dijalankan di SETIAP putaran, bukan hanya saat boot. Baris `sending`
      // hanya bisa tertinggal kalau putaran sebelumnya mati di tengah -- dan
      // putaran tidak pernah tumpang tindih, jadi tidak ada `sending` yang sah
      // di sini. Tanpa ini, satu galat di tengah kirim mengunci item itu
      // selamanya sampai aplikasi di-restart.
      await pulihkanSetelahMati(deps.db);
      await kirimBatch({ db: deps.db, now: deps.now, kirim: deps.kirim });
    } catch (e) {
      deps.onGalat?.(e instanceof Error ? e : new Error(String(e)));
    } finally {
      putaranSelesai += 1;
      // Diberitahukan di `finally`, bukan di jalur sukses: putaran yang
      // melempar di tengah TETAP mungkin sudah memindahkan sebagian item, dan
      // indikator yang tidak diberi tahu akan menampilkan angka lama sampai
      // putaran berikutnya.
      deps.pemberitahu?.beritahu();
    }

    if (dihentikan) return;

    // Antrean kosong -> berhenti berdetak. Penjadwal yang tetap berjalan tiap
    // 15 detik sepanjang jam buka membangunkan database perangkat tanpa ada
    // apa pun untuk dikirim.
    let menunggu = 0;
    try {
      menunggu = await jumlahMenunggu();
    } catch (e) {
      deps.onGalat?.(e instanceof Error ? e : new Error(String(e)));
      menunggu = 1; // tidak tahu -> tetap berdetak, jangan diam
    }

    menganggur = menunggu === 0;
    batalkanTimer();
    if (!menganggur) {
      let jeda = interval;
      try {
        jeda = await jedaBerikutnyaMs(deps.now());
      } catch (e) {
        deps.onGalat?.(e instanceof Error ? e : new Error(String(e)));
      }
      handle = deps.setTimer(() => {
        handle = null;
        // Promise-nya DIKEMBALIKAN, bukan di-`void`. `setTimeout` sungguhan
        // mengabaikannya, tapi timer palsu di test dapat menunggunya -- dan
        // tanpa itu test hanya dapat memeriksa bahwa timer terpasang, bukan
        // bahwa putarannya benar-benar berjalan.
        return minta('interval');
      }, jeda);
    }
  }

  /**
   * Menjalankan satu putaran, atau menggabungkan permintaan yang datang saat
   * satu putaran sedang berjalan.
   *
   * Dua putaran yang tumpang tindih mengirim item yang sama dua kali dalam
   * penerbangan: idempotency key melindungi server, tapi perangkat membakar
   * dua percobaan dan dua kali kuota jaringan untuk satu item. Beberapa
   * pemicu yang datang selama satu putaran digabung jadi SATU putaran
   * susulan, bukan satu putaran per pemicu.
   */
  async function minta(alasan: string): Promise<void> {
    if (dihentikan) return;

    if (jalan) {
      if (!tertunda) {
        let selesai!: () => void;
        const promise = new Promise<void>((r) => {
          selesai = r;
        });
        tertunda = { alasan, promise, selesai };
      }
      return tertunda.promise;
    }

    jalan = satuPutaran(alasan).finally(() => {
      jalan = null;
    });
    await jalan;

    if (tertunda) {
      const susulan = tertunda;
      tertunda = null;
      await minta(susulan.alasan);
      susulan.selesai();
    }
  }

  return {
    async mulai() {
      dihentikan = false;
      await minta('mulai');
    },
    picu(alasan: string) {
      return minta(alasan);
    },
    berhenti() {
      dihentikan = true;
      batalkanTimer();
    },
    get putaranSelesai() {
      return putaranSelesai;
    },
    get menganggur() {
      return menganggur;
    },
    get alasanTerakhir() {
      return alasanTerakhir;
    },
  };
}
