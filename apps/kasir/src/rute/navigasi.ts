// Navigasi di atas History API. Tanpa library (keputusan user 8 Agustus 2026,
// PLAN-pondasi-kasir §3.2).
//
// Pencocokan rutenya ada di `tabel.ts` dan murni; berkas ini hanya menyimpan
// bagian yang menyentuh `window`. Pemisahan itu yang membuat logika rute dapat
// diuji di `node --test`.

const PERISTIWA = 'lumi:navigasi';

/** Pathname saat ini. Di luar browser (test, SSR) selalu akar. */
export function jalurSekarang(): string {
  if (typeof window === 'undefined') return '/';
  return window.location.pathname;
}

/**
 * Berpindah layar.
 *
 * `pushState` tidak memancarkan `popstate` -- itu hanya terjadi pada tombol
 * kembali. Tanpa peristiwa buatan di bawah, navigasi dari dalam aplikasi
 * mengubah URL tanpa mengubah apa pun di layar.
 */
export function navigasi(jalur: string): void {
  if (typeof window === 'undefined') return;
  if (window.location.pathname === jalur) return;
  window.history.pushState({}, '', jalur);
  window.dispatchEvent(new Event(PERISTIWA));
}

/** Berlangganan perubahan jalur, baik dari `navigasi` maupun tombol kembali. */
export function langgananJalur(dengar: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(PERISTIWA, dengar);
  window.addEventListener('popstate', dengar);
  return () => {
    window.removeEventListener(PERISTIWA, dengar);
    window.removeEventListener('popstate', dengar);
  };
}
