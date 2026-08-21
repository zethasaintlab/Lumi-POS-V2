/**
 * Aturan rilis — `ARCH:§12`, KEP-36.
 *
 * Kafe tidak peduli fitur baru. Yang mereka pedulikan adalah jam 12:00–14:00
 * dan 18:00–21:00 tidak ada yang berubah. Seluruh isi berkas ini mengikuti
 * dari kalimat itu.
 *
 * ## ⛔ Yang ADA di sini, dan yang TIDAK
 *
 * Yang ada: **keputusan**. Perangkat mana yang termasuk tahap ini, boleh
 * dipasang jam berapa, boleh ditunda berapa kali, dan kapan sebuah tahap
 * boleh naik.
 *
 * Yang TIDAK ada: **pemasangannya**. Mengunduh dan memasang versi baru
 * menuntut shell Tauri, dan itu utang F4 yang tercatat. Berkas ini menjawab
 * "versi mana yang seharusnya", bukan "pasang sekarang" — dan memisahkan
 * keduanya berarti updater yang lahir kelak tinggal menempel, bukan
 * memutuskan ulang.
 *
 * Semuanya fungsi MURNI: waktu di-inject, tidak ada I/O, tidak ada `Date.now`.
 */

/**
 * Tahap rollout dan persentase merchant yang dicakupnya. `ARCH:355`.
 *
 * ⛔ Persentase MERCHANT, bukan perangkat. Satu outlet dengan tiga kasir
 * tidak boleh terbelah dua versi: ketiganya berbagi shift, printer, dan
 * nomor struk, dan selisih versi di antara mereka adalah tepat beban
 * multi-versi yang KEP-36 ingin hindari — dialami dalam satu ruangan.
 */
export const TAHAP_ROLLOUT = ['kanari', 'lima', 'duapuluhlima', 'penuh'] as const;

export type TahapRollout = (typeof TAHAP_ROLLOUT)[number];

export function adalahTahapRollout(nilai: unknown): nilai is TahapRollout {
  return typeof nilai === 'string' && (TAHAP_ROLLOUT as readonly string[]).includes(nilai);
}

/**
 * Cakupan tiap tahap dalam persen merchant.
 *
 * `kanari` adalah **nol persen**, dan itu bukan salah ketik: kanari internal
 * adalah tenant yang ditandai eksplisit (`tenant.is_canary`), bukan irisan
 * acak. Merchant sungguhan tidak pernah menjadi kanari tanpa memilihnya.
 */
export const CAKUPAN_TAHAP: Record<TahapRollout, number> = {
  kanari: 0,
  lima: 5,
  duapuluhlima: 25,
  penuh: 100,
};

/** Jeda minimum sebelum tahap boleh naik. `ARCH:355`. */
export const JEDA_TAHAP_JAM = 24;

/** Berapa kali merchant boleh menunda sebelum update menjadi wajib. */
export const MAKS_TUNDA = 2;

/**
 * Kohort merchant untuk satu versi: bilangan `0..99`.
 *
 * ⛔ Dua sifat yang harus berlaku bersamaan, dan keduanya diuji:
 *
 *   1. **Subset.** Merchant yang masuk 5% juga masuk 25% dan 100%. Kalau
 *      tidak, merchant dapat NAIK ke versi baru lalu TURUN lagi saat tahap
 *      berikutnya membentuk irisan yang berbeda — dan rollback skema lokal
 *      "hampir mustahil" (KEP-36).
 *   2. **Di-garam per VERSI.** Tanpa garam, merchant yang kebetulan berkohort
 *      rendah menjadi kelinci percobaan untuk **setiap** rilis, selamanya.
 *      Risikonya harus berpindah-pindah.
 *
 * FNV-1a: bukan nilai rahasia, dan yang dibutuhkan hanya fungsi yang sama
 * untuk masukan yang sama — termasuk di seberang proses dan seberang rilis.
 */
