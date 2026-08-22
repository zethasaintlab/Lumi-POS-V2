'use strict';

// Aturan rilis — `ARCH:§12`, KEP-36.
//
// ⛔ Tiga sifat di sini bukan soal kerapian melainkan soal KERUSAKAN yang
// tidak menghasilkan error:
//
//   1. kohort harus SUBSET — merchant yang naik versi lalu turun lagi
//      menghadapi rollback skema lokal, yang KEP-36 sebut "hampir mustahil";
//   2. jendela yang melewati tengah malam harus bekerja — perbandingan naif
//      menjawab "tidak pernah", dan update yang tidak pernah terpasang
//      terlihat persis seperti tidak ada rilis;
//   3. gate crash rate harus MENAHAN saat datanya belum ada — gate yang
//      meloloskan ketidaktahuan hanya menyala pada rilis yang sudah tidak
//      membutuhkannya.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MOD = '../../packages/domain/src/rilis.ts';

// ---------------------------------------------------------------------------
// Kohort
// ---------------------------------------------------------------------------

test('kohort selalu 0..99 dan stabil untuk masukan yang sama', async () => {
  const { kohort } = await import(MOD);
  for (let i = 0; i < 500; i += 1) {
    const k = kohort(`tenant-${i}`, '1.2.0');
    assert.ok(Number.isInteger(k) && k >= 0 && k < 100, `kohort di luar batas: ${k}`);
    assert.equal(k, kohort(`tenant-${i}`, '1.2.0'), 'kohort tidak stabil');
  }
});

test('⛔ property: kohort SUBSET — 5% ⊂ 25% ⊂ 100%', async () => {
  const { termasukTahap } = await import(MOD);
  // Merchant yang sudah naik ke versi baru pada tahap 5% TIDAK BOLEH keluar
  // dari cakupan saat tahap naik ke 25%. Kalau bisa, ia harus turun versi —
  // dan rollback skema lokal "hampir mustahil" setelah data ditulis dengan
  // skema baru (KEP-36).
  for (let i = 0; i < 2000; i += 1) {
    const t = `tenant-${i}`;
    const lima = termasukTahap(t, '1.2.0', 'lima', false);
    const duapuluhlima = termasukTahap(t, '1.2.0', 'duapuluhlima', false);
    const penuh = termasukTahap(t, '1.2.0', 'penuh', false);
    if (lima) assert.ok(duapuluhlima, `${t} keluar dari cakupan saat 5% → 25%`);
    if (duapuluhlima) assert.ok(penuh, `${t} keluar dari cakupan saat 25% → 100%`);
    assert.ok(penuh, 'tahap penuh harus mencakup semua');
  }
});

test('⛔ kohort DI-GARAM per versi — kelinci percobaan berpindah', async () => {
  const { kohort } = await import(MOD);
  // Tanpa garam, merchant yang kebetulan berkohort rendah menjadi yang
  // pertama menerima SETIAP rilis, selamanya. Risikonya harus berpindah.
  let berbeda = 0;
  for (let i = 0; i < 500; i += 1) {
    if (kohort(`tenant-${i}`, '1.2.0') !== kohort(`tenant-${i}`, '1.3.0')) berbeda += 1;
  }
  assert.ok(berbeda > 400, `hanya ${berbeda}/500 tenant berpindah kohort antar versi`);
});

test('sebaran kohort mendekati persentase yang dijanjikan', async () => {
  const { termasukTahap } = await import(MOD);
  // Kalau "5%" ternyata 0,3% atau 30%, tahapnya tidak menguji apa yang
  // dikiranya diuji.
  const n = 5000;
  let lima = 0;
  for (let i = 0; i < n; i += 1) {
    if (termasukTahap(`tenant-${i}`, '2.0.0', 'lima', false)) lima += 1;
  }
  const persen = (lima / n) * 100;
  assert.ok(persen > 3.5 && persen < 6.5, `5% ternyata ${persen.toFixed(2)}%`);
});

test('⛔ kanari menerima SETIAP tahap, termasuk yang paling awal', async () => {
  const { termasukTahap, CAKUPAN_TAHAP } = await import(MOD);
  // Kanari yang baru menerima versi pada tahap 25% tidak menguji apa pun —
  // ia hanya merchant biasa dengan label.
  assert.equal(CAKUPAN_TAHAP.kanari, 0, 'kanari bukan irisan acak');
  for (const tahap of ['kanari', 'lima', 'duapuluhlima', 'penuh']) {
    assert.equal(termasukTahap('tenant-apa-pun', '1.0.0', tahap, true), true, tahap);
  }
});

