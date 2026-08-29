import { labelAlasan, rasioTampil, type PesanLayar } from './b21.ts';

/**
 * B-21 — daftar delapan laporan exception dan aturan tampilannya. FR-G5.
 *
 * `IA:200` menamai B-21 **"Laporan Exception (8 laporan)"** — satu layar,
 * delapan laporan. Bukan delapan layar: `IA:173` menjelaskan kenapa PENGAWASAN
 * dipisah dari LAPORAN sama sekali ("laporan exception adalah yang dibeli
 * owner"), dan memecahnya menjadi delapan entri menu mengembalikan masalah yang
 * pemisahan itu selesaikan — masing-masing tenggelam sendiri-sendiri.
 *
 * ## ⛔ Aturannya di sini, bukan di JSX
 *
 * Alasan yang sama dengan `b21.ts`: yang hanya dapat diperiksa dengan membaca
 * JSX tidak diperiksa siapa pun. Yang di berkas ini dapat diuji sebagai aturan.
 *
 * ## ⛔ Tanpa bahasa menuduh — dan itu berlaku ke JUDUL
 *
 * `spec-g:168`. Setiap judul di bawah menyatakan APA YANG DIHITUNG, bukan
 * kesimpulannya: `Void di ujung shift`, bukan `Void mencurigakan`. Ada test
 * yang memindai judul, deskripsi, dan catatan kaki di berkas ini.
 */

export type IdLaporan = 'x1' | 'x2' | 'x3' | 'x4' | 'x5' | 'x6' | 'x7' | 'x8';

export interface DefinisiLaporan {
  id: IdLaporan;
  /** Label tab. Pendek — ia berbagi baris dengan tujuh yang lain. */
  tab: string;
  judul: string;
  /** Satu kalimat: apa yang dihitung, bukan apa kesimpulannya. */
  deskripsi: string;
  /**
   * Path endpoint tanpa query. `null` berarti laporannya BELUM ADA, dan
   * `alasanTidakAda` menjelaskan kenapa.
   */
  endpoint: string | null;
  /**
   * Kunci array di dalam respons yang berisi barisnya. Dipakai untuk
   * membedakan "nol baris" dari "gagal memuat".
   */
  kunci: string;
  /**
   * ⛔ Kalimat yang menjelaskan angkanya, ditampilkan DI BAWAH tabel.
   *
   * Bukan hiasan: setiap laporan di sini membandingkan orang dengan rekannya,
   * dan angka pembanding tanpa penyebutnya adalah angka yang ditafsirkan
   * sembarangan oleh orang yang memakainya untuk menilai orang lain.
   */
  catatan: string;
  /**
   * ⛔ Kosakata keadaan kosong. Lihat `pesanLaporan` — bukan hiasan.
   *
   * `benda` menamai apa yang tidak ditemukan ("void maupun refund"), `simpul`
   * menamai kesimpulan yang TIDAK boleh ditarik dari daftar kosong ("tidak ada
   * pembatalan").
   */
  kosong: { judul: string; benda: string; simpul: string };
  /** Diisi hanya bila `endpoint` null. */
  alasanTidakAda?: string;
}