export function kohort(tenantId: string, versi: string): number {
  const teks = `${versi}:${tenantId}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < teks.length; i += 1) {
    h ^= teks.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 100;
}

/**
 * Apakah merchant ini termasuk dalam tahap yang sedang berjalan.
 *
 * `isKanari` datang dari `tenant`, bukan dari hash: kanari adalah pilihan,
 * bukan undian.
 */
export function termasukTahap(
  tenantId: string,
  versi: string,
  tahap: TahapRollout,
  isKanari: boolean
): boolean {
  // ⛔ Kanari mendapat SETIAP tahap, termasuk yang paling awal. Kanari yang
  // baru menerima versi pada tahap 25% tidak menguji apa pun — ia hanya
  // merchant biasa dengan label.
  if (isKanari) return true;
  return kohort(tenantId, versi) < CAKUPAN_TAHAP[tahap];
}

/**
 * Jendela update — jam yang boleh, dalam waktu LOKAL OUTLET.
 *
 * Bawaan `ARCH:353`: 03:00–06:00. Dapat dikonfigurasi karena outlet 24 jam
 * ada, dan bagi mereka 03:00 adalah jam sibuk.
 */
export interface JendelaUpdate {
  /** Jam mulai, 0–23, waktu lokal outlet. */
  mulaiJam: number;
  /** Jam selesai, 0–23, eksklusif. */
  selesaiJam: number;
}

export const JENDELA_BAWAAN: JendelaUpdate = { mulaiJam: 3, selesaiJam: 6 };

/**
 * Apakah `jamLokal` berada di dalam jendela.
 *
 * ⛔ Jendela yang MELEWATI TENGAH MALAM sah dan harus bekerja: outlet yang
 * tutup jam 02:00 memilih 23:00–02:00, dan perbandingan naif
 * (`mulai <= jam && jam < selesai`) menjawab "tidak pernah" untuknya — update
 * yang tidak pernah terpasang, tanpa satu pun error.
 */
export function dalamJendela(jamLokal: number, jendela: JendelaUpdate = JENDELA_BAWAAN): boolean {
  const { mulaiJam, selesaiJam } = jendela;
  if (!Number.isInteger(jamLokal) || jamLokal < 0 || jamLokal > 23) return false;
  if (mulaiJam === selesaiJam) return false; // jendela kosong, bukan jendela penuh
  if (mulaiJam < selesaiJam) return jamLokal >= mulaiJam && jamLokal < selesaiJam;
  return jamLokal >= mulaiJam || jamLokal < selesaiJam;
}

export function jendelaSah(jendela: JendelaUpdate): boolean {
  const { mulaiJam, selesaiJam } = jendela;
  return (
    Number.isInteger(mulaiJam) &&
    Number.isInteger(selesaiJam) &&
    mulaiJam >= 0 &&
    mulaiJam <= 23 &&
    selesaiJam >= 0 &&
    selesaiJam <= 23 &&
    mulaiJam !== selesaiJam
  );
}

/**
 * Kategori yang membuat update WAJIB SEGERA — daftar TERTUTUP.
 *
 * `ARCH:356`: *"**Hanya** keamanan atau bug kehilangan data; kategori ini
 * didefinisikan tertulis dan harus jarang."* Daftar tertutup ADALAH definisi
 * tertulisnya; tanpa itu setiap rilis akan menemukan alasan untuk menjadi
 * mendesak, dan jendela update berhenti berarti apa pun.
 */
export const ALASAN_WAJIB_SEGERA = ['keamanan', 'kehilangan_data'] as const;

export type AlasanWajibSegera = (typeof ALASAN_WAJIB_SEGERA)[number];

export function adalahAlasanWajibSegera(nilai: unknown): nilai is AlasanWajibSegera {
  return typeof nilai === 'string' && (ALASAN_WAJIB_SEGERA as readonly string[]).includes(nilai);
}

export interface KeputusanUpdate {
  /** Versi yang seharusnya dipakai perangkat ini, atau `null`. */
  versi: string | null;
  /** Boleh dipasang SEKARANG. */
  pasangSekarang: boolean;
  /** Merchant masih boleh menekan "nanti saja". */
  bolehTunda: boolean;
  /**
   * Kenapa jawabannya begitu. Kode, bukan kalimat — layar yang
   * menerjemahkannya, dan kalimat yang lahir di server tidak dapat
   * diterjemahkan ulang.
   */
  alasan:
    | 'tidak_ada_rilis'
    | 'sudah_terbaru'
    | 'belum_giliran'
    | 'di_luar_jendela'
    | 'wajib_segera'
    | 'terjadwal';
}

export interface KonteksUpdate {
  /** Versi yang sedang berjalan di perangkat. */
  versiPerangkat: string;
  tenantId: string;
  isKanari: boolean;
  /** Jam lokal outlet, 0–23. */
  jamLokal: number;
  jendela?: JendelaUpdate;
  /** Berapa kali merchant sudah menunda versi ini. */
  sudahTunda: number;
}

export interface RilisAktif {
  versi: string;
  tahap: TahapRollout;
  /** Diisi hanya bila rilis ini wajib segera. */
  wajibSegera: AlasanWajibSegera | null;
}

/**
 * Apa yang perangkat ini harus lakukan.
 *
 * ⛔ Urutan pemeriksaannya BUKAN selera. "Wajib segera" mendahului jendela
 * dan penundaan justru karena kategorinya tertutup: yang lolos ke sana hanya
 * kehilangan data dan lubang keamanan, dan menunggu jam 03:00 untuk keduanya
 * berarti membiarkan kerusakan berjalan semalaman.
 *
 * Sebaliknya "belum giliran" mendahului segalanya: merchant yang belum masuk
 * tahap tidak boleh memasang apa pun, bahkan update yang mendesak — tahapnya
 * yang harus dinaikkan lebih dulu, dan itu keputusan yang diambil orang.
 */
export function putuskanUpdate(rilis: RilisAktif | null, ctx: KonteksUpdate): KeputusanUpdate {
  if (rilis === null) {
    return { versi: null, pasangSekarang: false, bolehTunda: false, alasan: 'tidak_ada_rilis' };
  }
  if (rilis.versi === ctx.versiPerangkat) {
    return { versi: rilis.versi, pasangSekarang: false, bolehTunda: false, alasan: 'sudah_terbaru' };
  }
  if (!termasukTahap(ctx.tenantId, rilis.versi, rilis.tahap, ctx.isKanari)) {
    return { versi: null, pasangSekarang: false, bolehTunda: false, alasan: 'belum_giliran' };
  }
  if (rilis.wajibSegera !== null) {
    return { versi: rilis.versi, pasangSekarang: true, bolehTunda: false, alasan: 'wajib_segera' };
  }
  if (!dalamJendela(ctx.jamLokal, ctx.jendela)) {
    return {
      versi: rilis.versi,
      pasangSekarang: false,
      // ⛔ Penundaan tetap dapat DIPILIH di luar jendela, dan itu disengaja:
      // "nanti saja" adalah jawaban atas pemberitahuan, bukan atas
      // pemasangan. Menyembunyikannya sampai jam 03:00 berarti merchant hanya
      // dapat menunda saat ia sedang tidur.
      bolehTunda: ctx.sudahTunda < MAKS_TUNDA,
      alasan: 'di_luar_jendela',
    };
  }
  return {
    versi: rilis.versi,
    pasangSekarang: true,
    bolehTunda: ctx.sudahTunda < MAKS_TUNDA,
    alasan: 'terjadwal',
  };
}

/**
 * Tahap berikutnya, atau `null` bila sudah penuh.
 */
export function tahapBerikutnya(tahap: TahapRollout): TahapRollout | null {
  const i = TAHAP_ROLLOUT.indexOf(tahap);
  return i < 0 || i === TAHAP_ROLLOUT.length - 1 ? null : TAHAP_ROLLOUT[i + 1];
}

export interface GateTahap {
  /** Jam sejak tahap ini dimasuki. */
  jamDiTahap: number;
  /** Crash per 1.000 sesi pada versi kandidat. `null` = belum terukur. */
  crashKandidat: number | null;
  /** Crash per 1.000 sesi pada versi sebelumnya. `null` = belum terukur. */
  crashBaseline: number | null;
}

export type HasilGate =
  | { boleh: true }
  | { boleh: false; sebab: 'jeda_belum_cukup' | 'crash_naik' | 'belum_terukur' | 'sudah_penuh' };

/**
 * Apakah tahap boleh naik. `ARCH:355`: jeda ≥ 24 jam DAN gate crash rate.
 *
 * ⛔ **`null` menahan, tidak meloloskan.** Crash rate yang belum terukur
 * berarti belum ada cukup perangkat di versi kandidat yang melapor — dan
 * "belum ada data" adalah alasan untuk MENUNGGU, bukan untuk melanjutkan.
 * Meloloskannya membuat gate ini menyala hanya pada rilis yang sudah cukup
 * lama berjalan untuk tidak membutuhkannya.
 *
 * ⛔ **Naik SAMA SEKALI tidak boleh**, bukan "naik sedikit boleh".
 * `ARCH:304` menulis ambangnya `> baseline versi sebelumnya`. Toleransi di
 * sini adalah angka yang harus dipilih seseorang, dan tidak ada di dokumen
 * mana pun — jadi ia tidak dikarang di kode.
 */
export function bolehNaikTahap(tahap: TahapRollout, gate: GateTahap): HasilGate {
  if (tahapBerikutnya(tahap) === null) return { boleh: false, sebab: 'sudah_penuh' };
  if (gate.jamDiTahap < JEDA_TAHAP_JAM) return { boleh: false, sebab: 'jeda_belum_cukup' };
  if (gate.crashKandidat === null || gate.crashBaseline === null) {
    return { boleh: false, sebab: 'belum_terukur' };
  }
  if (gate.crashKandidat > gate.crashBaseline) return { boleh: false, sebab: 'crash_naik' };
  return { boleh: true };
}
