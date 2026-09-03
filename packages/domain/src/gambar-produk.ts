/**
 * Gambar produk — batas, penyandian, dan verifikasinya. SATU aturan, dipakai
 * server DAN klien.
 *
 * `CLAUDE.md` § Gambar produk. Diukur sebelum ditulis:
 * `docs/verifikasi/GAMBAR-ANGGARAN.md`.
 *
 * ## ⛔ TEKS base64, BUKAN `bytea`/`BLOB` — dan itu pencabutan yang diukur
 *
 * Keputusan awal user adalah `bytea` PostgreSQL yang turun lewat PowerSync.
 * Ia **ditarik user 2 September 2026** setelah diukur, bukan setelah
 * diperdebatkan.
 *
 * Yang menentukan bukan "base64 lebih aman". Yang menentukan ini: bila byte
 * biner melintas jalur teks dengan salah, muatan 15 byte menjadi **4 byte**,
 * tersimpan sebagai `text` di kolom `BLOB` — dan **tanpa satu pun error**.
 * `length()` mengembalikan 4, jadi pemeriksaan "ada isinya" bernilai BENAR.
 * Satu-satunya pembeda rusak dari utuh adalah panjang ASLI, dan itu angka yang
 * perangkat tidak punya.
 *
 * Base64 menghapus KELASNYA: tidak ada biner yang melintasi transport sama
 * sekali, jadi tidak ada `put` yang harus menebak representasi mana yang
 * datang. Ongkosnya +33% byte, dan itu sudah masuk anggaran di bawah.
 *
 * ⛔ Jangan mengembalikan `bytea` sebagai "optimasi ukuran". Ia ditolak karena
 * DIUKUR, bukan karena tidak terpikir.
 *
 * ## ⛔ Panjang + checksum menempel di baris yang sama
 *
 * Base64 menghapus kelas kerusakan biner; ia tidak menghapus kerusakan
 * TRANSPORT (pemotongan, penulisan sebagian). Yang menghapus DIAMNYA adalah
 * dua kolom tambahan: panjang byte hasil decode, dan checksum atas teksnya.
 * Perangkat memverifikasi keduanya saat membaca, dan yang tidak cocok
 * menghasilkan keadaan **"gambar gagal dimuat"** — keadaan yang BERBEDA dari
 * "item ini belum punya gambar".
 *
 * ~40 byte per baris. Murah untuk menukar kekosongan diam menjadi keadaan
 * yang punya namanya sendiri.
 *
 * Murni: tanpa I/O, tanpa jam, tanpa DOM.
 */

/** 400×400, satu ukuran. Ukuran kedua menggandakan anggaran armada. */
export const SISI_PIKSEL = 400;

/**
 * Batas byte gambar SEBELUM disandikan base64.
 *
 * ⛔ 30 KB, turun dari 32 KB saat `bytea` dicabut — dan turunnya kecil karena
 * itu memang ongkos base64, bukan ongkos keamanan:
 *
 *     30 KB mentah → 40 KB base64 → × 500 item = 19,5 MB
 *
 * Tetap di bawah ambang ~20 MB yang user tetapkan. Angka mentahnya masih ~45%
 * di atas sampel foto-mirip tertinggi yang terukur (20,7 KB), jadi foto sah
 * tidak tertolak.
 *
 * ⛔ SISA ANGGARANNYA 2,5%, BUKAN 22%. Menaikkan angka ini menembus anggaran
 * hampir seketika:
 *
 *     40.960 base64 × 500 = 19,53 MB   ← sekarang
 *     41.943 base64 × 500 = 20,00 MB   ← batas mutlak
 *
 * Maksimum yang MASIH MUAT: **~40,9 KB base64 ≈ 30,7 KB mentah** — kurang dari
 * satu kilobyte di atas nilai sekarang. Praktis: angka ini sudah di ujungnya.
 *
 * Setiap 1 KB tambahan di sini adalah ~0,65 MB per perangkat pada 500 item.
 * Menaikkannya ke 32 KB (nilai lama, sebelum `bytea` dicabut) menghasilkan
 * 20,8 MB — MELEWATI anggaran, dan itulah kenapa batasnya turun saat
 * penyimpanannya berubah.
 *
 * Yang menegakkannya bukan komentar ini melainkan test; komentar ini ada
 * supaya orang yang membacanya tahu berapa ruang yang tersisa sebelum ia
 * mencoba.
 */
export const BATAS_BYTE = 30 * 1024;

/**
 * Anggaran unduhan per perangkat yang user tetapkan, dan jumlah item yang
 * dipakai menghitungnya.
 *
 * ⛔ Keduanya ada di kode, bukan hanya di dokumen, supaya `BATAS_BYTE` TIDAK
 * DAPAT dinaikkan diam-diam. `tests/domain/gambar-produk.test.js` menghitung
 * `BATAS_BASE64 × ITEM_ANGGARAN` dan MERAH bila melewati `ANGGARAN_MAKS_BYTE`.
 *
 * Orang berikutnya yang menaikkan batas karena "gambar terlihat pecah" akan
 * menabrak test, bukan menemukannya di lapangan sebagai tagihan data merchant.
 */
