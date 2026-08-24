/**
 * FR-C3 — apakah server BENAR-BENAR dapat dijangkau sekarang.
 *
 * ## ⛔ `navigator.onLine === true` BUKAN bukti, dan ini bukan kehati-hatian
 * berlebihan
 *
 * Browser melaporkan keadaan ANTARMUKA JARINGAN, bukan keterjangkauan. Ia
 * `true` untuk kafe yang Wi-Fi-nya menyala tetapi uplink-nya mati, untuk
 * captive portal yang belum di-login, dan untuk DNS yang tidak menjawab.
 * Ketiganya adalah keadaan yang benar-benar terjadi di outlet, dan ketiganya
 * membuat metode online-only tampil AKTIF lalu gagal — persis yang
 * `spec-c:272` larang: *"Tidak ada jalur yang memungkinkan kasir memilih QRIS
 * dinamis saat offline lalu gagal."*
 *
 * Arahnya karena itu asimetris, dan itu yang membuat modul ini kecil:
 *
 * - `navigator.onLine === false` → **pasti** tidak terjangkau. Browser tahu
 *   tidak ada antarmuka sama sekali; tidak ada gunanya menembak.
 * - `navigator.onLine === true` → **belum tahu**. Yang menjawabnya hanya
 *   permintaan yang benar-benar sampai.
 *
 * ## ⛔ Yang diprobe adalah SERVER KAMI, bukan internet
 *
 * Yang harus dijangkau untuk QRIS dinamis adalah server kami — dialah yang
 * memanggil gateway. Perangkat yang dapat membuka Google tetapi tidak dapat
 * mencapai server kami tetap tidak dapat memakai QRIS dinamis, dan probe ke
 * pihak ketiga akan berkata sebaliknya.
 *
 * ## ⛔ Ia TIDAK menghentikan penjualan apa pun
 *
 * Modul ini hanya menyalakan dan mematikan satu pilihan di layar. Kegagalan
 * probe berarti "metode online tidak tersedia", bukan "kasir tidak dapat
 * berjualan" — dan itulah kenapa setiap kegagalannya ditelan menjadi
 * `false` alih-alih dilempar.
 */

export type KeadaanJangkauan = 'terjangkau' | 'tidak' | 'memeriksa';

export interface OpsiJangkauan {
  baseUrl: string;
  /** Di-inject supaya modul ini dapat diuji tanpa jaringan maupun browser. */
  fetchFn?: typeof fetch;
  /** Sumber `navigator.onLine`. `undefined` di lingkungan tanpa browser. */
  daring?: () => boolean;
  /** Jeda antar-probe saat layar yang memakainya terbuka. */
  intervalMs?: number;
  /**
   * ⛔ Batas waktu probe. Tanpa ini, jaringan yang menggantung membuat
   * layar menampilkan "memeriksa" selamanya — dan kasir menunggu jawaban
   * yang tidak akan datang, di depan pelanggan.
   */
  batasMs?: number;
  pasangPendengar?: (nama: 'online' | 'offline', fn: () => void) => () => void;
}

const INTERVAL_BAWAAN = 15_000;
const BATAS_BAWAAN = 4_000;

/**
 * Satu kali probe. `true` hanya bila server benar-benar menjawab.
 *
 * ⛔ Status HTTP apa pun yang SAMPAI dihitung terjangkau, termasuk 5xx. Yang
 * ditanyakan adalah "apakah permintaan saya sampai ke server", bukan "apakah
 * server sehat" — server yang menjawab 503 tetap dapat menerima order dan
 * memanggil gateway pada percobaan berikutnya, sementara lemparan `fetch`
 * berarti tidak ada apa pun di ujung sana.
 */
export async function periksaJangkauan(o: OpsiJangkauan): Promise<boolean> {
  const daring = o.daring ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  if (!daring()) return false;

  const ambil = o.fetchFn ?? fetch;
  const batas = o.batasMs ?? BATAS_BAWAAN;
  const pembatal = new AbortController();
  const jam = setTimeout(() => pembatal.abort(), batas);
  try {
    await ambil(`${o.baseUrl.replace(/\/+$/, '')}/health`, {
      method: 'GET',
      signal: pembatal.signal,
      // ⛔ `no-store`. Probe yang dijawab dari cache HTTP melaporkan
      // keterjangkauan yang benar beberapa menit yang lalu — dan beberapa
      // menit adalah seluruh durasi satu antrean pelanggan.
      cache: 'no-store',
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(jam);
  }
}

export interface PemantauJangkauan {
  keadaan: () => KeadaanJangkauan;
  /** Mengembalikan fungsi pembatal langganan. */
  langgan: (dengar: (k: KeadaanJangkauan) => void) => () => void;
  /** Memeriksa sekarang juga, di luar jadwal. */
  periksaSekarang: () => Promise<void>;
  hentikan: () => void;
}

/**
 * Pemantau yang hidup selama layar yang memakainya terbuka.
 *
 * ⛔ `spec-c:277` menuntut metode aktif kembali **tanpa perlu menutup layar**.
 * Itu yang membuat modul ini berlangganan peristiwa `online`/`offline` DAN
 * menjadwalkan probe berkala: peristiwa `online` datang seketika tetapi hanya
 * berarti antarmuka hidup, dan probe berkala menangkap uplink yang pulih tanpa
 * peristiwa apa pun (kasus captive portal yang baru di-login).
 */
export function pantauJangkauan(o: OpsiJangkauan): PemantauJangkauan {
  const interval = o.intervalMs ?? INTERVAL_BAWAAN;
  const pendengar = new Set<(k: KeadaanJangkauan) => void>();
  let keadaan: KeadaanJangkauan = 'memeriksa';
  let jam: ReturnType<typeof setInterval> | null = null;
  let hidup = true;
  const lepas: (() => void)[] = [];

  const setel = (baru: KeadaanJangkauan) => {
    if (baru === keadaan) return;
    keadaan = baru;
    for (const d of [...pendengar]) {
      try {
        d(baru);
      } catch {
        // Satu pelanggan yang melempar tidak boleh menghalangi sisanya — pola
        // yang sama dengan `buatPemberitahu` di packages/sync-client.
      }
    }
  };

  const periksa = async () => {
    if (!hidup) return;
    const hasil = await periksaJangkauan(o);
    if (!hidup) return;
    setel(hasil ? 'terjangkau' : 'tidak');
  };

  const pasang = o.pasangPendengar;
  if (pasang) {
    // ⛔ `offline` menjawab SEKETIKA tanpa probe: browser tahu antarmukanya
    // hilang, dan menunggu probe timeout berarti kasir melihat metode yang
    // aktif selama empat detik setelah Wi-Fi mati.
    lepas.push(pasang('offline', () => setel('tidak')));
    // `online` TIDAK langsung menyalakan — ia hanya memicu probe. Antarmuka
    // yang hidup bukan server yang terjangkau.
    lepas.push(pasang('online', () => void periksa()));
  }

  void periksa();
  jam = setInterval(() => void periksa(), interval);

  return {
    keadaan: () => keadaan,
    langgan(dengar) {
      pendengar.add(dengar);
      return () => {
        pendengar.delete(dengar);
      };
    },
    periksaSekarang: periksa,
    hentikan() {
      hidup = false;
      if (jam !== null) clearInterval(jam);
      jam = null;
      for (const l of lepas) l();
      pendengar.clear();
    },
  };
}
