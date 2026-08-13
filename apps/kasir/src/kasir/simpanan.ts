import { keranjangKosong, type Keranjang } from './keranjang.ts';

/**
 * Keranjang yang sedang berjalan, bertahan melintasi navigasi K-03 → K-06.
 *
 * ## Kenapa modul, bukan state React
 *
 * K-03 dan K-06 adalah dua layar berbeda dengan router yang membongkar
 * komponennya. State React di K-03 hilang begitu kasir menekan Bayar.
 *
 * ## ⛔ BATAS YANG HARUS DINYATAKAN: keranjang ini hanya di MEMORI
 *
 * Ia hilang bila aplikasi dimuat ulang atau perangkat mati sebelum penjualan
 * disimpan. Itu **bukan** kehilangan uang — penjualan baru ada setelah
 * `simpanPenjualan` menulisnya, dan sebelum itu tidak ada uang yang berpindah
 * — tapi kasir harus memasukkan ulang pesanannya.
 *
 * Skema sudah menyiapkan jalan keluarnya: `order.status = 'open'` dan
 * `owned_by_device_id` ada di ERD justru untuk keranjang yang bertahan
 * (KEP-21). Membangunnya berarti menulis order sebelum dibayar, dan itu
 * keputusan tersendiri — order `open` yang tidak pernah dibayar akan muncul
 * di laporan dan harus punya jalan penutupan. Dicatat, bukan didiamkan.
 */

let kini: Keranjang = keranjangKosong();
const pelanggan = new Set<() => void>();

export function keranjangSekarang(): Keranjang {
  return kini;
}

export function setelKeranjang(baru: Keranjang): void {
  kini = baru;
  for (const dengar of [...pelanggan]) {
    try {
      dengar();
    } catch {
      // Satu pelanggan yang melempar tidak boleh menghalangi sisanya — pola
      // yang sama dengan `buatPemberitahu` di packages/sync-client.
    }
  }
}

export function langgananKeranjang(dengar: () => void): () => void {
  pelanggan.add(dengar);
  return () => {
    pelanggan.delete(dengar);
  };
}
