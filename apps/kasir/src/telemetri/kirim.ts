import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import { susunMuatan, tandaiTerkirim, type Muatan } from './rekam.ts';

/**
 * Pengiriman telemetri — jalur naik KEDUA, dan satu-satunya yang boleh
 * menyerah.
 *
 * ## ⛔ Ia BUKAN `outbox_local`, dan perbedaannya disengaja
 *
 * Relay penjualan mencoba selamanya: yang diantrekannya adalah uang merchant,
 * dan satu baris yang menyerah adalah penjualan yang hilang tanpa jejak.
 * Telemetri kebalikannya — buffernya dipangkas, muatan yang ditolak `400`
 * dibuang, dan tidak satu pun kegagalan di sini pernah terlihat kasir.
 *
 * Menyatukannya dengan relay akan menukar sifat itu ke arah yang salah: entah
 * telemetri jadi mencoba selamanya (dan mengisi disk yang penjualan
 * butuhkan), atau relay jadi menyerah.
 *
 * ## ⛔ Timeout PENDEK, dan `AbortController` yang menegakkannya
 *
 * `ARCH:307`: *"fire-and-forget dengan timeout pendek"*. `fetch` tanpa signal
 * dapat menggantung selama menit di jaringan outlet yang setengah hidup, dan
 * penjadwal yang menunggunya berhenti mengirim apa pun sesudahnya.
 */

/** `ARCH:307` — pendek, dan itu poinnya. */
export const TIMEOUT_MS = 5_000;

/** Jeda antar putaran. Jauh lebih longgar daripada relay: ini bukan uang. */
export const INTERVAL_MS = 15 * 60_000;

export interface KonfigKirimTelemetri {
  db: DbLokal;
  baseUrl: string;
  tenantId: string;
  deviceId: string;
  tokenSecret: string;
  appVersion: string;
  fetchFn?: typeof fetch;
  /** Di-inject supaya test tidak menunggu jam dinding. */
  timeoutMs?: number;
  /**
   * Dipanggil dengan selisih jam perangkat terhadap jam SERVER, dalam detik
   * (positif = perangkat mendahului).
   *
   * ⛔ Diukur DI SINI karena di sinilah satu-satunya jawaban server yang
   * telemetri sendiri hasilkan. Mengukurnya di tempat lain berarti menambah
   * permintaan HTTP hanya untuk membaca satu header — dan jalur naik
   * penjualan tidak boleh menanggung biaya telemetri.
   *
   * Header `Date` punya resolusi DETIK dan tidak memperhitungkan waktu
   * tempuh jaringan. Untuk ambang `spec-h:351` (jam perangkat melenceng)
   * itu cukup; untuk apa pun yang lebih halus, ia bukan alat yang benar.
   */
  onSkew?: (detik: number) => void;
  sekarang?: () => number;
}

export type HasilKirimTelemetri =
  /** Tidak ada apa pun untuk dikirim. */
  | { kind: 'kosong' }
  | { kind: 'terkirim'; jumlah: number }
  /** Ditolak permanen — dibuang, karena ia tidak akan pernah diterima. */
  | { kind: 'dibuang'; status: number }
  /** Gagal sementara — baris dipertahankan, batch yang sama diulang. */
  | { kind: 'tertunda'; status: number | null };

/**
 * Kunci idempotensi yang STABIL untuk satu batch.
 *
 * ⛔ Kunci acak per percobaan akan menggandakan jendela setiap kali respons
 * hilang — dan respons yang hilang adalah kejadian normal di jalur ini.
 * Diturunkan dari daftar id supaya percobaan kedua atas batch yang sama
 * menghasilkan kunci yang sama, bahkan setelah aplikasi dimuat ulang.
 *
 * FNV-1a, bukan SHA-256: `crypto.subtle` asinkron dan ini bukan nilai rahasia
 * — yang dibutuhkan hanya fungsi yang sama untuk masukan yang sama.
 */
