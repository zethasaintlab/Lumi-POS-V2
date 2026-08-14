/**
 * Tangga resolusi harga (FR-A7).
 *
 * Tiga tingkat, dari yang paling khusus:
 *
 *   1. `price_history` untuk OUTLET ini
 *   2. `price_history` untuk seluruh tenant (`outlet_id IS NULL`)
 *   3. `item_variation.price` — harga awal, beku setelah variation dibuat
 *
 * ## ⛔ Ini SALINAN KETIGA, dan itu diakui
 *
 * `apps/server/src/modules/catalog/handlers/prices.ts` memperingatkan:
 * *"Dua salinan tangga resolusi ini sudah pernah menyimpang diam-diam sekali
 * — urutan COALESCE-nya terbalik dan seluruh suite tetap hijau."*
 *
 * Salinan ketiga tidak dapat dihindari. Server menjalankannya sebagai SQL
 * LATERAL — pilihan performa yang benar untuk satu query atas seluruh katalog
 * — sementara perangkat harus memutuskan hal yang sama tanpa PostgreSQL dan
 * tanpa jaringan (`spec-d:3`: penjualan berjalan penuh saat offline).
 *
 * Yang membuatnya tidak mengulang sejarah itu adalah bentuk testnya, bukan
 * niat baik: `tests/domain/harga.test.js` menguji setiap pasangan tingkat
 * yang bisa saling menutupi — termasuk baris tenant yang LEBIH BARU daripada
 * baris outlet, yang akan meloloskan implementasi "urutkan semua lalu ambil
 * yang pertama".
 *
 * Murni: tanpa I/O. Barisnya sudah diambil pemanggil.
 */

export type SumberHarga = 'outlet' | 'tenant' | 'variation';

export interface BarisRiwayatHarga {
  /** `null` berarti berlaku untuk seluruh tenant. */
  outlet_id: string | null;
  price: number;
  /** ISO-8601. */
  effective_from: string;
}

export interface HargaTerpilih {
  harga: number;
  sumber: SumberHarga;
}

/**
 * @param riwayat Baris `price_history` untuk SATU variation. Boleh memuat
 *                baris outlet lain — fungsi ini yang menyaringnya.
 * @param pada    Momen yang menentukan. Untuk order yang antre offline ini
 *                adalah `occurred_at`, BUKAN sekarang (FR-H6, `spec-h:77`).
 */
export function resolusiHarga({
  hargaDasar,
  riwayat,
  outletId,
  pada,
}: {
  hargaDasar: number;
  riwayat: readonly BarisRiwayatHarga[];
  outletId: string | null;
  pada: Date;
}): HargaTerpilih {
  const batas = pada.getTime();

  // `<=`, bukan `<`. Batas inklusif, sama dengan `effective_from <= at` di
  // server. Eksklusif membuat harga yang baru ditulis "belum berlaku" pada
  // milidetik penulisannya sendiri — bug yang pernah nyata di repo ini lewat
  // skew jam antara Node dan PostgreSQL.
  const berlaku = (b: BarisRiwayatHarga) => Date.parse(b.effective_from) <= batas;

  // ⛔ Dipilih PER TINGKAT, bukan dari seluruh riwayat sekaligus. Tingkat
  // outlet menang meski baris tenant lebih baru — itu yang membuatnya tangga
  // alih-alih "ambil yang terakhir".
  const terbaru = (baris: readonly BarisRiwayatHarga[]): BarisRiwayatHarga | null => {
    let pilih: BarisRiwayatHarga | null = null;
    for (const b of baris) {
      if (!berlaku(b)) continue;
      if (pilih === null || Date.parse(b.effective_from) > Date.parse(pilih.effective_from)) {
        pilih = b;
      }
    }
    return pilih;
  };

  if (outletId !== null) {
    // Baris outlet LAIN tidak pernah berlaku. Kalau penyaringan ini hilang,
    // cabang A menjual dengan harga cabang B — tanpa satu pun error.
    const outlet = terbaru(riwayat.filter((b) => b.outlet_id === outletId));
    if (outlet) return { harga: outlet.price, sumber: 'outlet' };
  }

  const tenant = terbaru(riwayat.filter((b) => b.outlet_id === null));
  if (tenant) return { harga: tenant.price, sumber: 'tenant' };

  return { harga: hargaDasar, sumber: 'variation' };
}
