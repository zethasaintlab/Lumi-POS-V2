// Pemberitahu perubahan antrean.
//
// ⛔ Ada karena angka, bukan karena selera. `watch()` PowerSync memberi tahu
// perubahan pada raw table kami dalam ~1.000 ms -- diukur 8 Agustus 2026,
// lima kali lewat `execute` (997/1013/1004/1004/998 ms) dan empat kali lewat
// `writeTransaction` (1014/1001/1013/999 ms), dan `throttleMs` tidak
// mengubahnya sama sekali.
//
// `spec-h:224` menuntut "Indikator diperbarui < 1 detik setelah perubahan
// status". Seribu milidetik bukan di bawah satu detik; ia tepat di ambangnya,
// dan separuh pengukuran melewatinya.
//
// Yang dikirim lewat sini HANYA ISYARAT untuk membaca ulang -- bukan datanya.
// Itu perbedaan yang menjaga keputusan §3.3 (PLAN-pondasi-kasir) tetap utuh:
// database lokal tetap satu-satunya sumber kebenaran, dan yang dipercepat
// hanya kapan seseorang tahu harus bertanya lagi.
//
// `watch()` TIDAK diganti. Ia tetap dibutuhkan untuk perubahan yang tidak
// lewat kode kita: katalog yang turun dari server, dan tulisan dari tab lain.
// Yang satu instan tapi buta terhadap dunia luar; yang lain lambat tapi
// melihat semuanya.

export interface Pemberitahu {
  /** Mengembalikan fungsi untuk berhenti berlangganan. */
  langgan(dengar: () => void): () => void;
  /** Memberi tahu bahwa antrean mungkin berubah. */
  beritahu(): void;
  readonly jumlahPelanggan: number;
}

export function buatPemberitahu(): Pemberitahu {
  const pelanggan = new Set<() => void>();

  return {
    langgan(dengar) {
      pelanggan.add(dengar);
      return () => {
        pelanggan.delete(dengar);
      };
    },
    beritahu() {
      // Disalin dulu: pelanggan yang berhenti berlangganan DI DALAM
      // callback-nya sendiri -- pola biasa di React saat komponen dilepas --
      // akan mengubah Set yang sedang diiterasi.
      for (const dengar of [...pelanggan]) {
        try {
          dengar();
        } catch {
          // Satu pelanggan yang melempar tidak boleh menghalangi sisanya.
          // Yang di ujung sana adalah indikator sinkronisasi; kegagalannya
          // tidak boleh ikut menjatuhkan penjadwal yang memanggilnya.
        }
      }
    },
    get jumlahPelanggan() {
      return pelanggan.size;
    },
  };
}
