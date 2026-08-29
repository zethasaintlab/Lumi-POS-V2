/**
 * Kosakata `peripheral` — daftar tertutup, dibagi server dan klien.
 *
 * ## ⛔ Kenapa di `packages/domain`, bukan di server saja
 *
 * K-15 bertanda ✅ offline (`IA:65`): kasir memilih profil printernya tanpa
 * jaringan, dan barisnya di-relay belakangan. Aturan yang hanya hidup di
 * server berarti kasir mengetik jenis koneksi yang salah, layarnya menerima,
 * lalu barisnya berhenti `gagal-permanen` di antrean berjam-jam kemudian —
 * bentuk cacat yang sama persis dengan refund offline (21 Agustus 2026).
 *
 * Nilainya harus sama dengan CHECK constraint `db/migrations/0012_peripheral`;
 * ada test yang membandingkan keduanya terhadap DDL, bukan terhadap ingatan.
 * Kosakata yang menyimpang dari CHECK-nya menghasilkan baris yang database
 * tolak dengan galat yang menyebut nama constraint alih-alih apa yang salah.
 *
 * Murni: tanpa I/O.
 */

export const JENIS_PERIPHERAL = ['printer', 'drawer', 'scanner', 'display'] as const;
export type JenisPeripheral = (typeof JENIS_PERIPHERAL)[number];

export const KONEKSI_PERIPHERAL = ['usb', 'bluetooth', 'network'] as const;
export type KoneksiPeripheral = (typeof KONEKSI_PERIPHERAL)[number];

export function adalahJenisPeripheral(nilai: unknown): nilai is JenisPeripheral {
  return typeof nilai === 'string' && (JENIS_PERIPHERAL as readonly string[]).includes(nilai);
}

export function adalahKoneksiPeripheral(nilai: unknown): nilai is KoneksiPeripheral {
  return typeof nilai === 'string' && (KONEKSI_PERIPHERAL as readonly string[]).includes(nilai);
}

/** Nama jenis di layar. Kode mentah di layar kasir tidak dapat ditindaklanjuti. */
export const LABEL_JENIS: Record<JenisPeripheral, string> = {
  printer: 'Printer struk',
  drawer: 'Laci kas',
  scanner: 'Scanner barcode',
  display: 'Layar pelanggan',
};

export const LABEL_KONEKSI: Record<KoneksiPeripheral, string> = {
  usb: 'USB',
  bluetooth: 'Bluetooth',
  network: 'Jaringan',
};
