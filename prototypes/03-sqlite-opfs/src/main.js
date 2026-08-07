// Thread UI. Ia sengaja tidak menyentuh SQLite sama sekali — seluruh engine
// dan OPFS hidup di worker, mengikuti pola yang direkomendasikan
// `research/03-TECH-STACK-EVALUATION.md`:187.

const tabel = document.querySelector('#hasil');
const status = document.querySelector('#status');

function baris(nama, nilai) {
  const tr = document.createElement('tr');
  const a = document.createElement('td');
  a.textContent = nama;
  const b = document.createElement('td');
  b.textContent = nilai;
  tr.append(a, b);
  tabel.append(tr);
}

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

worker.onmessage = (ev) => {
  const d = ev.data;
  if (d.jenis === 'progres') {
    baris(d.nama, d.nilai);
    // Dicetak juga ke console supaya dapat dipanen tanpa membaca DOM.
    console.log(`HASIL\t${d.nama}\t${d.nilai}`);
  } else if (d.jenis === 'selesai') {
    status.textContent = 'selesai';
    console.log('SELESAI', JSON.stringify(d.hasil));
  } else if (d.jenis === 'gagal') {
    status.textContent = `GAGAL: ${d.pesan}`;
    console.error('GAGAL', d.pesan);
  }
};

worker.onerror = (e) => {
  status.textContent = `GAGAL memuat worker: ${e.message}`;
  console.error('GAGAL worker', e.message);
};

// ?tahan=1 -- buka pool dan tahan, supaya tab lain dapat mencoba merebutnya.
const perintah = new URLSearchParams(location.search).has('tahan') ? 'tahan' : 'jalankan';
status.textContent = perintah === 'tahan' ? 'menahan pool…' : 'menjalankan…';
worker.postMessage(perintah);
