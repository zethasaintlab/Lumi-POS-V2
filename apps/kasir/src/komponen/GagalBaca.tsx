import { EmptyState } from 'ds';

/**
 * Keadaan error untuk layar yang membaca database lokal saat dibuka.
 *
 * ## ⛔ Cacat yang ini tutup
 *
 * Sampai 1 September 2026 K-03, K-08, dan K-12 tidak punya keadaan error sama
 * sekali. Ketiganya memuat datanya di dalam `useEffect` tanpa satu pun
 * `catch`, jadi pembacaan yang menolak meninggalkan `siap = false`
 * **selamanya** — dan yang kasir tatap adalah "Menyiapkan kasir · Membaca
 * katalog dari perangkat", tidak dapat dibedakan dari memuat yang sedang
 * berjalan, tanpa batas waktu dan tanpa satu pun tombol.
 *
 * Ditemukan lewat galeri komponen, yang menanyakannya secara harfiah:
 * *"Apakah pesannya menyebut AKIBATNYA bagi kasir, atau hanya nama galatnya?"*
 * Jawaban yang sebenarnya adalah: tidak ada pesan sama sekali.
 *
 * Aturan design system #7 menuntut keadaan kosong DAN error di setiap
 * komponen. Ketiga layar itu memenuhi yang pertama dan melewatkan yang kedua —
 * dan yang kedua adalah yang muncul saat kuota OPFS habis, keadaan yang
 * `storage.persisted() === false` (prototipe 03) membuatnya bukan hipotesis.
 *
 * ## ⛔ Kenapa satu komponen, bukan tiga `EmptyState`
 *
 * Alasan yang sama dengan `pesanLaporan` di B-21: tiga salinan berarti dua
 * kesempatan melupakan kalimat akibatnya, dan yang lupa menyisakan layar yang
 * hanya menyebut nama galat — persis yang aturannya larang.
 *
 * `akibat` WAJIB dan tidak punya nilai bawaan: pesan yang bawaannya benar
 * untuk satu layar akan tertinggal apa adanya di layar berikutnya.
 */
export function GagalBaca({ akibat, pesan }: { akibat: string; pesan?: string | null }) {
  return (
    <EmptyState
      title="Data perangkat tidak dapat dibaca"
      /* ⛔ Akibatnya DULU, nama galatnya belakangan. Orang di depan mesin
         memutuskan apa yang harus ia lakukan dari kalimat pertama; nama galat
         ada untuk yang menolongnya lewat telepon. */
      body={`${akibat} Muat ulang aplikasi; bila tetap gagal, hubungi dukungan.${
        pesan ? ` (${pesan})` : ''
      }`}
    />
  );
}
