'use strict';

// ⛔ PENJAGA CAKUPAN RBAC.
//
// Audit menemukan 34 endpoint mutasi tanpa penjaga peran sama sekali.
// Matriksnya ada dan lengkap di `packages/domain/src/rbac.ts` sejak F3; yang
// tidak ada adalah pemanggilannya.
//
// Menambal ke-34 itu satu per satu TIDAK memperbaiki yang ke-35 — endpoint
// bulan depan lahir tanpa penjaga persis seperti ke-34 ini lahir. Yang
// menahan itu bukan disiplin penulisnya melainkan test ini: setiap rute
// mutasi WAJIB punya entri, entah di peta peran atau di daftar pengecualian
// yang beralasan.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

let app;

before(async () => {
  const { buildApp } = await import('../../apps/server/src/app.ts');
  app = await buildApp();
  await app.ready();
});

after(async () => {
  if (app) await app.close();
});

const MUTASI = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Rute yang BENAR-BENAR terdaftar, diuraikan dari pohon router Fastify.
 *
 * ⛔ Kedalaman dihitung dari LEBAR AWALAN GLIF (4 karakter per tingkat),
 * bukan dari jumlah glif atau dari posisi garis miring pertama.
 *
 * Versi pertama memakai posisi `/` dan menghasilkan rute palsu:
 * `POST /orders/cancel` (kehilangan `:orderId`) dan `POST /items/variationss`.
 * Keduanya lolos sebagai "rute tanpa penjaga" — penjaga yang salah membaca
 * rute menghasilkan alarm palsu hari ini dan, pada bentuk pohon yang sedikit
 * berbeda, kebisuan besok.
 *
 * Segmen tidak selalu diawali `/`: radix tree memecah `/prices` menjadi
 * `/price` + `s`. Itu sebabnya awalan diukur, bukan dicari.
 */
function ruteTerdaftar() {
  const teks = app.printRoutes({ commonPrefix: false });
  const tumpukan = [];
  const hasil = [];

  for (const baris of teks.split('\n')) {
    if (baris.trim().length === 0) continue;
    const cocok = /^([\u2502\u251c\u2514\u2500 ]*)(.*)$/.exec(baris);
    if (!cocok) continue;
    const dalam = Math.max(0, Math.floor(cocok[1].length / 4) - 1);
    let sisa = cocok[2];
    if (sisa.length === 0) continue;

    let metode = null;
    const m = /^(.*?)\s\(([A-Z, ]+)\)$/.exec(sisa);
    if (m) {
      sisa = m[1];
      metode = m[2];
    }

    tumpukan.length = dalam;
    tumpukan[dalam] = sisa;

    if (metode) {
      const jalur = tumpukan.slice(0, dalam + 1).join('');
      for (const x of metode.split(',').map((v) => v.trim())) {
        hasil.push({ metode: x, pola: jalur });
      }
    }
  }
  return hasil;
}

// ---------------------------------------------------------------------------

test('⛔ SETIAP rute mutasi punya aturan peran, pengecualian beralasan, atau terbuka', async () => {
  const { PETA_PERAN, DIKECUALIKAN } = await import('../../apps/server/src/rbac-rute.ts');
  const { DAFTAR_RUTE_TERBUKA } = await import('../../apps/server/src/sesi.ts');

  const berperan = new Set(PETA_PERAN.map((r) => `${r.metode} ${r.pola}`));
  const kecuali = new Set(DIKECUALIKAN.map((r) => `${r.metode} ${r.pola}`));
  const terbuka = new Set(DAFTAR_RUTE_TERBUKA.map((r) => `${r.metode} ${r.pola}`));

  const rute = ruteTerdaftar();
  assert.ok(rute.length > 30, `router tidak terbaca (${rute.length} rute) — parsernya usang?`);

  const telanjang = [];
  for (const r of rute) {
    if (!MUTASI.has(r.metode)) continue;
    const kunci = `${r.metode} ${r.pola}`;
    if (berperan.has(kunci) || kecuali.has(kunci) || terbuka.has(kunci)) continue;
    telanjang.push(kunci);
  }

  assert.deepEqual(
    telanjang,
    [],
    'Rute mutasi tanpa penjaga peran:\n  ' +
      telanjang.join('\n  ') +
      '\n\nTambahkan ke PETA_PERAN (apps/server/src/rbac-rute.ts), atau ke ' +
      'DIKECUALIKAN dengan alasan yang dapat diperiksa.'
  );
});