export const LAPORAN: readonly DefinisiLaporan[] = [
  {
    id: 'x1',
    tab: 'Void & refund',
    judul: 'Void & refund per pelaku',
    deskripsi: 'Siapa yang membatalkan, apa alasannya, dan berapa nilainya.',
    endpoint: '/reports/exceptions/voids',
    kunci: 'peristiwa',
    catatan:
      'Kolom Pelaku menunjuk orang yang menekan tombol pembatalan — berbeda dari kolom ' +
      'Dibatalkan di Laporan Kasir, yang melekat pada kasir yang penjualannya dibatalkan. ' +
      'Keduanya benar untuk pertanyaan yang berbeda.',
    kosong: {
      judul: 'Tidak ada pembatalan pada rentang ini',
      benda: 'void maupun refund',
      simpul: 'tidak ada pembatalan',
    },
  },
  {
    id: 'x2',
    tab: 'Ujung shift',
    judul: 'Void di ujung shift',
    deskripsi:
      'Pembatalan dalam 60 menit terakhir sebuah shift, dan pembatalan setelah shift ditutup.',
    endpoint: '/reports/exceptions/shift-end-voids',
    kunci: 'void',
    catatan:
      'Dihitung terhadap jam penutupan shift, bukan terhadap jam sekarang — shift yang belum ' +
      'ditutup tidak punya "60 menit terakhir" dan karena itu tidak muncul di sini sama sekali. ' +
      'Pembatalan sesudah shift ditutup ditampilkan lebih dulu karena ia keadaan yang berbeda, ' +
      'bukan sekadar lebih dekat ke penutupan.',
    kosong: {
      judul: 'Tidak ada void di ujung shift',
      benda: 'void dalam 60 menit terakhir shift maupun sesudah shift ditutup',
      simpul: 'tidak ada pembatalan di ujung shift',
    },
  },
  {
    id: 'x3',
    tab: 'Refund besar',
    judul: 'Refund bernilai tinggi',
    deskripsi: 'Refund pada atau di atas persentil 90 periode ini, beserta alasan dan penyetujunya.',
    endpoint: '/reports/exceptions/high-refunds',
    kunci: 'laporan',
    catatan:
      'Ambangnya dihitung dari seluruh refund pada rentang yang dipilih, bukan dari angka rupiah ' +
      'tetap. Kafe dengan omzet besar punya refund besar; ambang tetap akan menandai seluruh ' +
      'kasirnya sementara kafe kecil tidak pernah menandai siapa pun. Karena ambangnya bergerak ' +
      'mengikuti periode, daftar ini tidak dapat dibandingkan antar rentang.',
    kosong: {
      judul: 'Tidak ada refund pada rentang ini',
      benda: 'refund',
      simpul: 'tidak ada refund',
    },
  },
  {
    id: 'x4',
    tab: 'Buka laci',
    judul: 'Frekuensi buka laci tanpa transaksi',
    deskripsi: 'Berapa kali laci dibuka tanpa penjualan, per kasir, dan rata-ratanya per shift.',
    endpoint: '/reports/exceptions/no-sales',
    kunci: 'perKasir',
    catatan:
      'Membuka laci tanpa transaksi adalah bagian normal dari pekerjaan kasir — menukar uang ' +
      'kecil, mengoreksi kembalian. Yang dibandingkan di sini frekuensinya terhadap rekan kerja ' +
      'pada rentang yang sama, bukan terhadap angka yang dianggap wajar.',
    kosong: {
      judul: 'Laci tidak pernah dibuka tanpa transaksi',
      benda: 'pembukaan laci tanpa transaksi',
      simpul: 'laci tidak pernah dibuka tanpa transaksi',
    },
  },
  {
    id: 'x5',
    tab: 'Diskon',
    judul: 'Diskon manual per kasir',
    deskripsi: 'Nilai, frekuensi, dan sebaran alasan diskon yang diberikan dari layar kasir.',
    endpoint: '/reports/exceptions/discounts',
    kunci: 'perKasir',
    catatan:
      'Kolom Alasan menampilkan sebarannya, bukan hanya jumlahnya: diskon yang selalu beralasan ' +
      'sama menjelaskan lebih banyak daripada diskon yang besar. Kolom Dengan persetujuan ' +
      'menghitung berapa di antaranya melewati ambang dan menuntut PIN manajer.',
    kosong: {
      judul: 'Tidak ada diskon manual pada rentang ini',
      benda: 'diskon yang diberikan dari layar kasir',
      simpul: 'tidak ada diskon manual',
    },
  },
  {
    id: 'x6',
    tab: 'Keranjang',
    judul: 'Item berulang dibatalkan',
    deskripsi: 'Item yang ditambahkan lalu dihapus berkali-kali pada satu pesanan.',
    endpoint: null,
    kunci: '',
    catatan: '',
    kosong: { judul: '', benda: '', simpul: '' },
    alasanTidakAda:
      'Keranjang di layar kasir hanya hidup di memori perangkat sampai pembayaran disimpan — ' +
      'penambahan dan penghapusan sebelum itu tidak tercatat di mana pun, jadi laporan ini tidak ' +
      'punya sumber data. Membangunnya menuntut keranjang ikut disimpan, atau telemetri yang ' +
      'memuat nama produk; yang kedua dilarang batas etis telemetri.',
  },
  {
    id: 'x7',
    tab: 'Selisih kas',
    judul: 'Selisih kas per kasir',
    deskripsi: 'Selisih hitungan kas per shift, arah kecenderungannya, dan sebarannya.',
    endpoint: '/reports/exceptions/cash-variance',
    kunci: 'perKasir',
    catatan:
      'Total dan total mutlak ditampilkan berdampingan karena keduanya menjawab hal yang ' +
      'berbeda: kasir yang kurang Rp 50.000 lalu lebih Rp 50.000 punya total nol, sementara ' +
      'total mutlaknya Rp 100.000. Kolom Kecenderungan hanya terisi bila ada cukup shift untuk ' +
      'menunjukkan arah — dua shift tidak menunjukkan apa pun.',
    kosong: {
      judul: 'Tidak ada shift dengan selisih kas',
      benda: 'shift tertutup yang hitungan kasnya berselisih',
      simpul: 'tidak ada selisih kas',
    },
  },
  {
    id: 'x8',
    tab: 'Jam perangkat',
    judul: 'Selisih jam perangkat',
    deskripsi: 'Perangkat yang jamnya berbeda dari jam server saat mengirim penjualan.',
    endpoint: '/reports/exceptions/clock',
    kunci: 'anomali',
    catatan:
      'Yang dibandingkan jam perangkat saat mengirim dengan jam server saat menerima — bukan ' +
      'selisih antara waktu transaksi dan waktu tersimpan, yang pada penjualan offline memang ' +
      'wajar berjam-jam. Selisih jam jauh lebih sering berarti baterai jam perangkat habis ' +
      'daripada berarti seseorang mengubahnya.',
    kosong: {
      judul: 'Jam seluruh perangkat sesuai',
      benda: 'perangkat yang jamnya berselisih melebihi ambang',
      simpul: 'jam seluruh perangkat sesuai',
    },
  },
];

