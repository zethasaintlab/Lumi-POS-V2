/**
 * Aturan kuota. Murni: tanpa I/O, tanpa database.
 *
 * ## ⛔ Aturan mutlak: kuota TIDAK PERNAH menghentikan penjualan
 *
 * `research/09` § 6: *"tidak ada kuota yang boleh menghentikan penjualan.
 * Semua penegakan terjadi pada operasi administratif (membuat outlet,
 * menambah produk), tidak pernah pada alur kasir."*
 *
 * Definition of Done `CLAUDE.md` menuntut hal yang sama: *"Perilaku saat
 * kuota terlampaui didefinisikan — dan tidak menghentikan penjualan."*
 *
 * Konsekuensi yang tidak boleh dilunakkan: **volume transaksi bukan dimensi
 * kuota, dan tidak akan pernah menjadi dimensi kuota.** Ia dipakai untuk
 * metering dan penagihan, bukan untuk penolakan. Itu ditegakkan dua kali —
 * `DIMENSI_KUOTA` di bawah, dan penjaga yang memindai jalur kasir
 * (`tests/domain/kuota-tidak-di-jalur-kasir.test.js`).
 *
 * ## Kenapa modul ini tidak menghitung apa pun sendiri
 *
 * Ia menerima `terpakai` sebagai angka. Yang MENGHITUNGnya adalah modul
 * pemilik tabelnya (invariant #4): catalog tahu bahwa produk yang diarsipkan
 * tidak dihitung, identity tahu bahwa perangkat yang dicabut tidak dihitung.
 * Memindahkan pengetahuan itu ke sini akan membuat modul kuota perlu tahu
 * aturan arsip setiap modul lain.
 */

export type DimensiKuota = 'outlet' | 'device' | 'pengguna' | 'produk';

/**
 * ⛔ Daftar TERTUTUP. `transaksi`, `order`, `penjualan`, dan `omzet` tidak
 * ada di sini, dan menambahkannya berarti membangun kemampuan menghentikan
 * penjualan — hal yang `research/09` § 6 larang secara eksplisit.
 */
export const DIMENSI_KUOTA: readonly DimensiKuota[] = ['outlet', 'device', 'pengguna', 'produk'];

const LABEL: Readonly<Record<DimensiKuota, string>> = {
  outlet: 'outlet',
  device: 'perangkat',
  pengguna: 'pengguna',
  produk: 'produk',
};

export interface PermintaanKuota {
  dimensi: DimensiKuota;
  /** Jumlah yang sudah dipakai tenant ini, dihitung modul pemilik tabelnya. */
  terpakai: number;
  /** `null` = tanpa batas. Bukan angka besar. */
  batas: number | null;
  /** Berapa yang akan ditambahkan operasi ini. Impor mengirim seluruh berkas. */
  tambahan: number;
}

export type HasilKuota =
  | { ok: true }
  | { ok: false; kode: 'QUOTA_EXCEEDED'; dimensi: DimensiKuota; pesan: string };

export function periksaKuota(permintaan: PermintaanKuota): HasilKuota {
  const { dimensi, terpakai, batas, tambahan } = permintaan;

  // Fail-closed, sama seperti `bolehkah` di rbac.ts — tapi ke arah yang
  // berlawanan, dan itu disengaja. Di sana operasi tak dikenal DITOLAK; di
  // sini dimensi tak dikenal MELEMPAR. Menolak diam-diam akan membuat setiap
  // pemanggil dengan salah ketik menerima "kuota habis" yang tidak dapat
  // dijelaskan; meloloskan diam-diam akan membuat satu titik penegakan mati
  // tanpa satu pun error. Melempar adalah satu-satunya yang terlihat.
  if (!DIMENSI_KUOTA.includes(dimensi)) {
    throw new Error(`Dimensi kuota tidak dikenal: ${dimensi}`);
  }

  // ⛔ `null` berarti TANPA BATAS. Diperiksa sebelum aritmetika apa pun:
  // `terpakai + tambahan > null` bernilai `false` lewat koersi ke 0, jadi ia
  // "kebetulan benar" — sampai seseorang menulis `>=` dan tier enterprise
  // diam-diam menjadi tier yang tidak dapat menambah apa pun.
  if (batas === null) return { ok: true };

  // Merchant yang TURUN paket dapat berada di atas kuota barunya. Operasi
  // yang tidak menambah apa pun tidak boleh ikut ditolak — kalau tidak,
  // penurunan paket mengunci katalog yang sudah ada.
  if (tambahan <= 0) return { ok: true };

  if (terpakai + tambahan <= batas) return { ok: true };

  const label = LABEL[dimensi];
  return {
    ok: false,
    kode: 'QUOTA_EXCEEDED',
    dimensi,
    // Pesan membawa ANGKANYA, mengikuti pola `spec-e:152` untuk peringatan
    // stok. "Kuota habis" memaksa merchant menebak berapa yang harus dihapus,
    // di layar yang tidak menampilkan angka itu — dan menyebut paket adalah
    // yang membuat penolakan ini punya jalan keluar (`research/09` § 6:
    // "Tolak dengan pesan upgrade").
    pesan:
      `Paket saat ini memuat ${batas} ${label}. ` +
      `Sudah terpakai ${terpakai}, dan operasi ini menambah ${tambahan}. ` +
      `Naikkan paket atau kurangi ${label} yang ada.`,
  };
}
