// Pemuat harness. Halaman ini hanya ada di `vite dev`; `vite build` tetap
// membangun `index.html` saja, jadi ia tidak pernah ikut ke rilis.

import { jalankan, setPelapor } from './uji.ts';

const tabel = document.querySelector('#hasil') as HTMLElement;
const status = document.querySelector('#status') as HTMLElement;

setPelapor(({ nama, nilai, lulus }) => {
  const tr = document.createElement('tr');
  const a = document.createElement('td');
  a.textContent = lulus ? 'LULUS' : 'GAGAL';
  const b = document.createElement('td');
  b.textContent = nama;
  const c = document.createElement('td');
  c.textContent = nilai;
  tr.append(a, b, c);
  tabel.append(tr);
  console.log(`HASIL\t${lulus ? 'LULUS' : 'GAGAL'}\t${nama}\t${nilai}`);
});

// `?vfs=` memaksa VFS tertentu. Tanpa itu, yang dipakai adalah VFS_TERPILIH --
// yaitu yang benar-benar dipakai aplikasi.
const vfsDiminta = new URLSearchParams(location.search).get('vfs') ?? undefined;

status.textContent = `menjalankan…${vfsDiminta ? ` (vfs=${vfsDiminta})` : ''}`;
jalankan(vfsDiminta)
  .then((gagal) => {
    status.textContent = gagal === 0 ? 'selesai — semua uji LULUS' : `selesai — ${gagal} uji GAGAL`;
    console.log(`SELESAI\t${gagal} gagal`);
  })
  .catch((e) => {
    status.textContent = `GAGAL: ${e.name}: ${e.message}`;
    console.error('GAGAL', e);
  });