export function definisi(id: IdLaporan): DefinisiLaporan {
  const d = LAPORAN.find((l) => l.id === id);
  if (d === undefined) throw new RangeError(`Laporan "${id}" tidak dikenal.`);
  return d;
}

/** Laporan yang benar-benar punya endpoint — dipakai penyeleksi tab. */
export const LAPORAN_ADA: readonly DefinisiLaporan[] = LAPORAN.filter((l) => l.endpoint !== null);

// ---------------------------------------------------------------------------
// Keadaan layar
// ---------------------------------------------------------------------------

export type KeadaanLaporan =
  | { jenis: 'awal' }
  | { jenis: 'memuat' }
  | { jenis: 'siap'; hasil: Record<string, unknown> }
  | { jenis: 'galat'; pesan: string };

/**
 * Baris sebuah laporan dari respons servernya.
 *
 * ⛔ X3 MENYARANG barisnya: pembungkus `exceptionHandlers` menaruh hasil
 * `ambilRefundTinggi` di bawah kunci `laporan`, dan hasil itu sendiri sebuah
 * objek `{ambang, jumlahSeluruhRefund, refund}` — bukan larik. Membaca
 * `hasil[kunci]` apa adanya menghasilkan objek yang `length`-nya `undefined`,
 * dan `undefined > 0` adalah `false`: layar akan berkata "tidak ada refund"
 * untuk periode yang penuh refund, tanpa satu pun error.
 *
 * Nol baris karena itu ditentukan di SATU tempat, dan bentuk bersarang
 * dinyatakan di sini alih-alih ditebak per pemanggil.
 */
