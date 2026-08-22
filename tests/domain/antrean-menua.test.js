'use strict';

// FR-H8 — antrean yang menua. `spec-h:304`: "uang merchant belum tercatat —
// metrik kesehatan #1."
//
// ⛔ Seluruh test di sini menyuntikkan `sekarang`. Ambang 72 jam yang hanya
// dapat diuji dengan menunggu tiga hari adalah ambang yang tidak pernah
// diuji — dan tangga peringatan yang tidak pernah diuji adalah tangga yang
// diam pada hari ia paling dibutuhkan.

const { test } = require('node:test');
const assert = require('node:assert/strict');

async function modul() {
  return await import('../../packages/domain/src/antrean-menua.ts');
}

const T0 = Date.parse('2026-08-21T12:00:00.000Z');
const jamLalu = (n) => new Date(T0 - n * 3_600_000).toISOString();

test('antrean kosong: aman, tanpa pesan', async () => {
  const { umurAntreanJam, tingkatAntrean, pesanAntreanMenua } = await modul();
  assert.equal(umurAntreanJam(null, T0), null);
  assert.equal(tingkatAntrean(null), 'aman');
  assert.equal(pesanAntreanMenua('aman', null), null);
});

test('tanggal cacat dibaca seperti antrean kosong, bukan NaN', async () => {
  const { umurAntreanJam } = await modul();
  assert.equal(umurAntreanJam('bukan tanggal', T0), null);
  assert.equal(umurAntreanJam('', T0), null);
  assert.equal(umurAntreanJam(undefined, T0), null);
});

test('⛔ jam perangkat yang MUNDUR tidak membuat antrean tua terbaca aman', async () => {
  // `spec-h:351`: jam perangkat dapat mundur. Umur negatif yang lolos ke
  // perbandingan membaca "aman" untuk antrean yang bisa saja berumur tiga
  // hari — dan itu tepat kebalikan dari yang fitur ini ada untuk mencegah.
  const { umurAntreanJam, tingkatAntrean } = await modul();
  const masaDepan = new Date(T0 + 5 * 3_600_000).toISOString();
  assert.equal(umurAntreanJam(masaDepan, T0), 0);
  assert.equal(tingkatAntrean(umurAntreanJam(masaDepan, T0)), 'aman');
});

test('tangga 4 / 24 / 72 jam persis seperti spec-h:308', async () => {
  const { umurAntreanJam, tingkatAntrean } = await modul();
  const pada = (n) => tingkatAntrean(umurAntreanJam(jamLalu(n), T0));

  assert.equal(pada(0), 'aman');
  assert.equal(pada(3.9), 'aman');
  assert.equal(pada(4), 'peringatan', 'batasnya inklusif — memperingatkan lebih dulu');
  assert.equal(pada(23.9), 'peringatan');
  assert.equal(pada(24), 'kritis');
  assert.equal(pada(71.9), 'kritis');
  assert.equal(pada(72), 'darurat');
  assert.equal(pada(240), 'darurat');
});

test('⛔ setiap pesan membawa ANGKA umurnya', async () => {
  // Pola `spec-e:152`. "Antrean menua" tanpa angka tidak dapat dipakai
  // memutuskan apa pun.
  const { umurAntreanJam, tingkatAntrean, pesanAntreanMenua } = await modul();
  const pesan = (n) => {
    const u = umurAntreanJam(jamLalu(n), T0);
    return pesanAntreanMenua(tingkatAntrean(u), u);
  };

  assert.match(pesan(5), /5 jam/);
  assert.match(pesan(30), /1 hari/);
  assert.match(pesan(100), /4 hari/);
  assert.equal(pesan(1), null, 'yang aman tidak menghasilkan pesan sama sekali');
});

test('⛔ pesan tidak pernah menyuruh berhenti berjualan', async () => {
  // `research/09:213` melarang menghentikan penjualan, dan kalimat yang
  // berbunyi seperti larangan akan dipatuhi seperti larangan.
  const { pesanAntreanMenua } = await modul();
  for (const tingkat of ['peringatan', 'kritis', 'darurat']) {
    const p = pesanAntreanMenua(tingkat, 30);
    assert.doesNotMatch(p, /jangan|berhenti|hentikan|tidak dapat menjual/i, `${tingkat}: ${p}`);
  }
});

test('tiap tingkat menyebut tindakan yang BERBEDA', async () => {
  const { pesanAntreanMenua } = await modul();
  const p = ['peringatan', 'kritis', 'darurat'].map((t) => pesanAntreanMenua(t, 100));
  assert.equal(new Set(p).size, 3, 'tiga tingkat dengan kalimat identik adalah satu tingkat');
  assert.match(p[1], /[Pp]emilik/, 'kritis: notifikasi ke owner (spec-h:311)');
  assert.match(p[2], /[Dd]ukungan/, 'darurat: kontak support (spec-h:312)');
});

// ---------------------------------------------------------------------------
// AC FR-H8 pertama — ambang dapat dikonfigurasi
// ---------------------------------------------------------------------------

test('ambang dibaca dari konfigurasi', async () => {
  const { bacaAmbangAntrean } = await modul();
  assert.deepEqual(bacaAmbangAntrean('1,2,3'), {
    peringatanJam: 1,
    kritisJam: 2,
    daruratJam: 3,
  });
  assert.deepEqual(bacaAmbangAntrean(' 2 , 8 , 48 '), {
    peringatanJam: 2,
    kritisJam: 8,
    daruratJam: 48,
  });
});

test('⛔ konfigurasi cacat jatuh ke bawaan SECARA UTUH, bukan sebagian', async () => {
  const { bacaAmbangAntrean, AMBANG_ANTREAN } = await modul();

  for (const cacat of [
    undefined,
    null,
    '',
    '4',
    '4,24',
    '4,24,72,96',
    'a,b,c',
    '4,x,72',
    '0,24,72',
    '-4,24,72',
    // ⛔ Yang ini yang paling berbahaya: tiga angka sah yang TIDAK menaik.
    // Diterima apa adanya, setiap antrean langsung berstatus `darurat` —
    // dan peringatan yang selalu menyala adalah peringatan yang diabaikan.
    '72,24,4',
    '4,4,72',
  ]) {
    assert.deepEqual(bacaAmbangAntrean(cacat), AMBANG_ANTREAN, `cacat: ${JSON.stringify(cacat)}`);
  }
});

test('ambang khusus benar-benar dipakai tingkatAntrean', async () => {
  // Konfigurasi yang dibaca tapi tidak dioper adalah konfigurasi yang tidak
  // ada — dan itu lolos setiap test yang hanya menguji pembacanya.
  const { bacaAmbangAntrean, tingkatAntrean } = await modul();
  const ambang = bacaAmbangAntrean('1,2,3');

  assert.equal(tingkatAntrean(0.5, ambang), 'aman');
  assert.equal(tingkatAntrean(1, ambang), 'peringatan');
  assert.equal(tingkatAntrean(2, ambang), 'kritis');
  assert.equal(tingkatAntrean(3, ambang), 'darurat');

  // …dan bawaan tetap bawaan pada umur yang sama.
  assert.equal(tingkatAntrean(3), 'aman');
});
