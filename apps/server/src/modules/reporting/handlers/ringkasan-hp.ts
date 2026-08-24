import type { PoolClient } from '../../../db.ts';
import { ambilPenjualan, ambilPembayaran } from '../../ordering/index.ts';
import {
  rataRataPerTransaksi,
  tanggalPembanding,
  trenHarian,
  type HariPembanding,
  type Tren,
} from '../../../../../../packages/domain/src/tren-harian.ts';

/**
 * FR-G6 — ringkasan harian untuk HP (M-01).
 *
 * `spec-g:212`: *"Persona P3 membuka aplikasi pukul 23:00 di HP 390×844 untuk
 * satu pertanyaan: hari ini bagaimana, dan apakah ada yang aneh."*
 *
 * ## ⛔ Angkanya dari fungsi yang SAMA dengan laporan lain
 *
 * `ambilPenjualan` dan `ambilPembayaran` — persis yang `GET /reports/sales`
 * dan `GET /reports/payments` pakai. Menghitungnya sendiri di sini berarti
 * owner melihat omzet berbeda tergantung layar mana yang ia buka, dan yang ia
 * lihat pukul 23:00 adalah yang ia percayai.
 *
 * Itu aturan yang sama yang membuat B-01 memakai `posisi-penjualan.ts`.
 *
 * ## ⛔ Ia MEMBACA lintas domain — dan karena itu ada di `reporting`
 *
 * Penjualan (ordering), pembayaran (ordering), dan temuan exception
 * (reporting). Invariant #4 mengizinkannya justru karena modul ini tidak
 * memiliki satu pun tabel dan tidak pernah menulis.
 *
 * ## ⛔ Pembandingnya diambil PER HARI, bukan sebagai satu rentang
 *
 * `spec-g:243` menuntut rata-rata empat **hari yang sama**, dan satu query
 * rentang `from..to` akan mengembalikan rata-rata 28 hari — angka yang
 * membuat setiap Senin terlihat seperti bencana dan setiap Sabtu seperti
 * rekor. Empat pembacaan kecil, bukan satu yang salah.
 */

export interface MetodeRingkas {
  metode: string;
  total: string;
  jumlah: number;
}

export interface RingkasanHarian {
  tanggal: string;
  outletId: string | null;
  /** Rupiah utuh sebagai STRING — `bigint` tidak dapat di-`JSON.stringify`. */
  omzetBersih: string;
  jumlahTransaksi: number;
  /** `null` = belum ada transaksi sama sekali. Bukan "Rp 0 per transaksi". */
  rataRataPerTransaksi: string | null;
  perMetode: MetodeRingkas[];
  tren: {
    deltaPersen: number | null;
    arah: Tren['arah'];
    rataRata: string | null;
    basisMinggu: number;
  };
}

export async function ambilRingkasanHarian(
  client: PoolClient,
  { tanggal, outletId }: { tanggal: string; outletId: string | null }
): Promise<RingkasanHarian> {
  const hariIni = await ambilPenjualan(client, { from: tanggal, to: tanggal, outletId });

  // ⛔ Empat pembacaan terpisah, satu per hari-sama. Lihat catatan kepala.
  const pembanding: HariPembanding[] = [];
  for (const tgl of tanggalPembanding(tanggal)) {
    const p = await ambilPenjualan(client, { from: tgl, to: tgl, outletId });
    // ⛔ Hari yang jumlah transaksinya NOL tidak dimasukkan. Outlet yang tutup
    // pada satu Senin tidak punya kebiasaan untuk hari itu, dan
    // memperlakukannya sebagai omzet nol menyeret rata-rata ke bawah.
    // ⛔ `ambilPenjualan` mengembalikan uang sebagai STRING (bigint tidak
    // dapat melewati JSON). Domain menuntut `bigint`; mengonversinya di sini
    // adalah satu-satunya tempat konversi itu terjadi.
    if (p.jumlahTransaksi > 0) pembanding.push({ tanggal: tgl, omzet: BigInt(p.omzetBersih) });
  }

  const omzetHariIni = BigInt(hariIni.omzetBersih);
  const tren = trenHarian(omzetHariIni, pembanding);
  const bayar = await ambilPembayaran(client, { from: tanggal, to: tanggal, outletId });
  const rata = rataRataPerTransaksi(omzetHariIni, hariIni.jumlahTransaksi);

  return {
    tanggal,
    outletId,
    omzetBersih: hariIni.omzetBersih,
    jumlahTransaksi: hariIni.jumlahTransaksi,
    rataRataPerTransaksi: rata === null ? null : rata.toString(),
    perMetode: bayar.metode.map((m) => ({
      metode: m.method,
      // ⛔ `totalDiterima`, bukan omzet: ini uang yang benar-benar masuk per
      // saluran. Keduanya berbeda saat ada pembayaran campuran, dan owner yang
      // menjumlahkan baris metode berharap mendapat uang yang ia terima.
      total: m.totalDiterima,
      jumlah: m.jumlahTransaksi,
    })),
    tren: {
      deltaPersen: tren.deltaPersen,
      arah: tren.arah,
      rataRata: tren.rataRata === null ? null : tren.rataRata.toString(),
      basisMinggu: tren.basisMinggu,
    },
  };
}
