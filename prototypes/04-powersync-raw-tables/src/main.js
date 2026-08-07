import { jalankanSemua, modeTahan, setPelapor } from './uji.js';

const tabel = document.querySelector('#hasil');
const status = document.querySelector('#status');
let gagal = 0;

setPelapor(({ nama, nilai, lulus }) => {
  const tr = document.createElement('tr');
  const a = document.createElement('td');
  a.textContent = lulus ? '✓' : '✗';
  a.style.color = lulus ? '#0D5C63' : '#B3261E';
  const b = document.createElement('td');
  b.textContent = nama;
  const c = document.createElement('td');
  c.textContent = nilai;
  tr.append(a, b, c);
  tabel.append(tr);
  if (!lulus) gagal += 1;
  // Dicetak juga ke console supaya dapat dipanen tanpa membaca DOM.
  console.log(`HASIL\t${lulus ? 'LULUS' : 'GAGAL'}\t${nama}\t${nilai}`);
});

const params = new URLSearchParams(location.search);

if (params.has('tahan')) {
  status.textContent = 'menahan database — buka tab kedua dengan ?tahan=1';
  modeTahan().catch((e) => {
    status.textContent = `GAGAL membuka database: ${e.name}: ${e.message}`;
    console.error('GAGAL', e);
  });
} else {
  status.textContent = 'menjalankan…';
  jalankanSemua()
    .then(() => {
      status.textContent = gagal === 0 ? 'selesai — semua uji LULUS' : `selesai — ${gagal} uji GAGAL`;
      console.log(`SELESAI\t${gagal} gagal`);
    })
    .catch((e) => {
      status.textContent = `GAGAL: ${e.name}: ${e.message}`;
      console.error('GAGAL', e);
    });
}