export function kunciBatch(deviceId: string, id: readonly string[]): string {
  let h = 0x811c9dc5;
  for (const s of [...id].sort()) {
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= 0x2c; // pemisah, supaya ['ab','c'] tidak sama dengan ['a','bc']
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `telemetri:${deviceId}:${id.length}:${h.toString(16)}`;
}

/**
 * Status HTTP yang berarti "jangan coba lagi".
 *
 * ⛔ `401` TIDAK termasuk. Perangkat yang kredensialnya kedaluwarsa akan
 * di-provisioning ulang, dan metrik dari masa ia tidak terhubung justru yang
 * menjelaskan kenapa. Yang dibuang hanya muatan yang bentuknya tidak akan
 * pernah diterima.
 */
function permanen(status: number): boolean {
  return status === 400 || status === 404 || status === 413 || status === 422;
}

export function buatPengirimTelemetri(konfig: KonfigKirimTelemetri) {
  const fetchFn = konfig.fetchFn ?? fetch;
  const timeoutMs = konfig.timeoutMs ?? TIMEOUT_MS;
  const sekarang = konfig.sekarang ?? (() => Date.now());
  // Batch yang sudah pernah dikirim tapi belum dikonfirmasi. Ia dipertahankan
  // di memori supaya percobaan berikutnya mengirim BATCH YANG SAMA — lihat
  // `susunMuatan({ hanyaId })`.
  let tertunda: string[] | null = null;

  async function kirimSekali(): Promise<HasilKirimTelemetri> {
    const disusun = await susunMuatan(konfig.db, {
      appVersion: konfig.appVersion,
      hanyaId: tertunda ?? undefined,
    });
    if (disusun === null) {
      tertunda = null;
      return { kind: 'kosong' };
    }
    const { muatan, idTerbaca } = disusun;
    tertunda = idTerbaca;

    const hasil = await antar(muatan, kunciBatch(konfig.deviceId, idTerbaca));
    if (hasil === null) return { kind: 'tertunda', status: null };

    if (hasil.ok) {
      // ⛔ Dihapus SETELAH server menjawab, tidak sebelum. Menghapus lebih
      // dulu berarti kegagalan jaringan membuang metrik yang justru
      // menjelaskan kegagalan itu.
      await tandaiTerkirim(konfig.db, idTerbaca);
      tertunda = null;
      return { kind: 'terkirim', jumlah: muatan.events.length };
    }
    if (permanen(hasil.status)) {
      await tandaiTerkirim(konfig.db, idTerbaca);
      tertunda = null;
      return { kind: 'dibuang', status: hasil.status };
    }
    return { kind: 'tertunda', status: hasil.status };
  }

  /** Membaca `Date` respons dan melaporkan selisihnya. Diam bila tak ada. */
  function catatSkew(res: { headers?: { get(nama: string): string | null } }): void {
    const teks = res.headers?.get('Date');
    if (typeof teks !== 'string') return;
    const server = Date.parse(teks);
    if (Number.isNaN(server)) return;
    konfig.onSkew?.((sekarang() - server) / 1000);
  }

  async function antar(muatan: Muatan, kunci: string): Promise<{ ok: boolean; status: number } | null> {
    const pembatal = new AbortController();
    const jam = setTimeout(() => pembatal.abort(), timeoutMs);
    try {
      const res = await fetchFn(
        `${konfig.baseUrl}/devices/${encodeURIComponent(konfig.deviceId)}/telemetry`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Tenant-Id': konfig.tenantId,
            Authorization: `Bearer ${konfig.tokenSecret}`,
            'Idempotency-Key': kunci,
          },
          body: JSON.stringify(muatan),
          signal: pembatal.signal,
        }
      );
      catatSkew(res);
      return { ok: res.ok, status: res.status };
    } catch {
      // Jaringan putus, atau timeout. `null` = coba lagi nanti.
      return null;
    } finally {
      clearTimeout(jam);
    }
  }

  return { kirimSekali };
}

export interface PenjadwalTelemetri {
  hentikan(): void;
}

/**
 * Menjalankan pengiriman berkala.
 *
 * ⛔ Kegagalan DITELAN di sini juga. Penjadwal yang melempar akan mematikan
 * dirinya sendiri pada putaran pertama yang gagal, dan sesudah itu tidak ada
 * satu pun metrik yang naik — tanpa satu pun error yang terlihat.
 */
export function jalankanTelemetri(
  kirimSekali: () => Promise<unknown>,
  opsi: {
    intervalMs?: number;
    setTimer?: (fn: () => unknown, ms: number) => unknown;
    clearTimer?: (h: unknown) => void;
  } = {}
): PenjadwalTelemetri {
  const intervalMs = opsi.intervalMs ?? INTERVAL_MS;
  const setTimer = opsi.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opsi.clearTimer ?? ((h) => clearTimeout(h as number));

  let berhenti = false;
  let pegangan: unknown = null;

  const putaran = async () => {
    try {
      await kirimSekali();
    } catch {
      // Ditelan. Lihat catatan di atas.
    }
    if (!berhenti) pegangan = setTimer(putaran, intervalMs);
  };

  pegangan = setTimer(putaran, intervalMs);

  return {
    hentikan() {
      berhenti = true;
      if (pegangan !== null) clearTimer(pegangan);
    },
  };
}
