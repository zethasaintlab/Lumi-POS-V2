/**
 * Gambar produk — batas dan validasinya. SATU aturan, dipakai server DAN klien.
 *
 * `CLAUDE.md` § Gambar produk. Diukur sebelum ditulis:
 * `docs/verifikasi/GAMBAR-ANGGARAN.md`.
 *
 * ## ⛔ Kenapa BATAS, bukan target kualitas
 *
 * Terukur pada encoder yang sama dengan yang klien pakai: WebP 400×400
 * merentang **50×** antara konten yang mudah dan sulit dikompresi — 1,9 KB
 * untuk bidang warna, 20,7 KB untuk foto berdetail, 108 KB untuk derau.
 *
 * Anggaran yang dihitung dari ukuran TIPIKAL karena itu berubah setiap kali
 * seorang merchant mengunggah foto yang lebih rumit dari dugaan kita, dan
 * yang membayarnya adalah setiap perangkat di armada. Yang dipakai
 * kebalikannya: batas keras per gambar, sehingga anggaran per perangkat
 * `BATAS_BYTE × jumlah item` — **deterministik**.
 *
 * Pada 500 item: 15,6 MB. Ambang yang user tetapkan ~20 MB.
 *
 * ## ⛔ Ia batas SERVER, dan klien menurunkan kualitas sampai muat
 *
 * Klien mengompres bertahap (`KUALITAS_TURUN_PERSEN`) sampai hasilnya ≤ `BATAS_BYTE`.
 * Jadi batas ini bukan pintu penolakan bagi merchant — ia pintu penolakan bagi
 * KLIEN yang tidak menjalankan kompresinya. Yang ditolak server adalah muatan
 * yang tidak mungkin datang dari alur unggah yang benar.
 *
 * Murni: tanpa I/O, tanpa jam, tanpa DOM.
 */

/** 400×400, satu ukuran. Ukuran kedua menggandakan anggaran armada. */
export const SISI_PIKSEL = 400;

/**
 * ⛔ 32 KB, dan angkanya diturunkan dari pengukuran — bukan dikarang.
 *
 * ~55% di atas sampel foto-mirip tertinggi yang terukur (20,7 KB), jadi foto
 * sah tidak tertolak. Menaikkannya menaikkan anggaran armada secara linier:
 * setiap 1 KB tambahan adalah 0,5 MB per perangkat pada 500 item.
 */
export const BATAS_BYTE = 32 * 1024;

/**
 * Tangga kualitas yang klien coba, dari yang terbaik. Nilainya PERSEN.
 *
 * ⛔ Berhenti di 50, tidak turun lebih jauh. Di bawah itu WebP mulai
 * menghasilkan artefak blok yang terlihat sebagai KOTOR pada foto makanan —
 * dan gambar yang membuat produk terlihat buruk lebih merugikan daripada
 * kartu tanpa gambar sama sekali. Foto yang tidak muat pada 50 ditolak di
 * klien dengan kalimat yang menyebut apa yang harus merchant lakukan.
 *
 * ⛔ PERSEN bilangan bulat, bukan pecahan 0..1 — dan itu bukan gaya.
 *
 * Penjaga invariant #7 (`tests/domain/tax-invariant.test.js`) memindai
 * `packages/domain` untuk angka yang BERBENTUK tarif pajak, dan `0.85, 0.8,
 * 0.72` persis berbentuk itu. Penjaga itu ada karena `0.11` yang menyelinap ke
 * luar `TaxCalculator` adalah cacat arsitektur, dan ia BENAR menandai deret di
 * sini — ia tidak dapat tahu bahwa ini kualitas WebP.
 *
 * Yang salah adalah menambahkan pengecualian untuknya: daftar pengecualian
 * akan bertambah panjang sampai penjaganya tidak menjaga apa pun. Bilangan
 * bulat menghilangkan tabrakannya sepenuhnya, dan `/ 100` terjadi di titik
 * pemakaian — di luar `packages/domain`, pada nilai yang bukan uang.
 */