test('⛔ tahap kanari TIDAK menyentuh merchant yang tidak memilihnya', async () => {
  const { termasukTahap } = await import(MOD);
  for (let i = 0; i < 1000; i += 1) {
    assert.equal(termasukTahap(`tenant-${i}`, '1.0.0', 'kanari', false), false);
  }
});

// ---------------------------------------------------------------------------
// Jendela update
// ---------------------------------------------------------------------------

test('jendela bawaan 03:00–06:00', async () => {
  const { dalamJendela } = await import(MOD);
  assert.equal(dalamJendela(3), true);
  assert.equal(dalamJendela(5), true);
  assert.equal(dalamJendela(6), false, 'batas atas eksklusif');
  assert.equal(dalamJendela(2), false);
  assert.equal(dalamJendela(13), false, 'jam makan siang tidak pernah boleh');
});

test('⛔ jendela yang MELEWATI TENGAH MALAM bekerja', async () => {
  const { dalamJendela } = await import(MOD);
  // Outlet 24 jam yang tutup 02:00 memilih 23:00–02:00. Perbandingan naif
  // (`mulai <= jam && jam < selesai`) menjawab "tidak pernah" untuknya, dan
  // update yang tidak pernah terpasang terlihat persis seperti tidak ada
  // rilis sama sekali.
  const j = { mulaiJam: 23, selesaiJam: 2 };
  assert.equal(dalamJendela(23, j), true);
  assert.equal(dalamJendela(0, j), true);
  assert.equal(dalamJendela(1, j), true);
  assert.equal(dalamJendela(2, j), false, 'batas atas eksklusif');
  assert.equal(dalamJendela(22, j), false);
  assert.equal(dalamJendela(12, j), false);
});

test('jam di luar 0..23 dan jendela kosong ditolak', async () => {
  const { dalamJendela, jendelaSah } = await import(MOD);
  for (const jam of [-1, 24, 3.5, NaN]) assert.equal(dalamJendela(jam), false, String(jam));
  // `mulai === selesai` adalah jendela KOSONG, bukan jendela penuh 24 jam.
  // Menafsirkannya sebagai penuh berarti salah ketik konfigurasi mengizinkan
  // update di jam makan siang.
  assert.equal(dalamJendela(4, { mulaiJam: 3, selesaiJam: 3 }), false);
  assert.equal(jendelaSah({ mulaiJam: 3, selesaiJam: 3 }), false);
  assert.equal(jendelaSah({ mulaiJam: 23, selesaiJam: 2 }), true);
  assert.equal(jendelaSah({ mulaiJam: -1, selesaiJam: 5 }), false);
});

// ---------------------------------------------------------------------------
// Keputusan update
// ---------------------------------------------------------------------------

const CTX = {
  versiPerangkat: '1.0.0',
  tenantId: 'tenant-1',
  isKanari: true, // supaya tahap tidak menjadi variabel yang mengganggu
  jamLokal: 4,
  sudahTunda: 0,
};

const RILIS = { versi: '1.1.0', tahap: 'lima', wajibSegera: null };

test('tanpa rilis: tidak ada yang harus dilakukan', async () => {
  const { putuskanUpdate } = await import(MOD);
  const k = putuskanUpdate(null, CTX);
  assert.deepEqual(k, {
    versi: null,
    pasangSekarang: false,
    bolehTunda: false,
    alasan: 'tidak_ada_rilis',
  });
});

test('perangkat yang sudah di versi rilis tidak memasang apa pun', async () => {
  const { putuskanUpdate } = await import(MOD);
  const k = putuskanUpdate(RILIS, { ...CTX, versiPerangkat: '1.1.0' });
  assert.equal(k.pasangSekarang, false);
  assert.equal(k.alasan, 'sudah_terbaru');
});

test('di dalam jendela dan sudah giliran: pasang', async () => {
  const { putuskanUpdate } = await import(MOD);
  const k = putuskanUpdate(RILIS, CTX);
  assert.equal(k.pasangSekarang, true);
  assert.equal(k.versi, '1.1.0');
  assert.equal(k.alasan, 'terjadwal');
});

