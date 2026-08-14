'use strict';

// AC FR-G3 pertama, dijalankan sebagai test:
//
//   "Hanya ada satu tempat di kode yang mendefinisikan omzet bersih —
//    diverifikasi dengan grep terhadap pola `status = 'VOIDED'` di luar modul
//    laporan"
//
// ⛔ Pola yang disebut spec TIDAK dapat dipakai apa adanya di repo ini.
// `status = 'voided'` muncul sah di `pembatalan.ts` dan `cancel.ts` — di
// sanalah baris pembatal DITULIS. Meng-grep pola itu akan menandai penulisan
// yang benar dan melewatkan hal yang sebenarnya berbahaya: laporan yang
// menjumlahkan `order.total` dengan aturannya sendiri.
//
// Yang dijaga di sini karena itu MAKSUD ACnya: tidak ada tempat kedua yang
// mengagregasi nilai order. Pola aslinya tetap ditegakkan untuk file laporan.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readdirSync, readFileSync, statSync } = require('node:fs');
const { join, relative, sep } = require('node:path');

const AKAR = join(__dirname, '..', '..');

/** Satu-satunya tempat yang boleh mendefinisikan omzet. */
const SUMBER_TUNGGAL = join('packages', 'domain', 'src', 'posisi-penjualan.ts');

const DIPINDAI = [
  join('apps', 'kasir', 'src'),
  join('apps', 'server', 'src'),
  join('packages', 'domain', 'src'),
  join('packages', 'sync-client', 'src'),
];

function berkasSumber(dir) {
  const hasil = [];
  const akar = join(AKAR, dir);
  const telusuri = (d) => {
    for (const nama of readdirSync(d)) {
      const p = join(d, nama);
      if (statSync(p).isDirectory()) {
        if (nama === 'node_modules' || nama === 'dist') continue;
        telusuri(p);
        continue;
      }
      if (/\.tsx?$/.test(nama)) hasil.push(p);
    }
  };
  telusuri(akar);
  return hasil;
}

/** Isi berkas tanpa komentar — komentar menjelaskan aturan, bukan menerapkannya. */
function tanpaKomentar(isi) {
  return isi
    .replace(/\r\n?/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

test('penjaga benar-benar memindai berkas — bukan hijau karena kosong', () => {
  const semua = DIPINDAI.flatMap(berkasSumber);
  assert.ok(semua.length > 50, `hanya ${semua.length} berkas terpindai; pemindai kemungkinan rusak`);
  assert.ok(
    semua.some((f) => f.endsWith(SUMBER_TUNGGAL.split(sep).pop())),
    'sumber tunggalnya sendiri tidak ikut terpindai'
  );
});

test('⛔ hanya SATU tempat yang mengagregasi nilai order (AC FR-G3 pertama)', () => {
  // `SUM(o.total)`, `SUM(order.total)`, `SUM(total)` — bentuk apa pun.
  // Laporan berikutnya yang menulis agregasinya sendiri adalah laporan yang
  // akan berbeda angkanya dari laporan shift, dan `spec-g:29` menyebut
  // akibatnya: kepercayaan merchant hilang lebih cepat daripada karena fitur
  // yang tidak ada.
  // ⛔ Yang dicari adalah agregasi atas tabel `order` — omzet. BUKAN setiap
  // `SUM(...)`.
  //
  // Versi pertama penjaga ini menandai `SUM(amount)` apa pun, dan ia menemukan
  // tiga tempat yang semuanya SAH: sisa yang dapat direfund
  // (`SUM(amount) FROM refund WHERE order_id = $1`) dan sisa tagihan
  // (`SUM(amount) FROM payment WHERE order_id = ...`). Keduanya agregasi
  // PER-ORDER untuk penegakan aturan, bukan angka laporan. Penjaga yang
  // menandai kode benar akan dilonggarkan oleh orang berikutnya, dan saat itu
  // ia berhenti menjaga apa pun.
  const pelanggar = [];
  for (const f of DIPINDAI.flatMap(berkasSumber)) {
    const rel = relative(AKAR, f);
    if (rel === SUMBER_TUNGGAL) continue;
    const isi = tanpaKomentar(readFileSync(f, 'utf8'));
    for (const m of isi.matchAll(/SUM\s*\(/gi)) {
      // Jendela setelah `SUM(` — cukup untuk memuat `FROM "order"` pada
      // pernyataan yang sama, tidak cukup untuk menjangkau query berikutnya.
      const jendela = isi.slice(m.index, m.index + 220);
      if (/FROM\s+"order"/i.test(jendela)) {
        pelanggar.push(rel);
        break;
      }
    }
  }
  assert.deepEqual(
    pelanggar,
    [],
    'agregasi nilai order di luar posisi-penjualan.ts — panggil posisiPenjualan() alih-alih ' +
      'menjumlahkan sendiri'
  );
});

test('⛔ `status = voided` tidak muncul di berkas LAPORAN', () => {
  // Pola asli ACnya, dipersempit ke tempat ia benar-benar berbahaya. Di jalur
  // penulisan (`pembatalan.ts`, `cancel.ts`) ia sah — di sanalah baris
  // pembatal lahir. Di laporan, ia berarti laporan itu memutuskan sendiri apa
  // yang dianggap batal.
  const pola = /status\s*(?:=|===|==)\s*'voided'/i;
  const pelanggar = [];
  for (const f of DIPINDAI.flatMap(berkasSumber)) {
    const rel = relative(AKAR, f);
    if (!/laporan|report|kas[\\/]tutup/i.test(rel)) continue;
    if (pola.test(tanpaKomentar(readFileSync(f, 'utf8')))) pelanggar.push(rel);
  }
  assert.deepEqual(pelanggar, [], 'laporan memutuskan sendiri apa yang dianggap batal');
});