export const ANGGARAN_MAKS_BYTE = 20 * 1024 * 1024;
export const ITEM_ANGGARAN = 500;

/**
 * Panjang string base64 untuk `BATAS_BYTE`.
 *
 * ⛔ Dihitung, bukan diketik. Angka yang diketik ulang akan menyimpang dari
 * `BATAS_BYTE` pada hari salah satunya diubah, dan yang menyimpang membuat
 * server menolak muatan yang sebenarnya sah — atau menerima yang tidak.
 */
export const BATAS_BASE64 = 4 * Math.ceil(BATAS_BYTE / 3);

/**
 * Tangga kualitas yang klien coba, dari yang terbaik. Nilainya PERSEN.
 *
 * ⛔ Berhenti di 50, tidak turun lebih jauh. Di bawah itu WebP mulai
 * menghasilkan artefak blok yang terlihat sebagai KOTOR pada foto makanan —
 * dan gambar yang membuat produk terlihat buruk lebih merugikan daripada
 * kartu tanpa gambar sama sekali.
 *
 * ⛔ PERSEN bilangan bulat, bukan pecahan 0..1 — dan itu bukan gaya. Penjaga
 * invariant #7 memindai `packages/domain` untuk angka yang BERBENTUK tarif
 * pajak, dan `0.85, 0.8, 0.72` persis berbentuk itu. Ia BENAR menandainya; ia
 * tidak dapat tahu ini kualitas WebP. Yang salah adalah menambahkan
 * pengecualian — daftar pengecualian akan bertambah sampai penjaganya tidak
 * menjaga apa pun.
 */
export const KUALITAS_TURUN_PERSEN = [85, 80, 72, 64, 55, 50] as const;

/**
 * ⛔ Daftar TERTUTUP, dan `image/webp` ada di dalamnya sebagai SUMBER saja.
 *
 * Ini mime yang boleh merchant pilih dari perangkatnya. Yang tersimpan selalu
 * WebP hasil kanvas — meneruskan berkas apa adanya berarti berkas 8 MB dari
 * kamera ponsel lolos ke setiap perangkat di armada.
 */
export const MIME_SUMBER = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Satu-satunya mime yang server terima untuk DISIMPAN. */
export const MIME_SIMPAN = 'image/webp';

/**
 * Checksum atas TEKS base64.
 *
 * ⛔ FNV-1a 32-bit, pola yang sama dengan `sidikJariRawTable`. Ia BUKAN kripto
 * dan tidak perlu: yang dilawan adalah kerusakan transport dan pemotongan,
 * bukan pemalsuan. Yang dapat menulis baris `item_image` sudah lolos RLS dan
 * RBAC; checksum yang tahan lawan tidak menambah apa pun di sana, dan ia
 * menuntut dependensi yang jalur ini tidak punya.
 *
 * ⛔ Dihitung atas TEKSNYA, bukan atas byte hasil decode. Yang dilindungi
 * adalah perjalanan teks itu; men-decode lebih dulu berarti kerusakan yang
 * mengubah teks menjadi base64 lain yang tetap sah akan lolos.
 *
 * Keluarannya heks 8 karakter — tetap panjangnya, jadi kolomnya tidak pernah
 * berubah ukuran.
 */
