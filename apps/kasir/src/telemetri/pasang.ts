import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import { ringkasanAntrean } from '../../../../packages/sync-client/src/status.ts';
import {
  umurAntreanJam,
} from '../../../../packages/domain/src/antrean-menua.ts';
import type { ModeTelemetri } from '../../../../packages/domain/src/telemetri.ts';
import { catat, lepasSink, pasangSink } from './sink.ts';
import { pangkas, rekam } from './rekam.ts';
import { buatPengirimTelemetri, jalankanTelemetri, type PenjadwalTelemetri } from './kirim.ts';

/**
 * Menyalakan telemetri: sink, pengamat, dan penjadwal kirim. Satu tempat.
 *
 * ⛔ Berkas ini adalah SATU-SATUNYA yang tahu bagaimana potongan-potongannya
 * dirakit. Layar dan jalur cetak hanya memanggil `catat()` — mereka tidak
 * tahu ada buffer, penjadwal, atau endpoint, dan karena itu tidak dapat
 * membuat salah satunya gagal.
 *
 * ## ⛔ `mode === 'off'` berarti TIDAK ADA yang dipasang
 *
 * Bukan sink yang membuang, bukan penjadwal yang mengirim nol. Tidak ada
 * pendengar, tidak ada timer, tidak ada baris database. Merchant yang memilih
 * `off` sedang berkata persis itu, dan "dikumpulkan lalu dibuang" adalah
 * jawaban yang berbeda dari "tidak dikumpulkan".
 */

/** Jeda pengambilan sampel kesehatan antrean. */
export const INTERVAL_SAMPEL_MS = 5 * 60_000;

export interface KonfigTelemetri {
  db: DbLokal;
  mode: ModeTelemetri;
  baseUrl: string;
  tenantId: string;
  deviceId: string;
  tokenSecret: string;
  appVersion: string;
  fetchFn?: typeof fetch;
  intervalKirimMs?: number;
  intervalSampelMs?: number;
  setTimer?: (fn: () => unknown, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  sekarang?: () => number;
}

export interface TelemetriHidup {
  /** Diekspor supaya test dan boot dapat memanggilnya tanpa menunggu timer. */
  sampelAntrean(): Promise<void>;
  kirimSekarang(): Promise<unknown>;
  hentikan(): void;
}

export function pasangTelemetri(konfig: KonfigTelemetri): TelemetriHidup | null {
  if (konfig.mode === 'off') return null;

  const sekarang = konfig.sekarang ?? (() => Date.now());
  const setTimer = konfig.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = konfig.clearTimer ?? ((h) => clearTimeout(h as number));

  pasangSink((event, nilai, tipe) => {
    void rekam({ db: konfig.db, mode: konfig.mode }, event, nilai, tipe ?? null);
  });

  // Perangkat yang menyala setelah lama offline sudah melewati batas sebelum
  // satu penulisan pun terjadi — jadi pemangkasan berjalan sekali di sini,
  // bukan hanya setiap `SETIAP_PANGKAS` penulisan.
  void pangkas(konfig.db);

  const pengirim = buatPengirimTelemetri({
    db: konfig.db,
    baseUrl: konfig.baseUrl,
    tenantId: konfig.tenantId,
    deviceId: konfig.deviceId,
    tokenSecret: konfig.tokenSecret,
    appVersion: konfig.appVersion,
    fetchFn: konfig.fetchFn,
    sekarang,
    // ⛔ Jam perangkat yang melenceng adalah sebab akar yang menjelaskan
    // gejala-gejala lain: nomor struk yang berurutan mundur, HLC yang turun,
    // umur antrean yang terbaca negatif. Ia diukur dari satu-satunya jawaban
    // server yang telemetri sendiri hasilkan.
    onSkew: (detik) => catat('selisih_jam_detik', detik),
  });

  // --- kesehatan antrean ----------------------------------------------------
  //
  // ⛔ Diambil dari `ringkasanAntrean` — fungsi yang SAMA dengan indikator
  // sinkronisasi dan K-14. Query kedua yang menghitung "berapa yang gagal"
  // akan menyimpang dari yang dilihat kasir, dan yang menyimpang di antara
  // keduanya tidak dapat diputuskan mana yang benar.
  async function sampelAntrean(): Promise<void> {
    try {
      const r = await ringkasanAntrean(konfig.db);
      catat('antrean_gagal', r.gagal);
      const umur = umurAntreanJam(r.tertuaPada, sekarang());
      // `null` berarti tidak ada yang mengantre — dan itu BUKAN "berumur 0
      // jam". Mengirim 0 membuat rata-rata umur antrean turun setiap kali
      // antrean kosong, tepat pada perangkat yang paling sehat.
      if (umur !== null) catat('umur_antrean_jam', umur);
    } catch {
      // Ditelan, seperti semua jalur telemetri.
    }
  }

  // --- crash ----------------------------------------------------------------
  //
  // ⛔ Yang dikirim adalah NAMA tipe error, tidak pernah pesannya. Pesan dapat
  // memuat nama produk ("Kopi Susu tidak ditemukan") dan nilai transaksi;
  // `ARCH:309` melarang keduanya, dan pemotongan di lapisan bawah adalah
  // jaring, bukan aturan.
  const saatError = (e: ErrorEvent) => {
    catat('crash', 1, e.error instanceof Error ? e.error.name : 'Error');
  };
  const saatTolakan = (e: PromiseRejectionEvent) => {
    catat('crash', 1, e.reason instanceof Error ? e.reason.name : 'UnhandledRejection');
  };

  // --- rasio offline --------------------------------------------------------
  //
  // Dicatat saat koneksi KEMBALI, dengan lama padamnya. Mencatat saat padam
  // berarti mencatat angka yang belum diketahui; mencatatnya berkala berarti
  // menulis ke buffer justru saat ia tidak dapat dikuras.
  let padamSejak: number | null = null;
  const saatOffline = () => {
    padamSejak = sekarang();
  };
  const saatOnline = () => {
    if (padamSejak === null) return;
    const detik = Math.max(0, (sekarang() - padamSejak) / 1000);
    padamSejak = null;
    catat('offline_detik', detik);
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('error', saatError);
    window.addEventListener('unhandledrejection', saatTolakan);
    window.addEventListener('offline', saatOffline);
    window.addEventListener('online', saatOnline);
  }

  // --- penjadwal ------------------------------------------------------------
  const sampelMs = konfig.intervalSampelMs ?? INTERVAL_SAMPEL_MS;
  let berhenti = false;
  let peganganSampel: unknown = setTimer(async function ulang() {
    await sampelAntrean();
    if (!berhenti) peganganSampel = setTimer(ulang, sampelMs);
  }, sampelMs);

  const penjadwal: PenjadwalTelemetri = jalankanTelemetri(pengirim.kirimSekali, {
    intervalMs: konfig.intervalKirimMs,
    setTimer,
    clearTimer,
  });

  return {
    sampelAntrean,
    kirimSekarang: pengirim.kirimSekali,
    hentikan() {
      berhenti = true;
      clearTimer(peganganSampel);
      penjadwal.hentikan();
      lepasSink();
      if (typeof window !== 'undefined') {
        window.removeEventListener('error', saatError);
        window.removeEventListener('unhandledrejection', saatTolakan);
        window.removeEventListener('offline', saatOffline);
        window.removeEventListener('online', saatOnline);
      }
    },
  };
}
