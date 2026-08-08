'use strict';

// T4 -- ⛔ aturan mengikat `CLAUDE.md` bagian F2:
//
//   "Setiap kolom yang tipenya BERBEDA antara PostgreSQL dan skema lokal wajib
//    punya `put` raw table yang DITULIS SENDIRI. `put` yang disimpulkan
//    PowerSync menyalin nilai apa adanya."
//
// Aturan itu lahir dari cacat terukur di `tax_rate.rate`: `0.1100` mendarat
// sebagai `0.11` -- 10.000× terlalu kecil -- dan tersimpan sebagai `real` di
// kolom `INTEGER`, tanpa satu pun error. Sampai sekarang aturan itu hanya
// hidup sebagai kalimat. Test ini yang menegakkannya.
//
// Ia membandingkan DDL PostgreSQL dengan DDL SQLite lokal dan menuntut SETIAP
// perbedaan punya perlakuan yang tertulis. Perbedaan yang tidak diputuskan
// membuat test merah; itu satu-satunya cara kelas cacat ini berhenti ditemukan
// belakangan.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  tipeKolomPostgres,
  tipeKolomLokal,
  kelasPostgres,
  kelasLokal,
} = require('./helpers/ddl-postgres');

const SKEMA = '../../apps/kasir/src/lokal/skema.ts';

async function divergensi() {
  const { TABEL_RAW } = await import(SKEMA);
  const pg = tipeKolomPostgres();
  const lokal = tipeKolomLokal();

  const hasil = [];
  const tanpaPadanan = [];
  for (const tabel of TABEL_RAW) {
    assert.ok(pg[tabel], `tabel ${tabel} tidak ditemukan di migrasi PostgreSQL`);
    for (const [kolom, tipeLokal] of Object.entries(lokal[tabel] ?? {})) {
      const tipePg = pg[tabel][kolom];
      if (!tipePg) {
        tanpaPadanan.push(`${tabel}.${kolom}`);
        continue;
      }
      const a = kelasPostgres(tipePg);
      const b = kelasLokal(tipeLokal);
      if (a !== b) hasil.push({ tabel, kolom, kelas: `${a}->${b}`, tipePg, tipeLokal });
    }
  }
  return { hasil, tanpaPadanan };
}

// Penjaga terhadap penjaganya sendiri. Parser DDL yang gagal membaca sebuah
// kolom akan melaporkan "tidak ada divergensi" -- hijau, dan hampa.
test('T4 setiap kolom lokal punya padanan di skema PostgreSQL', async () => {
  const { tanpaPadanan } = await divergensi();
  assert.deepEqual(
    tanpaPadanan,
    [],
    'kolom lokal tanpa padanan PostgreSQL: skema berbeda, atau parser DDL gagal membacanya'
  );
});

test('T4 parser benar-benar melihat kolom -- bukan hijau karena kosong', async () => {
  const pg = tipeKolomPostgres();
  const lokal = tipeKolomLokal();
  assert.ok(Object.keys(pg).length >= 20, `hanya ${Object.keys(pg).length} tabel PostgreSQL terbaca`);
  assert.equal(pg.tax_rate.rate, 'numeric(6,4)');
  assert.equal(pg.order_line.tax_rate, 'numeric(6,4)');
  assert.equal(pg.item_variation.conversion_factor, 'numeric');
  assert.equal(lokal.tax_rate.rate, 'integer');
  assert.equal(lokal.item_variation.conversion_factor, 'integer');
  // Kolom yang ditambahkan lewat ALTER TABLE (migrasi 0018) juga terbaca.
  assert.equal(pg.item_modifier_list.id, 'text');
});

test('T4 setiap KELAS divergensi punya perlakuan tertulis', async () => {
  const { PERLAKUAN_DIVERGENSI } = await import(SKEMA);
  const { hasil } = await divergensi();
  const kelas = [...new Set(hasil.map((d) => d.kelas))].sort();

  for (const k of kelas) {
    assert.ok(
      PERLAKUAN_DIVERGENSI[k],
      `kelas divergensi "${k}" belum diputuskan perlakuannya (contoh: ${hasil.find((d) => d.kelas === k).tabel}.${
        hasil.find((d) => d.kelas === k).kolom
      })`
    );
    assert.ok(PERLAKUAN_DIVERGENSI[k].alasan.length > 20, `alasan untuk "${k}" terlalu pendek`);
  }
});

