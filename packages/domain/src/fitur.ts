/**
 * Feature flag dan kill switch. `ARCH:358`, KEP-36.
 *
 * *"Feature flag: terpisah dari rilis; fitur berisiko dikirim mati, dinyalakan
 * per merchant. Kill switch: per fitur per merchant, dari server tanpa rilis —
 * **kebutuhan operasional, bukan kemewahan**."*
 *
 * ## ⛔ Daftar TERTUTUP, dan bawaannya hidup DI SINI
 *
 * Bukan sebagai `DEFAULT` kolom. Pola yang sama dengan `AMBANG_DISKON_BAWAAN`
 * dan `JENDELA_BAWAAN`, dan alasannya sama: kolom ber-default membuat
 * perubahan bawaan hanya berlaku untuk baris yang dibuat sesudahnya, dan yang
 * lama diam-diam memakai angka lama selamanya.
 *
 * Tabel `feature_flag` karena itu menyimpan **penyimpangan saja**. Merchant
 * yang tidak punya barisnya mendapat bawaan di bawah ini, dan itu keadaan
 * normal untuk hampir seluruh merchant.
 *
 * ## ⛔ Tidak ada flag yang dapat mematikan AUDIT
 *
 * `spec-f:369`: *"Tidak ada setting, feature flag, maupun endpoint yang
 * menonaktifkan audit trail."* Daftar tertutup adalah yang menegakkannya, dan
 * ada test yang menolak kunci yang menyebut audit — karena kunci berikutnya
 * yang ditambahkan akan ditambahkan oleh orang yang sedang menangani insiden.
 *
 * ## ⛔ Flag TIDAK menghentikan penjualan
 *
 * Setiap fitur di bawah adalah fitur TAMBAHAN pada jalur uang: mematikannya
 * membuat kasir kehilangan satu cara, bukan kehilangan kemampuan menjual.
 * Tunai, penyimpanan penjualan, dan tutup kas tidak punya flag dan tidak akan
 * pernah punya — kill switch yang dapat menghentikan penjualan adalah SEV-1
 * yang dipicu sendiri.
 */

export interface Fitur {
  kunci: string;
  /** Berlaku bila merchant tidak punya baris penyimpangan. */
  bawaan: boolean;
  /** Untuk operator, bukan untuk merchant. Muncul di `tools/kill-switch.mjs`. */
  keterangan: string;
}

export const FITUR: readonly Fitur[] = [
  {
    kunci: 'pembayaran_qris_statis',
    bawaan: true,
    keterangan:
      'QRIS statis dengan konfirmasi manual kasir (FR-C2). Satu-satunya metode ' +
      'digital yang berfungsi offline, dan satu-satunya yang tidak diverifikasi ' +
      'sistem mana pun — permukaan fraud yang paling mungkin perlu dimatikan ' +
      'untuk satu merchant tanpa menunggu rilis.',
  },
  {
    kunci: 'diskon_kasir',
    bawaan: true,
    keterangan:
      'Diskon tingkat order dari layar kasir (FR-B8). Dimatikan berarti diskon ' +
      'hanya dapat diberikan lewat harga katalog — kasir kehilangan satu cara, ' +
      'bukan kemampuan menjual.',
  },
  {
    kunci: 'buka_laci_no_sale',
    bawaan: true,
    keterangan:
      'Membuka laci tanpa penjualan (FR-D7). `spec-d:229` menyebutnya pola ' +
      'fraud paling dasar; ambang PIN sudah ada, dan ini jalan mematikannya ' +
      'sepenuhnya untuk merchant yang sedang diselidiki.',
  },
] as const;

export type KunciFitur = (typeof FITUR)[number]['kunci'];

const PETA = new Map(FITUR.map((f) => [f.kunci, f]));

export function adalahKunciFitur(nilai: unknown): nilai is KunciFitur {
  return typeof nilai === 'string' && PETA.has(nilai);
}

/** Bawaan sebuah fitur. Melempar untuk kunci asing — lihat `resolusiFitur`. */
export function bawaanFitur(kunci: string): boolean {
  const f = PETA.get(kunci);
  if (f === undefined) {
    throw new RangeError(`Fitur "${kunci}" tidak dikenal. Daftar: ${FITUR.map((x) => x.kunci).join(', ')}.`);
  }
  return f.bawaan;
}

/** Satu baris penyimpangan dari `feature_flag`. */
export interface PenyimpanganFitur {
  kunci: string;
  /** `null` = penyimpangan GLOBAL, berlaku untuk seluruh merchant. */
  tenantId: string | null;
  aktif: boolean;
}

/**
 * Nilai berlaku sebuah fitur untuk satu merchant.
 *
 * ⛔ Urutannya: baris tenant menang atas baris global, dan global menang atas
 * bawaan kode. Membaliknya membuat kill switch per merchant tidak dapat
 * MENYALAKAN kembali fitur yang dimatikan global — dan "matikan untuk semua
 * kecuali yang sudah kami periksa" adalah bentuk pemulihan insiden yang
 * paling sering dipakai.
 *
 * ⛔ Kunci ASING dibaca sebagai MATI, bukan hidup. Baris yang tertinggal di
 * database untuk fitur yang sudah dihapus dari kode tidak boleh menyalakan
 * apa pun; dan kunci yang salah ketik di alat operator harus terlihat sebagai
 * fitur yang tidak menyala, bukan diam-diam tidak berpengaruh.
 */
export function resolusiFitur(
  penyimpangan: readonly PenyimpanganFitur[],
  kunci: string,
  tenantId: string
): boolean {
  if (!PETA.has(kunci)) return false;

  const perTenant = penyimpangan.find((p) => p.kunci === kunci && p.tenantId === tenantId);
  if (perTenant !== undefined) return perTenant.aktif;

  const global = penyimpangan.find((p) => p.kunci === kunci && p.tenantId === null);
  if (global !== undefined) return global.aktif;

  return bawaanFitur(kunci);
}

/** Seluruh fitur sekaligus — bentuk yang dikirim ke perangkat. */
export function resolusiSemuaFitur(
  penyimpangan: readonly PenyimpanganFitur[],
  tenantId: string
): Record<string, boolean> {
  const hasil: Record<string, boolean> = {};
  for (const f of FITUR) hasil[f.kunci] = resolusiFitur(penyimpangan, f.kunci, tenantId);
  return hasil;
}
