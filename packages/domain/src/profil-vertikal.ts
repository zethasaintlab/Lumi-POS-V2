/**
 * `VerticalProfile` — resolusi dan aturan stok yang bergantung padanya.
 *
 * ## OQ-09, diputuskan 1 Agustus 2026
 *
 * "VerticalProfile **per outlet, mewarisi default tenant**. Pusat menetapkan
 * standar, cabang boleh override." Resolusinya
 * `COALESCE(profil_outlet, profil_default_tenant)`.
 *
 * ## Kenapa di packages/domain, bukan di server saja
 *
 * FR-E4 menuntut peringatan stok bekerja di layar kasir, dan seluruh alur
 * kasir berjalan tanpa jaringan. Perangkat karena itu harus meresolusinya
 * sendiri — dengan aturan yang sama persis dengan server, atau merchant akan
 * melihat produk yang dapat dijual offline tetapi ditolak online.
 *
 * ## ⛔ Nilainya TIDAK diturunkan sebagai kolom terhitung
 *
 * Menaruh `COALESCE(...)` di dalam sync rules dan mengirimkannya sebagai
 * kolom di baris `outlet` terlihat lebih sederhana, dan ia salah: PowerSync
 * mereplikasi perubahan per tabel dari WAL. Mengubah `vertical_profile` tidak
 * mengubah baris `outlet`, jadi baris itu tidak dipancarkan ulang — perangkat
 * memegang nilai basi selamanya, tanpa satu pun error. Tabelnya diturunkan
 * apa adanya, dan resolusinya terjadi di sini.
 */

export interface ProfilVertikal {
  id: string;
  name: string;
  allowNegativeStock: boolean;
  isTenantDefault: boolean;
}

export interface ProfilTerresolusi extends ProfilVertikal {
  /**
   * `true` bila tidak ada profil sama sekali dan nilainya datang dari bawaan
   * kode.
   *
   * Dibawa keluar, bukan disembunyikan: UI yang menampilkan aturan stok harus
   * dapat mengatakan bahwa aturannya belum berasal dari konfigurasi merchant
   * mana pun.
   */
  dariBawaan: boolean;
}

/**
 * Bawaan F&B (`spec-e:136`).
 *
 * `[ASUMSI]` — `spec-e:341` menandai nilai ini perlu divalidasi ke tiga
 * merchant. Yang divalidasi adalah NILAINYA; keberadaan setting-nya sendiri
 * dituntut FR-E4 ("berada di `VerticalProfile`, bukan konstanta"), dan
 * menundanya akan memaksa `if` hardcoded yang melanggar aturan itu.
 *
 * Alasan spec memilih "boleh negatif": melarang penjualan karena sistem
 * mengira stok habis akan menghentikan penjualan nyata, dan kasir akan
 * mencari jalan pintas — memindahkan masalah ke tempat yang tidak terlihat
 * sistem.
 */
const BAWAAN: ProfilVertikal = {
  id: 'bawaan-fnb',
  name: 'fnb',
  allowNegativeStock: true,
  isTenantDefault: false,
};

export function resolusiProfil({
  profilOutlet,
  profilDefaultTenant,
}: {
  profilOutlet: ProfilVertikal | null;
  profilDefaultTenant: ProfilVertikal | null;
}): ProfilTerresolusi {
  const dipilih = profilOutlet ?? profilDefaultTenant;
  if (!dipilih) return { ...BAWAAN, dariBawaan: true };
  return { ...dipilih, dariBawaan: false };
}

export interface KeputusanStok {
  /** Bolehkah kuantitas yang diminta masuk keranjang? */
  boleh: boolean;
  /** Perlukah kasir diberi tahu sisa stoknya? */
  peringatan: boolean;
  /** Sisa stok saat ini, ×1000. Dipakai di teks peringatan. */
  sisaMilli: number;
  /**
   * Batas kuantitas bila penjualan ditolak, ×1000. `null` bila tidak ada
   * batas.
   *
   * Dibawa sebagai ANGKA, bukan sekadar `boleh: false` — `spec-e:152`
   * menuntut pembatasan disertai "pesan yang menjelaskan", dan pesan tanpa
   * angkanya tidak menjelaskan apa pun.
   */
  maksimumMilli: number | null;
}

/**
 * Bolehkah `dimintaMilli` ditambahkan, dan apa yang harus dikatakan kasir?
 *
 * FR-E4. Murni — pemanggil yang membaca stok dan setting-nya.
 */
export function keputusanStok({
  stokMilli,
  dimintaMilli,
  bolehNegatif,
  lacakStok = true,
}: {
  stokMilli: number;
  dimintaMilli: number;
  bolehNegatif: boolean;
  lacakStok?: boolean;
}): KeputusanStok {
  // ⛔ Produk yang stoknya tidak dilacak tidak punya movement sama sekali
  // (FR-E2), jadi `SUM(delta)` selalu 0. Memperlakukannya seperti stok habis
  // akan memblokir setiap produk jasa di seluruh katalog.
  if (!lacakStok) {
    return { boleh: true, peringatan: false, sisaMilli: stokMilli, maksimumMilli: null };
  }

  const cukup = stokMilli >= dimintaMilli;
  if (cukup) {
    return { boleh: true, peringatan: false, sisaMilli: stokMilli, maksimumMilli: null };
  }

  if (bolehNegatif) {
    // `spec-e:146`: "penjualan TETAP dapat diselesaikan". Peringatan yang
    // memblokir bukan peringatan.
    return { boleh: true, peringatan: true, sisaMilli: stokMilli, maksimumMilli: null };
  }

  return {
    boleh: false,
    peringatan: true,
    sisaMilli: stokMilli,
    // Tidak pernah negatif: "boleh menjual −2 unit" tidak berarti apa pun,
    // dan angka negatif di pesan kasir terbaca sebagai kesalahan sistem.
    maksimumMilli: Math.max(0, stokMilli),
  };
}
