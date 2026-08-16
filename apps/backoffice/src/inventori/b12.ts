/**
 * B-12 & B-13 — aturan layar Stok dan Penyesuaian.
 *
 * ## ⛔ Konversi ×1000 adalah bagian paling berbahaya di berkas ini
 *
 * Merchant mengetik `2,5`; API menerima `2500`. Repo ini sudah dua kali
 * menemukan cacat sekelas itu di form yang sudah lolos review: `bacaRupiah`
 * yang menghasilkan angka 10× salah, dan `persenKeRate` yang 100× salah.
 * Keduanya tertangkap test, bukan mata.
 *
 * Karena itu konversinya dilakukan sebagai **manipulasi string**, tidak pernah
 * lewat `Number` atau perkalian float — dan ada test property yang menuntut
 * `bacaKuantitas` dan `kuantitasTampil` saling membalik.
 */

/** Kuantitas ×1000 dibuat terbaca. Harus sepakat dengan `saldoTampil` server. */
export function kuantitasTampil(milli: bigint): string {
  const negatif = milli < 0n;
  const abs = negatif ? -milli : milli;
  const utuh = abs / 1000n;
  const sisa = abs % 1000n;
  const tanda = negatif ? '-' : '';
  if (sisa === 0n) return `${tanda}${utuh}`;
  return `${tanda}${utuh},${sisa.toString().padStart(3, '0').replace(/0+$/, '')}`;
}

/**
 * Membaca kuantitas yang diketik merchant menjadi ×1000.
 *
 * ⛔ Seluruhnya string. `Math.round(parseFloat('0,25') * 1000)` terlihat
 * benar dan gagal pada nilai yang tidak dapat diwakili biner — dan kuantitas
 * ikut aturan yang sama dengan uang: tidak menyentuh float.
 *
 * ⛔ Lebih dari tiga desimal DITOLAK, bukan dibulatkan. ×1000 tidak dapat
 * menyimpannya, dan membulatkan diam-diam berarti merchant mengetik satu
 * angka sementara sistem menyimpan angka lain.
 *
 * `null` = tidak dapat dibaca. Pemanggil yang memutuskan pesannya.
 */
export function bacaKuantitas(teks: string): string | null {
  const bersih = teks.trim().replace(',', '.');
  if (bersih === '') return null;

  // Satu tanda minus opsional, digit, paling banyak satu titik, paling banyak
  // tiga desimal. Bagian bulat WAJIB ada — `,5` ditolak, karena `.5` dan `5`
  // hanya berbeda satu ketikan dan bedanya sepuluh kali lipat.
  const cocok = /^(-?)(\d+)(?:\.(\d{1,3}))?$/.exec(bersih);
  if (cocok === null) return null;

  const [, tanda, utuh, pecahan = ''] = cocok;
  const milli = `${utuh}${pecahan.padEnd(3, '0')}`.replace(/^0+(?=\d)/, '');
  if (milli === '0') return null; // Nol tidak mengubah apa pun; server menolaknya juga.
  return `${tanda}${milli}`;
}

export type TipeGerak = 'receipt' | 'adjustment';

export interface Isian {
  outletId: string;
  variationId: string;
  tipe: TipeGerak;
  kuantitas: string;
  alasan: string;
  catatan: string;
}

export type GalatIsian = Partial<Record<keyof Isian, string>>;

/**
 * Memeriksa formulir B-13 sebelum apa pun dikirim.
 *
 * ⛔ Server memeriksa hal yang sama, dan itu bukan alasan melewatkannya di
 * sini: menyerahkan seluruhnya ke server berarti merchant mengisi formulir,
 * menekan simpan, dan baru tahu kesalahannya setelah perjalanan bolak-balik.
 * Yang di server adalah batasnya; yang di sini adalah bantuannya.
 */
export function periksaIsian(isian: Isian): GalatIsian {
  const galat: GalatIsian = {};

  if (isian.outletId === '') galat.outletId = 'Pilih outlet.';
  if (isian.variationId === '') galat.variationId = 'Pilih produk dan variannya.';

  const milli = bacaKuantitas(isian.kuantitas);
  if (milli === null) {
    galat.kuantitas =
      'Isi jumlah, misalnya 10 atau 2,5. Paling banyak tiga angka di belakang koma.';
  } else if (isian.tipe === 'receipt' && milli.startsWith('-')) {
    // ⛔ Cerminan aturan server: `receipt` negatif adalah cara mengurangi stok
    // TANPA alasan, dan itu persis yang penyesuaian diwajibkan menyertakannya.
    galat.kuantitas = 'Barang masuk tidak boleh negatif. Untuk mengurangi, pilih Penyesuaian.';
  }

  // AC FR-E2: "`adjustment` tanpa `reason_code` ditolak."
  if (isian.tipe === 'adjustment' && isian.alasan.trim() === '') {
    galat.alasan = 'Penyesuaian wajib menyebut alasan — koreksi tanpa alasan tidak dapat diaudit.';
  }

  return galat;
}