export function barisLaporan(def: DefinisiLaporan, hasil: Record<string, unknown>): unknown[] {
  const isi = def.kunci === '' ? undefined : hasil[def.kunci];
  if (Array.isArray(isi)) return isi;
  if (isi !== null && typeof isi === 'object') {
    const dalam = (isi as Record<string, unknown>).refund;
    if (Array.isArray(dalam)) return dalam;
  }
  return [];
}

/**
 * Pesan yang menggantikan tabel, atau `null` bila tabelnya yang dirender.
 *
 * ## ⛔ Tiga keadaan yang tampak sama dan berarti sangat berbeda
 *
 * "Belum dimuat", "tidak ada apa-apa", dan "gagal memuat" semuanya berupa layar
 * tanpa tabel. Yang kedua adalah kabar baik; yang ketiga adalah laporan yang
 * **tidak boleh** dipercaya sebagai bukti tidak ada apa-apa. Layar yang
 * menyamakan keduanya membuat kegagalan jaringan terbaca sebagai pembebasan.
 *
 * ## ⛔ Kosong pun tidak berbunyi seperti pembebasan
 *
 * Rentang yang perangkat kasirnya belum tersinkronisasi juga menghasilkan nol
 * baris. Keadaan kosong menyebut kemungkinan itu — laporan ini dipakai untuk
 * menilai orang, dan "tidak ada apa-apa" yang sebenarnya berarti "datanya belum
 * sampai" adalah kesimpulan yang salah dengan akibat pada manusia.
 *
 * ## ⛔ Satu fungsi untuk kedelapan laporan
 *
 * Kosakatanya per laporan (`def.kosong`), keputusannya satu. Delapan salinan
 * berarti tujuh kesempatan melupakan kalimat sinkronisasi di atas.
 */
export function pesanLaporan(
  def: DefinisiLaporan,
  keadaan: KeadaanLaporan,
  namaOutlet: (id: string | null) => string
): PesanLayar | null {
  if (def.endpoint === null) {
    return { judul: def.judul, badan: def.alasanTidakAda ?? '' };
  }
  if (keadaan.jenis === 'memuat') {
    return {
      judul: 'Menghitung…',
      badan: `Server sedang mengumpulkan ${def.kosong.benda} pada rentang ini.`,
    };
  }
  if (keadaan.jenis === 'awal') {
    return {
      judul: 'Pilih rentang tanggal',
      badan: 'Tentukan tanggal awal dan akhir, lalu tekan Tampilkan.',
    };
  }
  if (keadaan.jenis === 'galat') {
    return { judul: 'Laporan tidak dapat dimuat', badan: keadaan.pesan };
  }

  const { hasil } = keadaan;
  if (barisLaporan(def, hasil).length > 0) return null;

  const dari = String(hasil.from ?? '');
  const sampai = String(hasil.to ?? '');
  const outletId = typeof hasil.outletId === 'string' ? hasil.outletId : null;
  const periode = dari === sampai ? `pada ${dari}` : `antara ${dari} dan ${sampai}`;
  return {
    judul: def.kosong.judul,
    badan:
      `Tidak ada ${def.kosong.benda} yang tercatat ${periode} untuk ${namaOutlet(outletId)}. ` +
      'Perlu diingat: perangkat kasir yang belum tersinkronisasi juga menghasilkan daftar kosong, ' +
      `jadi periksa status sinkronisasi sebelum menyimpulkan ${def.kosong.simpul}.`,
  };
}

// ---------------------------------------------------------------------------
// Aturan tampilan per laporan
// ---------------------------------------------------------------------------

