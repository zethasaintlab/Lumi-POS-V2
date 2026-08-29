import { keranjangKosong, type Keranjang } from './keranjang.ts';

/**
 * Keranjang yang sedang berjalan, bertahan melintasi navigasi K-03 → K-06.
 *
 * ## Kenapa modul, bukan state React
 *
 * K-03 dan K-06 adalah dua layar berbeda dengan router yang membongkar
 * komponennya. State React di K-03 hilang begitu kasir menekan Bayar.
 *
 * ## ⛔ Modul ini tetap MEMORI SAJA — yang durable ada di tempat lain
 *
 * Sejak KEP-21 (24 Agustus 2026) keranjang juga ditulis ke `keranjang_lokal`
 * lewat `keranjang-simpan.ts`, dan K-03 memulihkannya saat boot. Modul ini
 * **tidak** ikut menuliskannya, dan itu keputusan: ia dipanggil dari render
 * React dan harus tetap sinkron, sementara penulisan database asinkron.
 * Menyembunyikan I/O di balik setter sinkron menghasilkan kegagalan tulis
 * yang tidak dapat ditangani siapa pun.
 *
 * Yang memutuskan KAPAN menulis karena itu layarnya (efek di `Kasir.tsx`),
 * dan yang membersihkannya adalah transaksi penjualan — lihat
 * `keranjang-simpan.ts` untuk kenapa pembersihan harus ada di dalamnya.
 *
 * ## Batas yang tetap berlaku
 *
 * Keranjang ini milik PERANGKAT INI. Berbagi order antar device saat offline
 * adalah non-goal v1 yang dinyatakan (`PRD` § 4), dan `order.status = 'open'`
 * + `owned_by_device_id` di ERD sengaja TIDAK dipakai — menulis baris `order`
 * berarti mengirimkannya ke server, dan order `open` yang tidak pernah dibayar
 * muncul di laporan tanpa punya jalan penutupan.
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
