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

/**
 * Apakah isi ini mengagregasi tabel `order`?
 *
 * ⛔ Yang diperiksa: tabel yang di-`FROM` oleh `SUM(...)` ITU SENDIRI, yaitu
 * `FROM` PERTAMA setelahnya. Bukan "apakah `FROM "order"` muncul di dekatnya".
 *
 * Versi sebelumnya memeriksa yang kedua, dan itu salah untuk pola yang justru
 * sah dan umum: agregasi tabel LAIN yang di-nest di dalam query atas `order`.
 *
 * ```sql
 * SELECT o.id,
 *        (SELECT SUM(r.amount) FROM refund r WHERE r.order_id = o.id)
 *   FROM "order" o
 * ```
 *
 * `SUM` di sana menjumlahkan `refund`, bukan `order` — persis kasus yang
 * catatan penjaga ini sendiri sebut SAH ("sisa yang dapat direfund"). Yang
 * membuatnya tertangkap hanya jaraknya ke `FROM "order"` milik query LUAR.
 *
 * Perubahannya membuat penjaga LEBIH SEMPIT, bukan lebih longgar: setiap yang
 * ditandai aturan baru pasti juga ditandai aturan lama. Jendela 220 karakter
 * dipertahankan — `FROM` yang lebih jauh dari itu milik pernyataan lain.
 *
 * ⛔ Jalan yang TIDAK diambil: menyusun ulang query supaya lolos jendela, dan
 * menambah daftar pengecualian. Yang pertama membuat kebenaran bergantung pada
 * jumlah karakter — orang berikutnya yang merapikan query akan memicunya lagi
 * tanpa tahu kenapa. Yang kedua adalah awal dari daftar yang bertambah panjang
 * sampai penjaganya tidak menjaga apa pun.
 */
function mengagregasiOrder(isi) {
  for (const m of isi.matchAll(/SUM\s*\(/gi)) {
    const jendela = isi.slice(m.index, m.index + 220);
    const from = /\bFROM\s+("order"|[A-Za-z_][\w.]*)/i.exec(jendela);
    if (from !== null && from[1].toLowerCase() === '"order"') return true;
  }
  return false;
}

test('⛔ penjaga menandai agregasi order, dan TIDAK menandai agregasi tabel lain', () => {
  // ⛔ Perilaku penjaganya sendiri diuji, bukan hanya disimpulkan dari isi repo
  // saat ini. Penjaga yang dipersempit tanpa bukti bahwa ia masih menangkap
  // hal yang dicarinya adalah penjaga yang baru saja dimatikan diam-diam.
  const HARUS_DITANDAI = [
    `SELECT SUM(total) FROM "order" WHERE business_date = $1`,
    `SELECT SUM(o.total) FROM "order" o JOIN refund r ON r.order_id = o.id`,
    `SELECT SUM( o.total ) AS omzet\n  FROM "order" o`,
    // Agregasi order yang di-nest di dalam query atas tabel lain tetap
    // tertangkap — arahnya tidak menolong pelanggarnya.
    `SELECT r.id, (SELECT SUM(o.total) FROM "order" o) FROM refund r`,
  ];
  const HARUS_LOLOS = [
    // Pola yang memicu kegagalan CI PR #34.
    `SELECT o.id, COALESCE((SELECT SUM(r.amount) FROM refund r WHERE r.order_id = o.id), 0)\n  FROM "order" o WHERE o.business_date BETWEEN $1 AND $2`,
    `SELECT SUM(amount) FROM payment WHERE order_id = $1`,
    `SELECT SUM(ol.quantity) FROM order_line ol JOIN "order" o ON o.id = ol.order_id`,
  ];

  for (const s of HARUS_DITANDAI) {
    assert.equal(mengagregasiOrder(s), true, `agregasi order LOLOS penjaga:\n${s}`);
  }
  for (const s of HARUS_LOLOS) {
    assert.equal(mengagregasiOrder(s), false, `agregasi tabel lain ditandai keliru:\n${s}`);
  }
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
    if (mengagregasiOrder(tanpaKomentar(readFileSync(f, 'utf8')))) pelanggar.push(rel);
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
