import { ukurSemuaVfs, type BarisHasil } from './vfs.ts';

const tbody = document.querySelector('#hasil') as HTMLElement;
const status = document.querySelector('#status') as HTMLElement;

function sel(isi: string) {
  const td = document.createElement('td');
  td.textContent = isi;
  return td;
}

function ms(v: number | null) {
  return v === null ? '-' : v.toFixed(2);
}

function tambah(b: BarisHasil) {
  const tr = document.createElement('tr');
  tr.append(
    sel(b.vfs),
    sel(b.status === 'ok' ? 'ok' : b.status),
    sel(ms(b.pasangSkemaMs)),
    sel(ms(b.p50)),
    sel(ms(b.p95)),
    sel(ms(b.p99)),
    sel(b.penjualanPerDetik === null ? '-' : b.penjualanPerDetik.toFixed(0)),
    sel(b.disimpanDi)
  );
  tbody.append(tr);
  console.log(
    `VFS\t${b.vfs}\t${b.status}\tskema=${ms(b.pasangSkemaMs)}\tp50=${ms(b.p50)}\tp95=${ms(
      b.p95
    )}\tp99=${ms(b.p99)}\t${b.disimpanDi}`
  );
}

status.textContent = 'mengukur… (4 VFS × 60 penjualan)';
ukurSemuaVfs(tambah)
  .then(() => {
    status.textContent = 'selesai';
    console.log('SELESAI');
  })
  .catch((e) => {
    status.textContent = `GAGAL: ${e.name}: ${e.message}`;
    console.error(e);
  });
