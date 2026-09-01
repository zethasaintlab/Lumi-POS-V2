import { useEffect, type ReactNode } from 'react';

/**
 * Latar dialog kasir — SATU pembungkus untuk ketujuhnya, dan Escape menutupnya.
 *
 * ## ⛔ Cacat yang ini tutup
 *
 * Tujuh dialog kasir menulis `<div className="kasir-dialog-latar" role="dialog">`
 * masing-masing, dan tidak satu pun menangani Escape: modifier, pembatalan,
 * no-sale, diskon, otorisasi, kas manual. Satu-satunya jalan keluar adalah
 * menemukan dan menekan tombol "Batal".
 *
 * Diukur di browser, bukan dibaca dari kode: dialog varian dibuka, Escape
 * ditekan, `[role=dialog]` tetap berjumlah 1. Klik di luar kotak juga tidak
 * menutupnya. Hanya "Batal" yang bekerja.
 *
 * ⛔ **Perbaikan Escape yang saya buat 31 Agustus TIDAK menutup ini.**
 * `packages/ds/overlay.tsx` membungkus `Modal` dan `ConfirmDialog` milik
 * `/ds-bundle` — dan tidak satu pun dari ketujuh dialog kasir memakainya.
 * Kelas cacat yang sama dengan `.product-card` dan `.chip`: kasir menulis
 * versinya sendiri, lalu perbaikan pada versi bundle lewat begitu saja.
 *
 * Ongkosnya nyata dan sudah dibayar sekali: sapuan audit UI pertama MACET di
 * layar ke-10 dari 26 karena sebuah dialog menutupi navigasi dan tidak dapat
 * ditutup dari keyboard.
 *
 * ## ⛔ Escape membatalkan, TIDAK PERNAH mengonfirmasi
 *
 * Aturan yang sama dengan `packages/ds/overlay.tsx`. Dialog-dialog ini
 * menjaga aksi yang menyentuh uang — void, refund, diskon, otorisasi manajer,
 * kas keluar. Tombol keluar darurat tidak boleh punya jalan menuju "ya".
 *
 * ## ⛔ Klik di luar TIDAK menutup, dan itu keputusan
 *
 * Bawaan banyak sistem desain adalah menutup saat latar diklik. Di sini tidak:
 * lima dari tujuh dialog memuat masukan yang sedang diketik — PIN manajer,
 * alasan pembatalan, nominal kas, jumlah modifier. Ketukan meleset di tepi
 * layar tablet adalah kejadian biasa, dan yang hilang karenanya adalah
 * pekerjaan orang yang sedang berdiri di depan pelanggan.
 *
 * Escape menuntut niat; ketukan di tepi tidak. Batas ini dinyatakan, bukan
 * terlewat.
 */
export function LatarDialog({
  label,
  onBatal,
  children,
}: {
  label: string;
  /** Dipanggil saat Escape. Selalu jalur BATAL, tidak pernah konfirmasi. */
  onBatal: () => void;
  children: ReactNode;
}) {
  /* ⛔ Hook dipanggil TANPA SYARAT. Hook di belakang percabangan mengubah
     jumlah hook antar render, dan React menjawabnya dengan membongkar seluruh
     pohon — cacat yang membuat back-office menjadi halaman putih pada detik
     merchant menekan "Masuk" (31 Agustus 2026). */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      /* `stopPropagation` supaya dialog yang bersarang di atas dialog lain
         tidak menutup keduanya sekaligus — K-10 membuka otorisasi di atas
         pembatalan, dan Escape di sana harus mengembalikan kasir ke dialog
         pembatalan, bukan membuangnya ke grid. */
      e.stopPropagation();
      onBatal();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onBatal]);

  return (
    <div className="kasir-dialog-latar" role="dialog" aria-modal="true" aria-label={label}>
      <div className="kasir-dialog">{children}</div>
    </div>
  );
}
