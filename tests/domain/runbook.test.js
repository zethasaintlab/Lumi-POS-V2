'use strict';

// ⛔ PENJAGA: `docs/RUNBOOK.md` tidak boleh menyimpang dari kode.
//
// Runbook yang salah LEBIH BERBAHAYA daripada runbook yang tidak ada, karena
// orang yang sedang panik akan memercayainya. Yang paling mudah menyimpang
// adalah nama: kode error yang diganti, environment variable yang dinamai
// ulang, endpoint yang dipindah. Semuanya perubahan yang wajar, dan semuanya
// meninggalkan runbook yang menyuruh operator mencari sesuatu yang tidak ada.
//
// Penjaga ini statis dan hidup di `tests/domain` — pola yang sama dengan
// `kuota-tidak-di-jalur-kasir.test.js`: ia memeriksa BENTUK repo, bukan
// perilaku, dan ia harus berjalan cepat di setiap CI tanpa database.
//
// Yang TIDAK dijaganya: apakah prosedurnya benar. Itu hanya dapat dibuktikan
// dengan menjalankannya saat insiden, dan tidak ada test yang dapat
// menggantikannya.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readdirSync, readFileSync, statSync } = require('node:fs');
const { join } = require('node:path');

const AKAR = join(__dirname, '..', '..');
const RUNBOOK = readFileSync(join(AKAR, 'docs', 'RUNBOOK.md'), 'utf8');

function berkas(dir, akhiran) {
  const hasil = [];
  for (const nama of readdirSync(dir)) {
    if (nama === 'node_modules' || nama === 'dist' || nama === '.git') continue;
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) hasil.push(...berkas(p, akhiran));
    else if (akhiran.some((a) => nama.endsWith(a))) hasil.push(p);
  }
  return hasil;
}

const SUMBER = [
  ...berkas(join(AKAR, 'apps', 'server', 'src'), ['.ts']),
  ...berkas(join(AKAR, 'apps', 'kasir', 'src'), ['.ts', '.tsx']),
  ...berkas(join(AKAR, 'apps', 'backoffice', 'src'), ['.ts', '.tsx']),
  ...berkas(join(AKAR, 'packages'), ['.ts', '.yaml']),
].map((p) => ({ p, isi: readFileSync(p, 'utf8') }));

const SEMUA_SUMBER = SUMBER.map((s) => s.isi).join('\n');

/** Kode error yang runbook janjikan akan dilihat operator. */
const KODE_ERROR = [
  'WEBHOOK_NOT_CONFIGURED',
  'INVALID_SIGNATURE',
  'MISSING_TENANT_REFERENCE',
  'PAYMENT_NOT_FOUND',
  'SUBSCRIPTION_INVOICE_NOT_FOUND',
  'SYNC_TOKEN_NOT_CONFIGURED',
  'SESSION_INVALID',
  'PLAN_NOT_AN_UPGRADE',
  'IDEMPOTENCY_KEY_REUSED',
];

test('⛔ setiap kode error yang runbook sebut BENAR-BENAR ada di kode', () => {
  const hilang = [];
  for (const kode of KODE_ERROR) {
    if (!RUNBOOK.includes(kode)) {
      hilang.push(`${kode}: disebut daftar test ini tapi TIDAK ada di runbook`);
      continue;
    }
    if (!SEMUA_SUMBER.includes(kode)) {
      hilang.push(`${kode}: ada di runbook tapi TIDAK ada di kode`);
    }
  }
  assert.deepEqual(hilang, [], hilang.join('\n  '));
});

/** Environment variable yang runbook suruh operator periksa. */
const ENV = [
  'MIDTRANS_SERVER_KEY',
  'POWERSYNC_JWT_PRIVATE_KEY',
  'CORS_ORIGINS',
  'PAYMENT_PROVIDER',
  'TENANT_REGISTRATION_RATE_MAX',
  'VITE_AMBANG_ANTREAN_JAM',
];