export interface BadanGerak {
  outletId: string;
  variationId: string;
  type: TipeGerak;
  delta: string;
  reasonCode?: string;
  note?: string;
}

/** Badan permintaan `POST /inventory/movements`. Panggil setelah `periksaIsian`. */
export function susunBadan(isian: Isian): BadanGerak {
  const badan: BadanGerak = {
    outletId: isian.outletId,
    variationId: isian.variationId,
    type: isian.tipe,
    // Sudah divalidasi; `?? '0'` hanya menjaga tipe, bukan menutupi kesalahan.
    delta: bacaKuantitas(isian.kuantitas) ?? '0',
  };
  const alasan = isian.alasan.trim();
  const catatan = isian.catatan.trim();
  if (alasan !== '') badan.reasonCode = alasan;
  if (catatan !== '') badan.note = catatan;
  return badan;
}

/** Alasan penyesuaian — daftar tertutup, sejajar dengan alasan pembatalan. */
export const ALASAN_PENYESUAIAN = [
  { kode: 'rusak', label: 'Barang rusak' },
  { kode: 'kedaluwarsa', label: 'Kedaluwarsa' },
  { kode: 'hilang', label: 'Hilang' },
  { kode: 'salah_catat', label: 'Salah catat' },
  { kode: 'opname', label: 'Hasil hitung fisik' },
  { kode: 'lainnya', label: 'Lainnya' },
] as const;

// ---------------------------------------------------------------------------
// B-12 daftar
// ---------------------------------------------------------------------------

export interface BarisStok {
  variationId: string;
  itemId: string;
  itemName: string;
  variationName: string;
  categoryId: string | null;
  outletId: string;
  trackStock: boolean;
  archived: boolean;
  saldoMilli: string;
  saldo: string;
  jumlahMovement: number;
  movementTerakhir: string | null;
}

/**
 * Penyaringan di KLIEN.
 *
 * Endpointnya tidak berpaginasi, dan pada skala kafe (puluhan sampai ratusan
 * varian) menyaring di klien terasa seketika tanpa perjalanan ke server per
 * ketikan. Batasnya dicatat: kalau katalog tumbuh jauh, penyaringan pindah ke
 * server — dan urutannya penting, pencarian server harus lebih dulu daripada
 * paginasi (`PENYELIDIKAN-b05.md` §6).
 */
export function saringStok(
  daftar: readonly BarisStok[],
  { cari, tampilArsip = false }: { cari: string; tampilArsip?: boolean }
): BarisStok[] {
  const kata = cari.trim().toLowerCase();
  return daftar.filter((b) => {
    // ⛔ Katalog tidak pernah dihapus, hanya diarsipkan (invariant #2). Tanpa
    // penyaring ini daftar stok terus menampilkan barang yang sudah tidak
    // dijual, dan angkanya tidak akan pernah berubah lagi.
    if (!tampilArsip && b.archived) return false;
    if (kata === '') return true;
    return (
      b.itemName.toLowerCase().includes(kata) || b.variationName.toLowerCase().includes(kata)
    );
  });
}

/**
 * Nada baris untuk saldo.
 *
 * ⛔ Nol BUKAN keadaan negatif. Nol berarti habis — keadaan yang wajar dan
 * sering benar; menandainya seperti minus membuat merchant mencari masalah
 * yang tidak ada.
 */
export function nadaStok(saldoMilli: string): 'neutral' | 'warning' {
  try {
    return BigInt(saldoMilli) < 0n ? 'warning' : 'neutral';
  } catch {
    return 'neutral';
  }
}

/**
 * Teks yang MENEMANI nada. Aturan design system #5: status tidak pernah warna
 * saja — dan di layar ini warnanya menandai angka yang mustahil secara fisik.
 */
export function labelStok(saldoMilli: string): string {
  return nadaStok(saldoMilli) === 'warning' ? 'minus' : '';
}

export function ringkasStok(daftar: readonly BarisStok[]): { jumlah: number; negatif: number } {
  let negatif = 0;
  for (const b of daftar) if (nadaStok(b.saldoMilli) === 'warning') negatif += 1;
  return { jumlah: daftar.length, negatif };
}

export type Keadaan =
  | { jenis: 'memuat' }
  | { jenis: 'siap'; items: readonly BarisStok[] }
  | { jenis: 'galat'; pesan: string };

export interface PesanLayar {
  judul: string;
  badan: string;
}

