/**
 * B-16 — Laporan Penjualan. Murni.
 *
 * ## ⛔ Uang tetap STRING dari ujung ke ujung
 *
 * `GET /reports/sales` mengirim setiap nilai uang sebagai string desimal
 * karena `PosisiPenjualan` memakai `bigint` dan `Number` membuang presisi di
 * atas 2⁵³. Modul ini **tidak pernah** memanggil `Number()` atas nilai uang —
 * ia meneruskannya ke `rupiah()`, yang mengubahnya lewat `BigInt` langsung.
 *
 * Versi yang memanggil `Number()` di sini akan lolos setiap test angka kecil
 * dan salah di angka besar, dan tidak ada yang gagal saat itu terjadi.
 */

export interface PosisiPenjualan {
  omzetKotor: string;
  voidAmount: string;
  refundAmount: string;
  omzetBersih: string;
  pajakTerkumpul: string;
  jumlahTransaksi: number;
  rataRataPerTransaksi: string;
}

export interface Rentang {
  dari: string;
  sampai: string;
}

const POLA = /^\d{4}-\d{2}-\d{2}$/;

/** Tanggal yang benar-benar ADA — `2026-02-31` lolos regex, `Date` tidak. */
function tanggalNyata(nilai: string): boolean {
  if (!POLA.test(nilai)) return false;
  const [t, b, h] = nilai.split('-').map(Number);
  const d = new Date(Date.UTC(t, b - 1, h));
  return d.getUTCFullYear() === t && d.getUTCMonth() === b - 1 && d.getUTCDate() === h;
}

/**
 * Menyetel satu sisi rentang, dan **menjaga invariannya sendiri**.
 *
 * ⛔ Server menolak `from > to` dengan 400 — benar untuk API, buruk untuk
 * layar. Merchant yang menggeser tanggal awal melewati tanggal akhir bermaksud
 * memindahkan rentangnya, bukan meminta error; pemilih yang mendorong sisi
 * lain tidak pernah mengirim rentang terbalik sama sekali.
 *
 * ⛔ Nilai setengah diketik dibiarkan apa adanya. `<input type="date">` yang
 * diketik manual melewati keadaan seperti `"2026-08"` di setiap ketikan, dan
 * membandingkannya sebagai rentang akan menarik sisi lain ke nilai yang belum
 * dimaksud siapa pun.
 */
export function setelRentang(rentang: Rentang, sisi: 'dari' | 'sampai', nilai: string): Rentang {
  const baru: Rentang = { ...rentang, [sisi]: nilai };

  if (!tanggalNyata(baru.dari) || !tanggalNyata(baru.sampai)) return baru;

  // Perbandingan string aman: `YYYY-MM-DD` berurutan secara leksikografis.
  if (baru.dari > baru.sampai) {
    return sisi === 'dari' ? { dari: nilai, sampai: nilai } : { dari: nilai, sampai: nilai };
  }
  return baru;
}

export function rentangSiap(rentang: Rentang): boolean {
  return (
    tanggalNyata(rentang.dari) && tanggalNyata(rentang.sampai) && rentang.dari <= rentang.sampai
  );
}

/* -------------------------------------------------------------- ringkasan -- */

export interface BarisRingkasan {
  kunci: keyof PosisiPenjualan;
  /** Nama yang dibaca merchant, bukan nama field. */
  judul: string;
  /** String untuk uang, `number` hanya untuk jumlah transaksi. */
  nilai: string | number;
  /** `true` untuk void dan refund — keduanya positif di respons. */
  pengurang: boolean;
  /** Ditonjolkan sebagai angka utama layar. */
  utama: boolean;
  keterangan: string;
}

/**
 * ⛔ Void dan refund ditandai `pengurang`.
 *
 * Keduanya angka POSITIF di respons — `voidAmount` adalah nilai penjualan yang
 * dibatalkan, bukan negatifnya. Menampilkannya berdampingan dengan omzet tanpa
 * penanda membuat merchant membacanya sebagai tambahan, dan total di kepalanya
 * tidak akan pernah cocok dengan angka di layar.
 */
export function susunRingkasan(p: PosisiPenjualan): BarisRingkasan[] {
  return [
    {
      kunci: 'omzetKotor',
      judul: 'Omzet kotor',
      nilai: p.omzetKotor,
      pengurang: false,
      utama: false,
      keterangan: 'Seluruh penjualan yang selesai, sebelum pembatalan dan refund.',
    },
    {
      kunci: 'voidAmount',
      judul: 'Dibatalkan',
      nilai: p.voidAmount,
      pengurang: true,
      utama: false,
      keterangan: 'Nilai transaksi yang dibatalkan. Sudah TIDAK termasuk di omzet kotor.',
    },
    {
      kunci: 'refundAmount',
      judul: 'Refund',
      nilai: p.refundAmount,
      pengurang: true,
      utama: false,
      keterangan: 'Uang yang dikembalikan. Refund transaksi hari lalu ikut di hari transaksinya.',
    },
    {
      kunci: 'omzetBersih',
      judul: 'Omzet bersih',
      nilai: p.omzetBersih,
      pengurang: false,
      utama: true,
      keterangan: 'Omzet kotor dikurangi refund. Boleh negatif bila refund melebihi penjualan.',
    },
    {
      kunci: 'pajakTerkumpul',
      judul: 'Pajak terkumpul',
      nilai: p.pajakTerkumpul,
      pengurang: false,
      utama: false,
      keterangan: 'Porsi yang direfund sudah dikurangkan secara sebanding.',
    },
    {
      kunci: 'jumlahTransaksi',
      judul: 'Jumlah transaksi',
      nilai: p.jumlahTransaksi,
      pengurang: false,
      utama: false,
      keterangan: 'Transaksi yang dibatalkan tidak dihitung.',
    },
    {
      kunci: 'rataRataPerTransaksi',
      judul: 'Rata-rata per transaksi',
      nilai: p.rataRataPerTransaksi,
      pengurang: false,
      utama: false,
      keterangan: 'Omzet bersih dibagi jumlah transaksi.',
    },
  ];
}

/**
 * Apakah periode ini benar-benar tanpa penjualan.
 *
 * ⛔ Dibedakan dari nol yang BERMAKNA. Nol transaksi berarti tidak ada
 * penjualan — keadaan kosong. Nol omzet **dengan** transaksi (semuanya
 * direfund penuh) adalah data nyata yang justru harus dilihat, dan
 * menyembunyikannya di balik keadaan kosong menghapus hari yang paling perlu
 * diperiksa.
 */
export function periodeKosong(p: PosisiPenjualan): boolean {
  return p.jumlahTransaksi === 0;
}