test('⛔ setiap environment variable yang runbook sebut ada di kode', () => {
  const hilang = [];
  for (const nama of ENV) {
    if (!RUNBOOK.includes(nama)) hilang.push(`${nama}: tidak disebut runbook`);
    else if (!SEMUA_SUMBER.includes(nama)) hilang.push(`${nama}: ada di runbook tapi tidak di kode`);
  }
  assert.deepEqual(hilang, [], hilang.join('\n  '));
});

/** Endpoint yang runbook suruh operator panggil atau kenali. */
const ENDPOINT = [
  '/orders/cleanup-abandoned',
  '/inventory/movements',
  '/webhooks/midtrans',
  '/health',
];

test('⛔ setiap endpoint yang runbook sebut terdaftar di OpenAPI', () => {
  const spec = readFileSync(join(AKAR, 'packages', 'contracts', 'openapi.yaml'), 'utf8');
  const hilang = [];
  for (const jalur of ENDPOINT) {
    if (!RUNBOOK.includes(jalur)) hilang.push(`${jalur}: tidak disebut runbook`);
    else if (!spec.includes(`  ${jalur}:`)) hilang.push(`${jalur}: ada di runbook tapi tidak di openapi.yaml`);
  }
  assert.deepEqual(hilang, [], hilang.join('\n  '));
});

test('⛔ setiap alat yang runbook suruh JALANKAN benar-benar ada di repo', () => {
  // Runbook §10 mendaftar alat koreksi, dan operator yang sedang menangani
  // insiden akan mengetik perintahnya apa adanya. Alat yang dipindah atau
  // dinamai ulang meninggalkan perintah yang menjawab "Cannot find module" —
  // tepat pada saat yang paling buruk untuk mencari tahu di mana berkasnya.
  const disebut = [...RUNBOOK.matchAll(/\btools\/[\w.-]+\.mjs\b/g)].map((m) => m[0]);
  assert.ok(disebut.length > 0, 'runbook harus menyebut setidaknya satu alat koreksi yang dapat dijalankan');

  const hilang = disebut.filter((jalur) => {
    try {
      statSync(join(AKAR, jalur));
      return false;
    } catch {
      return true;
    }
  });
  assert.deepEqual(hilang, [], `alat yang runbook sebut tidak ada:\n  ${hilang.join('\n  ')}`);
});

test('⛔ angka ambang yang runbook sebut sama dengan yang kode tegakkan', async () => {
  // Angka yang disalin ke dokumen akan menyimpang pada perubahan berikutnya,
  // dan operator yang membaca "Rp 20.000" lalu melihat sistem menolak
  // Rp 15.000 akan menyimpulkan sistemnya rusak.
  const { AMBANG_SELISIH } = await import('../../packages/domain/src/buku-kas.ts');
  const { AMBANG_ANTREAN } = await import('../../packages/domain/src/antrean-menua.ts');
  const { MAKS_PERCOBAAN_CETAK } = await import('../../apps/kasir/src/cetak/antrean.ts');

  assert.equal(AMBANG_SELISIH, 20000);
  assert.ok(
    RUNBOOK.includes('Rp 20.000'),
    'runbook harus menyebut ambang otorisasi selisih kas yang sama dengan AMBANG_SELISIH'
  );

  const tangga = `${AMBANG_ANTREAN.peringatanJam} / ${AMBANG_ANTREAN.kritisJam} / ${AMBANG_ANTREAN.daruratJam} jam`;
  assert.ok(RUNBOOK.includes(tangga), `runbook harus menyebut tangga "${tangga}"`);

  assert.ok(
    RUNBOOK.includes(`**${MAKS_PERCOBAAN_CETAK} percobaan**`),
    `runbook harus menyebut MAKS_PERCOBAAN_CETAK (${MAKS_PERCOBAAN_CETAK})`
  );

  // F6 — rilis bertahap. Ketiganya angka yang merchant DENGAR dari support
  // ("update dipasang jam 3 pagi", "bisa ditunda dua kali"), jadi dokumen dan
  // kode yang menyimpang di sini menghasilkan janji yang tidak dipenuhi.
  const { JEDA_TAHAP_JAM, MAKS_TUNDA, JENDELA_BAWAAN } = await import(
    '../../packages/domain/src/rilis.ts'
  );
  assert.ok(
    RUNBOOK.includes(`≥ ${JEDA_TAHAP_JAM} jam`),
    `runbook harus menyebut jeda tahap (${JEDA_TAHAP_JAM} jam)`
  );
  assert.ok(
    RUNBOOK.includes(`Maksimal ${MAKS_TUNDA}× per versi`),
    `runbook harus menyebut batas penundaan (${MAKS_TUNDA})`
  );
  const jam = (n) => `${String(n).padStart(2, '0')}:00`;
  const jendela = `${jam(JENDELA_BAWAAN.mulaiJam)}–${jam(JENDELA_BAWAAN.selesaiJam)}`;
  assert.ok(
    RUNBOOK.includes(jendela),
    `runbook harus menyebut jendela update bawaan (${jendela})`
  );
});