/**
 * Pesan yang menggantikan tabel, atau `null`.
 *
 * ⛔ Kosong KARENA PENCARIAN dibedakan dari kosong karena tidak ada data.
 * "Belum ada stok" untuk kata pencarian yang tidak cocok membuat merchant
 * mengira katalognya kosong — lalu memasukkan ulang barang yang sudah ada,
 * dan sekarang stoknya dobel.
 */
export function pesanKeadaan(keadaan: Keadaan, cari: string): PesanLayar | null {
  if (keadaan.jenis === 'memuat') {
    return { judul: 'Memuat stok…', badan: 'Server sedang menjumlahkan pergerakan stok.' };
  }
  if (keadaan.jenis === 'galat') {
    return { judul: 'Stok tidak dapat dimuat', badan: keadaan.pesan };
  }
  if (keadaan.items.length > 0) return null;

  const kata = cari.trim();
  if (kata !== '') {
    return {
      judul: 'Tidak ada produk yang cocok',
      badan: `Tidak ada produk atau varian yang namanya memuat "${kata}". Kosongkan pencarian untuk melihat seluruh stok.`,
    };
  }
  return {
    judul: 'Belum ada stok tercatat',
    badan:
      'Belum ada satu pun pergerakan stok di outlet ini. Tekan Barang Masuk untuk mencatat ' +
      'stok awal — sampai itu dilakukan, setiap penjualan membuat saldonya minus.',
  };
}

// ---------------------------------------------------------------------------
// Peringatan stok menipis
// ---------------------------------------------------------------------------

/**
 * ⛔ Ambang "menipis" adalah PENYARING TAMPILAN, bukan data.
 *
 * Tidak ada kolom `minimum_stock_level` di skema mana pun, dan tidak ada satu
 * pun FR yang menuntutnya — diperiksa terhadap `spec-e` dan PRD. Menambahkan
 * migrasi untuk itu berarti mengarang kebutuhan produk.
 *
 * Yang lebih menentukan: ambang minimum yang benar **berbeda per barang**.
 * Lima kilogram biji kopi dan lima cangkir bukan angka yang sebanding, dan
 * satu nilai untuk seluruh katalog akan salah untuk hampir semuanya.
 *
 * Karena itu ambangnya hidup di layar, dapat diubah merchant, dan **tidak
 * disimpan**. Ia menjawab "tunjukkan yang di bawah N" — pertanyaan yang jujur
 * — bukan berpura-pura sistem tahu batas amannya.
 *
 * `[ASUMSI]` nilai bawaannya. Minimum per varian yang tersimpan menuntut
 * migrasi DAN keputusan produk, dan keduanya milik user.
 */
export const AMBANG_MENIPIS_BAWAAN = 5;

/** Keadaan stok yang layak diperhatikan, dari yang paling mendesak. */
export type TingkatStok = 'minus' | 'habis' | 'menipis' | 'aman';

/**
 * ⛔ `habis` (nol) dibedakan dari `minus`.
 *
 * Nol berarti barangnya benar-benar tidak ada — keadaan yang wajar dan sering
 * benar. Minus berarti terjual melebihi yang tercatat masuk, dan itu keadaan
 * yang mustahil secara fisik: entah stok awalnya belum dicatat, atau ada
 * penjualan yang tidak seharusnya bisa terjadi.
 *
 * Menyamakannya membuat merchant baru — yang seluruh stoknya memang belum
 * dicatat — melihat daftar penuh peringatan yang tidak dapat ia tindaklanjuti.
 */
export function tingkatStok(saldoMilli: string, ambangUtuh: number): TingkatStok {
  let n: bigint;
  try {
    n = BigInt(saldoMilli);
  } catch {
    return 'aman';
  }
  if (n < 0n) return 'minus';
  if (n === 0n) return 'habis';
  // Ambang dibandingkan dalam satuan ×1000, tanpa float.
  return n <= BigInt(Math.trunc(ambangUtuh)) * 1000n ? 'menipis' : 'aman';
}

export const LABEL_TINGKAT: Record<TingkatStok, string> = {
  minus: 'Minus',
  habis: 'Habis',
  menipis: 'Menipis',
  aman: '',
};

export function nadaTingkat(t: TingkatStok): 'warning' | 'neutral' {
  return t === 'aman' ? 'neutral' : 'warning';
}

/**
 * Menyaring daftar stok ke yang perlu diperhatikan.
 *
 * ⛔ Varian yang stoknya TIDAK DILACAK dikecualikan. Produk jasa tidak punya
 * stok untuk menipis, dan memasukkannya membuat daftar peringatan penuh baris
 * yang tidak dapat ditindaklanjuti siapa pun.
 */
export function saringMenipis(
  daftar: readonly BarisStok[],
  ambangUtuh: number
): BarisStok[] {
  return daftar.filter(
    (b) => b.trackStock && !b.archived && tingkatStok(b.saldoMilli, ambangUtuh) !== 'aman'
  );
}