test('⛔ di luar jendela: TIDAK dipasang, tapi masih boleh ditunda', async () => {
  const { putuskanUpdate } = await import(MOD);
  // 13:00 — jam makan siang. Ini seluruh alasan jendela ada.
  const k = putuskanUpdate(RILIS, { ...CTX, jamLokal: 13 });
  assert.equal(k.pasangSekarang, false);
  assert.equal(k.alasan, 'di_luar_jendela');
  // "Nanti saja" adalah jawaban atas PEMBERITAHUAN, bukan atas pemasangan.
  // Menyembunyikannya sampai 03:00 berarti merchant hanya dapat menunda saat
  // ia sedang tidur.
  assert.equal(k.bolehTunda, true);
});

test('⛔ merchant yang BELUM GILIRAN tidak memasang apa pun — termasuk yang wajib segera', async () => {
  const { putuskanUpdate, kohort } = await import(MOD);
  // Cari tenant yang pasti di luar cakupan 5%.
  let luar = null;
  for (let i = 0; i < 500 && luar === null; i += 1) {
    if (kohort(`t-${i}`, '1.1.0') >= 5) luar = `t-${i}`;
  }
  assert.ok(luar, 'tidak menemukan tenant di luar cakupan — prasyarat test gagal');

  const ctx = { ...CTX, tenantId: luar, isKanari: false };
  assert.equal(putuskanUpdate(RILIS, ctx).alasan, 'belum_giliran');
  // Yang menaikkan tahap adalah orang, bukan tingkat kegentingan rilis.
  const mendesak = { ...RILIS, wajibSegera: 'keamanan' };
  const k = putuskanUpdate(mendesak, ctx);
  assert.equal(k.pasangSekarang, false);
  assert.equal(k.alasan, 'belum_giliran');
});

test('⛔ wajib segera menembus jendela DAN penundaan', async () => {
  const { putuskanUpdate } = await import(MOD);
  // Kategorinya tertutup: yang lolos ke sana hanya kehilangan data dan lubang
  // keamanan, dan menunggu 03:00 untuk keduanya berarti membiarkan kerusakan
  // berjalan semalaman.
  const k = putuskanUpdate(
    { ...RILIS, wajibSegera: 'kehilangan_data' },
    { ...CTX, jamLokal: 13, sudahTunda: 0 }
  );
  assert.equal(k.pasangSekarang, true);
  assert.equal(k.bolehTunda, false);
  assert.equal(k.alasan, 'wajib_segera');
});

test('penundaan habis setelah MAKS_TUNDA', async () => {
  const { putuskanUpdate, MAKS_TUNDA } = await import(MOD);
  assert.equal(MAKS_TUNDA, 2);
  assert.equal(putuskanUpdate(RILIS, { ...CTX, sudahTunda: 1 }).bolehTunda, true);
  const habis = putuskanUpdate(RILIS, { ...CTX, sudahTunda: MAKS_TUNDA });
  assert.equal(habis.bolehTunda, false);
  // ⛔ Penundaan yang habis TIDAK membuat update batal — ia membuatnya wajib
  // pada jendela berikutnya. `pasangSekarang` tetap benar.
  assert.equal(habis.pasangSekarang, true);
});

test('⛔ daftar alasan wajib segera TERTUTUP', async () => {
  const { adalahAlasanWajibSegera, ALASAN_WAJIB_SEGERA } = await import(MOD);
  // `ARCH:356`: "Hanya keamanan atau bug kehilangan data; kategori ini
  // didefinisikan tertulis dan harus jarang." Daftar tertutup ADALAH definisi
  // tertulisnya — tanpa itu setiap rilis menemukan alasan untuk mendesak, dan
  // jendela update berhenti berarti apa pun.
  assert.deepEqual([...ALASAN_WAJIB_SEGERA], ['keamanan', 'kehilangan_data']);
  for (const v of ['fitur_baru', 'perbaikan_penting', 'permintaan_merchant', '', null, 1]) {
    assert.equal(adalahAlasanWajibSegera(v), false, String(v));
  }
});

// ---------------------------------------------------------------------------
// Gate kenaikan tahap
// ---------------------------------------------------------------------------

const GATE_BAIK = { jamDiTahap: 25, crashKandidat: 2, crashBaseline: 3 };

