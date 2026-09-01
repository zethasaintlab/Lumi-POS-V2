import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Galeri } from './Galeri.tsx';

/* ⛔ StrictMode SENGAJA dinyalakan.
   Ia merender dua kali di pengembangan, dan itu justru yang diinginkan:
   pelanggaran aturan hook dan efek yang tidak bersih muncul di sini alih-alih
   di tangan merchant. Cacat halaman-putih yang lolos 31 Agustus adalah
   pelanggaran urutan hook. */
createRoot(document.querySelector('#galeri') as HTMLElement).render(
  <StrictMode>
    <Galeri />
  </StrictMode>
);
