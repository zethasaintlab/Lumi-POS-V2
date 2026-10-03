// Navigasi di atas History API. Tanpa library (keputusan user 8 Agustus 2026,
// PLAN-pondasi-kasir §3.2).
//
// Pencocokan rutenya ada di `tabel.ts` dan murni; berkas ini hanya menyimpan
// bagian yang menyentuh `window`. Pemisahan itu yang membuat logika rute dapat
// diuji di `node --test`.

import { kunciNavSekarang } from './kunci-nav.ts';

const PERISTIWA = 'lumi:navigasi';

/* Jalur terakhir yang SAH ditampilkan: tujuan `popstate` selagi terkunci
   dikembalikan ke sini. */
let jalurSah: string | null = null;

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
  /* ⛔ Pagar di SATU pintu, bukan di tiap tombol: setiap jalan keluar header
     (tab, indikator, pita, menu, lonceng) lewat sini. Tombol baru yang lupa
     tampil terkunci tetap tidak dapat meninggalkan K-06 (`kunci-nav.ts`). */
  if (kunciNavSekarang() !== null) return;
  if (window.location.pathname === jalur) return;
  window.history.pushState({}, '', jalur);
  jalurSah = window.location.pathname + window.location.search;
  window.dispatchEvent(new Event(PERISTIWA));
}

/** Berlangganan perubahan jalur, baik dari `navigasi` maupun tombol kembali. */
export function langgananJalur(dengar: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  jalurSah ??= window.location.pathname + window.location.search;
  const peristiwa = () => {
    jalurSah = window.location.pathname + window.location.search;
    dengar();
  };
  /* ⛔ Tombol Kembali peramban melewati `navigasi()`, jadi pagar kunci harus
     ada di sini juga: selagi terkunci, lokasi dikembalikan ke jalur sah dan
     layar tidak diberi tahu (K-06 tetap terpasang). */
  const popstate = () => {
    if (kunciNavSekarang() !== null && jalurSah !== null) {
      window.history.pushState({}, '', jalurSah);
      return;
    }
    peristiwa();
  };
  window.addEventListener(PERISTIWA, peristiwa);
  window.addEventListener('popstate', popstate);
  return () => {
    window.removeEventListener(PERISTIWA, peristiwa);
    window.removeEventListener('popstate', popstate);
  };
}