export const KUALITAS_TURUN_PERSEN = [85, 80, 72, 64, 55, 50] as const;

/**
 * ⛔ Daftar TERTUTUP, dan `image/webp` TIDAK ada di dalamnya sebagai masukan.
 *
 * Ini mime yang boleh merchant PILIH dari perangkatnya. Yang diunggah selalu
 * WebP hasil kanvas — jadi `image/webp` di sisi unggah berarti klien
 * meneruskan berkas apa adanya tanpa mengompres, dan berkas 8 MB dari kamera
 * ponsel akan lolos ke setiap perangkat di armada.
 */
export const MIME_SUMBER = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Satu-satunya mime yang server terima untuk DISIMPAN. */
export const MIME_SIMPAN = 'image/webp';

export type GagalGambar =
  | 'MIME_TIDAK_DIDUKUNG'
  | 'TERLALU_BESAR'
  | 'KOSONG'
  | 'DIMENSI_SALAH';

export interface HasilPeriksa {
  ok: boolean;
  kode: GagalGambar | null;
  /** Kalimat untuk merchant. Menyebut apa yang harus ia lakukan, bukan kodenya. */
  pesan: string | null;
}

const OK: HasilPeriksa = { ok: true, kode: null, pesan: null };

/**
 * Validasi muatan gambar yang SERVER terima.
 *
 * ⛔ `lebar`/`tinggi` OPSIONAL. Server tidak men-decode gambarnya — ia tidak
 * punya dependensi native untuk itu, dan menambahkannya adalah biaya yang
 * `CLAUDE.md` § Gambar produk secara eksplisit tolak ("Server memvalidasi
 * ukuran dan mime, tidak mengolah"). Dimensinya dikirim klien dan diperiksa
 * **bila ada**; ketiadaannya bukan kegagalan.
 *
 * Konsekuensinya dinyatakan: klien yang berbohong tentang dimensi dapat
 * menyimpan gambar 40×40. Yang ia TIDAK dapat lakukan adalah membuatnya besar
 * — dan batas byte itulah yang melindungi armada.
 */
export function periksaGambar(input: {
  mime: string;
  byte: number;
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

  // ⛔ Diperiksa SEBELUM batas atas. Berkas nol byte lolos `<= BATAS_BYTE`
  // dengan mudah, lalu tersimpan sebagai baris yang ADA tetapi tidak dapat
  // dirender — kartu yang gambarnya gagal muat, tanpa satu pun error, dan
  // tanpa keadaan "tanpa gambar" yang sudah punya bentuknya sendiri.
  if (input.byte <= 0) {
    return { ok: false, kode: 'KOSONG', pesan: 'Berkas gambar kosong.' };
  }

  if (input.byte > BATAS_BYTE) {
    const kb = Math.ceil(input.byte / 1024);
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

/**
 * Anggaran unduhan per perangkat, untuk DITAMPILKAN ke merchant.
 *
 * ⛔ Dihitung dari BATAS, bukan dari ukuran gambar yang sudah ada. Merchant
 * yang melihat "2 MB" hari ini lalu 9 MB bulan depan karena fotonya makin
 * bagus tidak dapat merencanakan apa pun; yang ia butuhkan adalah pagu.
 */
export function anggaranByte(jumlahItemBergambar: number): number {
  return Math.max(0, Math.trunc(jumlahItemBergambar)) * BATAS_BYTE;
}

/** `15,6 MB` — format Indonesia, koma desimal. */
export function anggaranTampil(jumlahItemBergambar: number): string {
  const mb = anggaranByte(jumlahItemBergambar) / (1024 * 1024);
  // Satu desimal: pagu adalah perkiraan perencanaan, dan tiga desimal
  // memberinya ketepatan yang tidak ia punya.
  return `${mb.toFixed(1).replace('.', ',')} MB`;
}