/**
 * `posisi` X2 → kalimat.
 *
 * ⛔ Teks, bukan warna baris (aturan design system #5). Dan deskriptif:
 * `Sesudah shift ditutup` menyatakan fakta; sebuah label yang menyebutnya
 * patut dicurigai adalah kesimpulan yang ditarik sistem atas nama manusia.
 */
export function posisiTampil(posisi: string): string {
  if (posisi === 'sesudah_tutup') return 'Sesudah shift ditutup';
  if (posisi === 'akhir_shift') return '60 menit terakhir';
  return posisi;
}

/**
 * Menit ke penutupan → kalimat.
 *
 * ⛔ Server mengirim NEGATIF untuk void sesudah tutup; menampilkannya apa
 * adanya ("−12 menit sebelum tutup") membuat pembaca harus menerjemahkan tanda
 * minus sendiri.
 */
export function jarakTutupTampil(menit: number | null): string {
  if (menit === null) return '—';
  if (menit < 0) return `${Math.abs(menit)} menit sesudah tutup`;
  return `${menit} menit sebelum tutup`;
}

const ARAH: Record<string, string> = {
  naik: 'Bergerak ke arah lebih',
  turun: 'Bergerak ke arah kurang',
  datar: 'Belum menunjukkan arah',
};

/**
 * Arah tren X7 → kalimat.
 *
 * ⛔ `datar` juga berarti "deretnya terlalu pendek", dan kalimatnya menyatakan
 * itu: "belum menunjukkan arah", bukan "stabil". Kasir dengan dua shift yang
 * dilabeli "stabil" memberi pembaca keyakinan yang tidak dimiliki datanya.
 */
export function trenTampil(arah: string): string {
  return ARAH[arah] ?? arah;
}

/**
 * Selisih kas bertanda → kalimat berarah.
 *
 * ⛔ Kurang dan lebih adalah keadaan yang BERBEDA, dan keduanya disebutkan
 * dengan kata, bukan hanya tanda minus. `spec-d` memperlakukan keduanya
 * berbeda, dan pembaca laporan ini memakainya untuk memutuskan apakah perlu
 * bicara dengan seseorang.
 */
export function arahSelisih(nilai: string): string {
  const n = Number(nilai);
  if (!Number.isFinite(n) || n === 0) return 'pas';
  return n < 0 ? 'kurang' : 'lebih';
}

/**
 * Ringkasan sebaran alasan X5 — bentuk yang sama dengan X1.
 *
 * Memakai `labelAlasan` yang sama supaya kode alasan yang ditambahkan kelak
 * hanya perlu dilabeli sekali.
 */
export function ringkasSebaran(alasan: readonly { reasonCode: string; jumlah: number }[]): string {
  if (alasan.length === 0) return '—';
  return alasan.map((a) => `${labelAlasan(a.reasonCode)} ${a.jumlah}×`).join(' · ');
}

/**
 * Selisih jam X8 → kalimat.
 *
 * ⛔ Arahnya disebutkan dengan kata. "Maju 62 menit" dan "mundur 62 menit"
 * menempatkan transaksi di shift yang berbeda, dan tanda minus di kolom angka
 * tidak cukup untuk membedakannya sekilas.
 */
export function skewTampil(detik: number): string {
  const arah = detik < 0 ? 'mundur' : 'maju';
  const abs = Math.abs(detik);
  if (abs < 60) return `${arah} ${abs} detik`;
  const menit = Math.round(abs / 60);
  if (menit < 60) return `${arah} ${menit} menit`;
  const jam = Math.floor(menit / 60);
  const sisa = menit % 60;
  return sisa === 0 ? `${arah} ${jam} jam` : `${arah} ${jam} jam ${sisa} menit`;
}

/** Rasio X4/X5 — bentuk yang sama dengan X1, lewat fungsi yang sama. */
export { rasioTampil };