test('⛔ runbook menyatakan batas yang HANDOFF juga nyatakan', () => {
  // Dua dokumen yang menyebut batas berbeda menghasilkan operator yang
  // menjanjikan hal yang tidak dapat dipenuhi. Yang diperiksa di sini adalah
  // batas yang paling mahal bila dilupakan.
  const handoff = readFileSync(join(AKAR, 'HANDOFF.md'), 'utf8');
  const batas = [
    // Cetak: tidak satu byte pun pernah sampai ke printer sungguhan.
    ['printer sungguhan', 'gate F4 bagian pertama'],
    // Oversell tidak dicegah.
    ['oversell', 'non-goal permanen'],
  ];
  const gagal = [];
  for (const [kata] of batas) {
    if (!RUNBOOK.toLowerCase().includes(kata.toLowerCase())) {
      gagal.push(`runbook tidak menyebut batas "${kata}"`);
    }
  }
  assert.deepEqual(gagal, [], gagal.join('\n  '));
  assert.ok(handoff.length > 0);
});

test('⛔ runbook tidak menyuruh siapa pun melanggar invariant', () => {
  // Yang dicari adalah instruksi, bukan larangan. Runbook ini memuat daftar
  // "yang TIDAK boleh dilakukan" yang justru menyebut `UPDATE` dan `DELETE`,
  // jadi kata kunci polos akan menandai dokumen yang benar.
  //
  // Yang ditandai: baris yang menyuruh (`Jalankan`, `Ubah`, `Set`) sekaligus
  // menyebut UPDATE/DELETE pada tabel jalur uang.
  // ⛔ Diperiksa per PARAGRAF, bukan per baris. Markdown membungkus kalimat
  // di 80 kolom, jadi larangan dan kata `UPDATE`-nya sering jatuh di baris
  // yang berbeda — dan pemeriksaan per baris menandai dokumen yang justru
  // benar. Ditemukan langsung: baris "adalah record BARU. Setiap 'perbaikan'
  // lewat `UPDATE` pada `order`," adalah potongan tengah sebuah larangan.
  const paragraf = RUNBOOK.split(/\n\s*\n/);
  const pelanggaran = [];
  const TABEL_UANG = /\b(order|payment|refund|cash_movement|stock_movement)\b/i;
  for (const [i, b] of paragraf.entries()) {
    if (!/\b(UPDATE|DELETE)\b/.test(b)) continue;
    if (/⛔|JANGAN|Jangan|jangan|tidak boleh|tidak pernah|mustahil|ditolak|menghancurkan/.test(b)) continue;
    if (TABEL_UANG.test(b)) pelanggaran.push(`paragraf ${i + 1}: ${b.trim().slice(0, 120)}`);
  }
  assert.deepEqual(
    pelanggaran,
    [],
    `Runbook menyuruh mutasi destruktif di jalur uang:\n  ${pelanggaran.join('\n  ')}`
  );
});
