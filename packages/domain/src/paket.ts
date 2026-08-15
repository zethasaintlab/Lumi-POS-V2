/**
 * Paket dan kuotanya. Murni: data, tanpa I/O.
 *
 * ## ⛔ Seluruh angka di berkas ini `[ASUMSI]`
 *
 * Delapan spec modul memuat 414 acceptance criteria dan **tidak satu pun**
 * menyangkut paket, kuota, atau lisensi. 77 FR di PRD berhenti di FR-H8.
 * Yang ada hanya:
 *
 * - `research/09` § 6 — dimensi kuota, titik penegakan, perilaku saat
 *   terlampaui. Tanpa angka.
 * - `research/11` § 3 — `[FAKTA]` lever tier di pasar Indonesia adalah kuota;
 *   Kasir Pintar 1.000 vs 10.000 produk, maks 5 staf.
 * - `spec-a:370` — "tier Gratis 200, Standar 5.000" ditulis sebagai
 *   **pertanyaan terbuka**, bukan keputusan.
 *
 * Angkanya dikumpulkan DI SINI, di satu tempat, justru supaya menggantinya
 * kelak adalah satu edit — bukan perburuan lintas berkas setelah harga
 * ditetapkan.
 *
 * ## Yang BUKAN asumsi
 *
 * Dua hal di bawah diturunkan dari aturan, bukan ditebak:
 *
 * 1. **`null` berarti tanpa batas.** Bukan angka besar. Angka besar adalah
 *    batas yang berpura-pura tidak ada, dan ia akan mengejutkan seseorang
 *    sekali, di tempat yang tidak ada yang mengawasi.
 * 2. **Volume transaksi tidak ada di sini, dan tidak akan pernah ada.**
 *    `research/09` § 6: membatasi transaksi = menghentikan penjualan. Volume
 *    dipakai untuk metering dan penagihan, tidak pernah untuk penolakan.
 */

export type NamaPaket = 'free' | 'standard' | 'pro' | 'enterprise';

export interface KuotaPaket {
  /** `null` = tanpa batas. */
  maxOutlets: number | null;
  maxDevices: number | null;
  maxUsers: number | null;
  maxProducts: number | null;
}

/**
 * Keempat nama harus sepadan dengan CHECK constraint di `0002_tenancy.sql`:
 * `CHECK (plan IN ('free','standard','pro','enterprise'))`. Paket yang
 * diterima database tapi tidak punya baris di sini akan lolos sampai
 * penegakan pertama, lalu gagal di sana — jauh dari tempat kesalahannya.
 */
export const KUOTA_PAKET: Readonly<Record<NamaPaket, KuotaPaket>> = {
  // Satu outlet, tapi DUA perangkat: kafe takeaway dengan dua terminal adalah
  // kasus normal. Tier gratis yang hanya memuat satu perangkat memaksa
  // upgrade di hari pertama, dan itu bukan tier gratis melainkan trial yang
  // tidak diberi nama.
  free: { maxOutlets: 1, maxDevices: 2, maxUsers: 3, maxProducts: 200 },
  standard: { maxOutlets: 5, maxDevices: 10, maxUsers: 15, maxProducts: 5_000 },
  pro: { maxOutlets: 20, maxDevices: 50, maxUsers: 60, maxProducts: 20_000 },
  enterprise: { maxOutlets: null, maxDevices: null, maxUsers: null, maxProducts: null },
};

/**
 * Paket yang diberikan pendaftaran mandiri.
 *
 * ⛔ Ini konstanta, bukan parameter. `POST /tenants` tidak terautentikasi —
 * paket yang dapat dipilih pemanggil berarti siapa pun dapat memberi dirinya
 * kuota tanpa batas lewat satu field JSON. Perpindahan paket adalah operasi
 * billing, dan billing tidak dibangun di sini.
 */
export const PAKET_PENDAFTARAN: NamaPaket = 'free';
