import { jalankan, pantau, setPelapor } from './uji.js';

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
  console.log(`HASIL\t${lulus ? 'LULUS' : 'GAGAL'}\t${nama}\t${nilai}`);
});

const params = new URLSearchParams(location.search);
const tenant = params.get('tenant') === 'beta' ? 'beta' : 'alpha';
document.querySelector('#tenant').textContent = tenant;

if (params.get('mode') === 'pantau') {
  status.textContent = `memantau perubahan (tenant ${tenant})…`;
  pantau(tenant).catch((e) => {
    status.textContent = `GAGAL: ${e.name}: ${e.message}`;
    console.error('GAGAL', e);
  });
} else {
  status.textContent = `menjalankan (tenant ${tenant})…`;
  jalankan(tenant)
    .then(() => {
      status.textContent = gagal === 0 ? 'selesai — semua uji LULUS' : `selesai — ${gagal} uji GAGAL`;
      console.log(`SELESAI\t${gagal} gagal`);
    })
    .catch((e) => {
      status.textContent = `GAGAL: ${e.name}: ${e.message}`;
      console.error('GAGAL', e);
    });
}