export function checksumGambar(base64: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < base64.length; i += 1) {
    h ^= base64.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export type GagalGambar =
  | 'MIME_TIDAK_DIDUKUNG'
  | 'TERLALU_BESAR'
  | 'KOSONG'
  | 'DIMENSI_SALAH'
  | 'BASE64_TIDAK_SAH';

export interface HasilPeriksa {
  ok: boolean;
  kode: GagalGambar | null;
  /** Kalimat untuk merchant. Menyebut apa yang harus ia lakukan, bukan kodenya. */
  pesan: string | null;
}

const OK: HasilPeriksa = { ok: true, kode: null, pesan: null };

/**
 * ⛔ Bentuk base64 diperiksa dengan REGEX, bukan diserahkan ke decoder.
 *
 * `Buffer.from(x, 'base64')` dan `atob` sama-sama menerima masukan cacat
 * DIAM-DIAM: karakter di luar alfabet base64 dibuang, jadi string sampah
 * menghasilkan keluaran PENDEK alih-alih error. Keluaran pendek itu lolos
 * batas atas dengan mudah dan tersimpan sebagai gambar yang tidak dapat
 * dirender.
 *
 * Bentuk cacat yang sama persis dengan yang membuat `bytea` dicabut: kerusakan
 * yang memendekkan, tanpa error.
 */
export function base64Sah(teks: string): boolean {
  if (teks.length === 0 || teks.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(teks);
}

/** Panjang byte hasil decode base64, dihitung TANPA men-decode. */
export function byteDariBase64(teks: string): number {
  if (!base64Sah(teks)) return 0;
  const padding = teks.endsWith('==') ? 2 : teks.endsWith('=') ? 1 : 0;
  return (teks.length / 4) * 3 - padding;
}

/**
 * Validasi muatan gambar yang SERVER terima.
 *
 * ⛔ `lebar`/`tinggi` OPSIONAL. Server tidak men-decode gambarnya — ia tidak
 * punya dependensi native untuk itu, dan `CLAUDE.md` § Gambar produk menolak
 * biayanya secara eksplisit ("Server memvalidasi ukuran dan mime, tidak
 * mengolah"). Dimensinya dikirim klien dan diperiksa **bila ada**.
 *
 * Konsekuensinya dinyatakan: klien yang berbohong tentang dimensi dapat
 * menyimpan gambar 40×40. Yang ia TIDAK dapat lakukan adalah membuatnya besar.
 */
export function periksaGambar(input: {
  mime: string;
  base64: string;
  lebar?: number;
  tinggi?: number;
}): HasilPeriksa {
  if (input.mime !== MIME_SIMPAN) {
    return {
      ok: false,
      kode: 'MIME_TIDAK_DIDUKUNG',
      pesan: 'Gambar harus dikirim dalam format WebP hasil kompresi aplikasi.',
    };
  }

  // ⛔ Diperiksa SEBELUM batas atas. Muatan kosong lolos `<= BATAS` dengan
  // mudah, lalu tersimpan sebagai baris yang ADA tetapi tidak dapat dirender —
  // kartu yang gagal muat, tanpa error, dan tanpa keadaan "tanpa gambar" yang
  // sudah punya bentuknya sendiri.
  if (input.base64.length === 0) {
    return { ok: false, kode: 'KOSONG', pesan: 'Berkas gambar kosong.' };
  }

  if (!base64Sah(input.base64)) {
    return {
      ok: false,
      kode: 'BASE64_TIDAK_SAH',
      pesan: 'Data gambar rusak saat dikirim. Coba unggah ulang.',
    };
  }

  const byte = byteDariBase64(input.base64);
  if (byte > BATAS_BYTE) {
    const kb = Math.ceil(byte / 1024);
    return {
      ok: false,
      kode: 'TERLALU_BESAR',
      pesan:
        `Gambar ${kb} KB melebihi batas ${BATAS_BYTE / 1024} KB. ` +
        'Coba foto dengan latar lebih polos, atau potong lebih rapat ke produknya.',
    };
  }

  const { lebar, tinggi } = input;
  if (lebar !== undefined && tinggi !== undefined) {
    if (lebar !== SISI_PIKSEL || tinggi !== SISI_PIKSEL) {
      return {
        ok: false,
        kode: 'DIMENSI_SALAH',
        pesan: `Gambar harus ${SISI_PIKSEL}×${SISI_PIKSEL} piksel.`,
      };
    }
  }

  return OK;
}

/** Hasil verifikasi baris gambar yang dibaca PERANGKAT. */
export type KeadaanGambar = 'utuh' | 'rusak';

/**
 * Verifikasi baris gambar di perangkat — inti dari "B menempel".
 *
 * ⛔ Tiga pemeriksaan, dan ketiganya perlu:
 *
 * - **bentuk base64** — menangkap teks yang terpotong di tengah karakter
 * - **panjang byte** — menangkap pemotongan yang kebetulan tetap sah base64
 * - **checksum** — menangkap perubahan isi yang mempertahankan panjang
 *
 * Yang tidak lolos mengembalikan `'rusak'`, dan layar menampilkan keadaan
 * **"gambar gagal dimuat"** — BUKAN keadaan "belum punya gambar". Dua keadaan
 * yang terlihat sama adalah persis kekosongan menyamar yang membuat `bytea`
 * dicabut.
 */
export function verifikasiGambar(baris: {
  base64: string;
  byte: number;
  checksum: string;
}): KeadaanGambar {
  if (!base64Sah(baris.base64)) return 'rusak';
  if (byteDariBase64(baris.base64) !== baris.byte) return 'rusak';
  if (checksumGambar(baris.base64) !== baris.checksum) return 'rusak';
  return 'utuh';
}

/**
 * Anggaran unduhan per perangkat, untuk DITAMPILKAN ke merchant.
 *
 * ⛔ Dihitung dari BATAS BASE64 — yang melintas jaringan adalah teksnya, bukan
 * byte mentahnya. Memakai `BATAS_BYTE` di sini akan melaporkan anggaran 25%
 * lebih kecil daripada yang merchant benar-benar unduh.
 *
 * ⛔ Dan dari BATAS, bukan dari gambar yang sudah ada: merchant yang melihat
 * "2 MB" hari ini lalu 9 MB bulan depan karena fotonya makin bagus tidak dapat
 * merencanakan apa pun. Yang ia butuhkan pagu.
 */
export function anggaranByte(jumlahItemBergambar: number): number {
  return Math.max(0, Math.trunc(jumlahItemBergambar)) * BATAS_BASE64;
}

/** `19,5 MB` — format Indonesia, koma desimal. */
export function anggaranTampil(jumlahItemBergambar: number): string {
  const mb = anggaranByte(jumlahItemBergambar) / (1024 * 1024);
  // Satu desimal: pagu adalah perkiraan perencanaan, dan tiga desimal
  // memberinya ketepatan yang tidak ia punya.
  return `${mb.toFixed(1).replace('.', ',')} MB`;
}