// Inti T4. Kalau baris ini dilepas, `item_variation.conversion_factor` dan
// `order_line.tax_rate` -- keduanya `numeric` di server, `INTEGER` berskala di
// lokal -- kembali memakai `put` yang disimpulkan, dan keduanya salah dengan
// cara yang tidak memunculkan error.
test('T4 setiap kolom desimal->bulat punya skala, dan skalanya masuk ke put', async () => {
  const { SKALA_KOLOM, kolomPerTabel, buatDefinisiRaw, ekspresiNilai } = await import(SKEMA);
  const fs = require('node:fs');
  const path = require('node:path');
  const sql = fs.readFileSync(
    path.join(__dirname, '..', '..', 'db', 'local', '001-initial.sql'),
    'utf8'
  );
  const def = buatDefinisiRaw(kolomPerTabel(sql));

  const { hasil } = await divergensi();
  const perluSkala = hasil.filter((d) => d.kelas === 'desimal->bulat');
  assert.ok(perluSkala.length >= 3, `hanya ${perluSkala.length} kolom desimal->bulat terdeteksi`);

  for (const d of perluSkala) {
    const skala = SKALA_KOLOM[d.tabel]?.[d.kolom];
    assert.ok(
      skala,
      `${d.tabel}.${d.kolom} adalah ${d.tipePg} di server dan ${d.tipeLokal} di lokal, tapi tidak punya skala -- nilainya akan mendarat apa adanya`
    );
    assert.equal(ekspresiNilai(d.tabel, d.kolom), `CAST(ROUND(? * ${skala}) AS INTEGER)`);
    assert.ok(
      def[d.tabel].put.sql.includes(`CAST(ROUND(? * ${skala}) AS INTEGER)`),
      `konversi ${d.tabel}.${d.kolom} tidak muncul di put`
    );
  }
});

// Kebalikannya: skala yang dideklarasikan untuk kolom yang tidak
// membutuhkannya akan MERUSAK nilai yang tadinya benar.
test('T4 tidak ada skala untuk kolom yang tipenya sudah sepakat', async () => {
  const { SKALA_KOLOM } = await import(SKEMA);
  const { hasil } = await divergensi();
  const perlu = new Set(
    hasil.filter((d) => d.kelas === 'desimal->bulat').map((d) => `${d.tabel}.${d.kolom}`)
  );

  for (const [tabel, kolom] of Object.entries(SKALA_KOLOM)) {
    for (const k of Object.keys(kolom)) {
      assert.ok(
        perlu.has(`${tabel}.${k}`),
        `${tabel}.${k} punya skala tapi tipenya tidak berbeda -- konversi ini akan merusak nilai yang benar`
      );
    }
  }
});

// Kolom berkelas `belum-diukur` boleh ada, tapi tidak boleh menyelinap. Satu
// kolom jsonb baru di tabel yang direplikasi harus jadi keputusan sadar.
test('T4 kolom belum-diukur terdaftar satu per satu, tidak ada yang menyelinap', async () => {
  const { PERLAKUAN_DIVERGENSI, KOLOM_BELUM_DIUKUR } = await import(SKEMA);
  const { hasil } = await divergensi();

  const sebenarnya = hasil
    .filter((d) => PERLAKUAN_DIVERGENSI[d.kelas]?.perlakuan === 'belum-diukur')
    .map((d) => `${d.tabel}.${d.kolom}`)
    .sort();

  assert.deepEqual(
    [...KOLOM_BELUM_DIUKUR].sort(),
    sebenarnya,
    'KOLOM_BELUM_DIUKUR harus persis sama dengan kolom yang kelasnya belum diukur'
  );
});
