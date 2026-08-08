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

import type { DbLokal, HasilKirim, BarisOutbox } from './ports.ts';
import { kirimBatch, pulihkanSetelahMati } from './relay.ts';

/**
 * `[ASUMSI]` 15 detik -- disetujui user 8 Agustus 2026. Tidak ada spec yang
 * menyebut angka ini; spec hanya mengatur backoff PER ITEM (2/4/8/16/32/60),
 * dan itu tetap berlaku di atas interval ini: item yang belum jatuh tempo
 * dilewati di SQL, jadi putaran yang lebih sering tidak mempercepat retry-nya.
 */
export const INTERVAL_MS = 15_000;

export interface DepsPenjadwal {
  db: DbLokal;
  now: () => number;
  kirim: (baris: BarisOutbox) => Promise<HasilKirim>;
  setTimer: (fn: () => unknown, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  /** Dipanggil bila satu putaran melempar. Tanpa ini kegagalan jadi senyap. */
  onGalat?: (e: Error) => void;
  intervalMs?: number;
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
      handle = deps.setTimer(() => {
        handle = null;
        // Promise-nya DIKEMBALIKAN, bukan di-`void`. `setTimeout` sungguhan
        // mengabaikannya, tapi timer palsu di test dapat menunggunya -- dan
        // tanpa itu test hanya dapat memeriksa bahwa timer terpasang, bukan
        // bahwa putarannya benar-benar berjalan.
        return minta('interval');
      }, interval);
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