test('jeda < 24 jam menahan', async () => {
  const { bolehNaikTahap, JEDA_TAHAP_JAM } = await import(MOD);
  assert.equal(JEDA_TAHAP_JAM, 24);
  assert.deepEqual(bolehNaikTahap('lima', { ...GATE_BAIK, jamDiTahap: 23.9 }), {
    boleh: false,
    sebab: 'jeda_belum_cukup',
  });
  assert.deepEqual(bolehNaikTahap('lima', GATE_BAIK), { boleh: true });
});

test('⛔ crash rate NAIK sedikit pun menahan', async () => {
  const { bolehNaikTahap } = await import(MOD);
  // `ARCH:304` menulis ambangnya `> baseline versi sebelumnya`. Toleransi di
  // sini adalah angka yang harus dipilih seseorang, dan tidak ada di dokumen
  // mana pun — jadi ia tidak dikarang di kode.
  assert.deepEqual(bolehNaikTahap('lima', { ...GATE_BAIK, crashKandidat: 3.01, crashBaseline: 3 }), {
    boleh: false,
    sebab: 'crash_naik',
  });
  assert.deepEqual(bolehNaikTahap('lima', { ...GATE_BAIK, crashKandidat: 3, crashBaseline: 3 }), {
    boleh: true,
  });
});

test('⛔ crash rate yang BELUM TERUKUR menahan, tidak meloloskan', async () => {
  const { bolehNaikTahap } = await import(MOD);
  // Gate yang meloloskan ketidaktahuan hanya menyala pada rilis yang sudah
  // cukup lama berjalan untuk tidak membutuhkannya.
  assert.deepEqual(bolehNaikTahap('lima', { ...GATE_BAIK, crashKandidat: null }), {
    boleh: false,
    sebab: 'belum_terukur',
  });
  assert.deepEqual(bolehNaikTahap('lima', { ...GATE_BAIK, crashBaseline: null }), {
    boleh: false,
    sebab: 'belum_terukur',
  });
});

test('tahap penuh tidak punya tahap berikutnya', async () => {
  const { bolehNaikTahap, tahapBerikutnya } = await import(MOD);
  assert.equal(tahapBerikutnya('kanari'), 'lima');
  assert.equal(tahapBerikutnya('lima'), 'duapuluhlima');
  assert.equal(tahapBerikutnya('duapuluhlima'), 'penuh');
  assert.equal(tahapBerikutnya('penuh'), null);
  assert.deepEqual(bolehNaikTahap('penuh', GATE_BAIK), { boleh: false, sebab: 'sudah_penuh' });
});

// ---------------------------------------------------------------------------
// Kosakata: dua salinan daftar tertutup, dan keduanya harus sama
// ---------------------------------------------------------------------------

function migrasi() {
  return fs.readFileSync(
    path.join(__dirname, '..', '..', 'db', 'migrations', '0030_app_release.sql'),
    'utf8'
  );
}

test('⛔ CHECK `app_release.stage` SAMA PERSIS dengan TAHAP_ROLLOUT', async () => {
  const { TAHAP_ROLLOUT } = await import(MOD);
  const m = /stage\s+text NOT NULL DEFAULT '[a-z]+'\s*\n?\s*CHECK \(stage IN \(([^)]*)\)\)/.exec(migrasi());
  assert.ok(m, 'CHECK `stage` tidak terbaca di migrasi — parsernya usang?');
  const diMigrasi = [...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]);
  // Tahap yang ada di satu sisi saja: server menolak nilai yang domain
  // anggap sah, atau domain memutuskan cakupan untuk tahap yang tidak dapat
  // disimpan. Keduanya baru terlihat saat seseorang menaikkan tahap.
  assert.deepEqual([...diMigrasi].sort(), [...TAHAP_ROLLOUT].sort());
});

test('⛔ CHECK `app_release.mandatory_reason` SAMA PERSIS dengan ALASAN_WAJIB_SEGERA', async () => {
  const { ALASAN_WAJIB_SEGERA } = await import(MOD);
  const m = /mandatory_reason\s+text CHECK \(mandatory_reason IN \(([^)]*)\)\)/.exec(migrasi());
  assert.ok(m, 'CHECK `mandatory_reason` tidak terbaca di migrasi');
  const diMigrasi = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  assert.deepEqual([...diMigrasi].sort(), [...ALASAN_WAJIB_SEGERA].sort());
});