test('⛔ setiap pengecualian punya ALASAN yang berarti', async () => {
  // Daftar pengecualian keamanan tanpa alasan akan bertambah panjang sampai
  // ia tidak menjaga apa pun — pola yang sama dengan RUTE_TERBUKA.
  const { DIKECUALIKAN } = await import('../../apps/server/src/rbac-rute.ts');
  for (const r of DIKECUALIKAN) {
    assert.ok(
      typeof r.alasan === 'string' && r.alasan.length > 25,
      `${r.metode} ${r.pola} tidak punya alasan yang berarti`
    );
  }
});

test('⛔ setiap pola di PETA_PERAN benar-benar terdaftar di router', async () => {
  // Pola yang salah ketik menjadi aturan yang tidak pernah cocok — dan
  // konsekuensinya DIAM: rute yang dimaksud dijaga justru berjalan tanpa
  // penjaga, dan test cakupan di atas tetap hijau karena ia melihat entrinya
  // ada.
  const { PETA_PERAN } = await import('../../apps/server/src/rbac-rute.ts');
  const rute = new Set(ruteTerdaftar().map((r) => `${r.metode} ${r.pola}`));

  const hantu = PETA_PERAN.map((r) => `${r.metode} ${r.pola}`).filter((k) => !rute.has(k));
  assert.deepEqual(hantu, [], `aturan peran untuk rute yang tidak ada: ${hantu.join(', ')}`);
});

test('⛔ setiap operasi yang dipakai ADA di matriks RBAC', async () => {
  // `bolehkah` fail-closed: operasi tak dikenal ditolak untuk SEMUA orang,
  // termasuk owner. Salah ketik karena itu MENUTUP rute, bukan membukanya —
  // aman, tapi ia akan ditemukan merchant, bukan di sini.
  const { PETA_PERAN } = await import('../../apps/server/src/rbac-rute.ts');
  const { bolehkah } = await import('../../packages/domain/src/rbac.ts');

  for (const r of PETA_PERAN) {
    assert.ok(
      bolehkah(['owner'], r.operasi),
      `operasi "${r.operasi}" (${r.metode} ${r.pola}) tidak dikenal matriks — owner pun ditolak`
    );
  }
});

test('⛔ TIDAK ADA rute yang sekaligus terbuka DAN berperan', async () => {
  // Rute terbuka tidak punya sesi, jadi tidak punya peran untuk diperiksa.
  // Yang ada di kedua daftar berarti salah satunya salah — dan yang menang
  // adalah "terbuka", karena penjaga sesi berjalan lebih dulu.
  const { PETA_PERAN } = await import('../../apps/server/src/rbac-rute.ts');
  const { DAFTAR_RUTE_TERBUKA } = await import('../../apps/server/src/sesi.ts');
  const terbuka = new Set(DAFTAR_RUTE_TERBUKA.map((r) => `${r.metode} ${r.pola}`));

  const bentrok = PETA_PERAN.map((r) => `${r.metode} ${r.pola}`).filter((k) => terbuka.has(k));
  assert.deepEqual(bentrok, [], `rute terbuka tapi diberi aturan peran: ${bentrok.join(', ')}`);
});

test('jalur perangkat kasir TIDAK punya aturan peran', async () => {
  // Relay outbox tidak mengirim Bearer, jadi tidak ada sesi dan tidak ada
  // peran. Memberi aturan peran ke rute-rute ini akan menolak setiap
  // penjualan offline yang menyusul.
  const { PETA_PERAN } = await import('../../apps/server/src/rbac-rute.ts');
  const berperan = new Set(PETA_PERAN.map((r) => `${r.metode} ${r.pola}`));

  for (const rute of [
    'POST /orders',
    'POST /shifts',
    'POST /orders/:orderId/cancel',
    'POST /orders/:orderId/payments',
  ]) {
    assert.ok(!berperan.has(rute), `${rute} diberi aturan peran — jalur naik kasir mati`);
  }
});
