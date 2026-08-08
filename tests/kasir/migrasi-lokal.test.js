'use strict';

// T5 -- keputusan migrasi skema lokal.
//
// ⛔ `CLAUDE.md` bagian F2: "Membangun ulang raw table lokal TIDAK memicu
// unduh ulang. Checkpoint PowerSync hidup di tabel `ps_*`, terpisah dari tabel
// kami; `waitForFirstSync()` selesai dalam 0 ms dan MELAPORKAN SUKSES
// sementara katalog kosong permanen."
//
// Sampai sekarang aturan itu berbunyi "wajib diikuti `disconnectAndClear()`"
// dan bergantung pada seseorang mengingatnya. Yang membuatnya tidak bergantung
// pada ingatan bukan penomoran versi manual -- versi manual justru lupa
// dinaikkan -- melainkan SIDIK JARI yang dihitung dari bentuk raw table itu
// sendiri.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SKEMA = '../../apps/kasir/src/lokal/skema.ts';
const MIGRASI = '../../apps/kasir/src/lokal/migrasi.ts';

function sql() {
  return fs.readFileSync(
    path.join(__dirname, '..', '..', 'db', 'local', '001-initial.sql'),
    'utf8'
  );
}

test('T5 sidik jari stabil untuk skema yang sama', async () => {
  const { kolomPerTabel, sidikJariRawTable } = await import(SKEMA);
  const a = sidikJariRawTable(kolomPerTabel(sql()));
  const b = sidikJariRawTable(kolomPerTabel(sql()));
  assert.equal(a, b);
  assert.ok(a.length > 0);
});

test('T5 sidik jari berubah bila kolom raw table berubah', async () => {
  const { kolomPerTabel, sidikJariRawTable } = await import(SKEMA);
  const asli = kolomPerTabel(sql());

  const tambahKolom = { ...asli, item: [...asli.item, 'kolom_baru'] };
  assert.notEqual(sidikJariRawTable(asli), sidikJariRawTable(tambahKolom));

  const hapusKolom = { ...asli, tax_rate: asli.tax_rate.filter((k) => k !== 'rate') };
  assert.notEqual(sidikJariRawTable(asli), sidikJariRawTable(hapusKolom));

  // Urutan kolom ikut dihitung: `put` menyusun VALUES mengikuti urutan ini,
  // dan urutan yang tertukar menaruh nilai di kolom yang salah tanpa error
  // selama tipenya kebetulan cocok.
  const tukarUrutan = { ...asli, modifier: [asli.modifier[1], asli.modifier[0], ...asli.modifier.slice(2)] };
  assert.notEqual(sidikJariRawTable(asli), sidikJariRawTable(tukarUrutan));
});

// Tabel murni lokal BUKAN bagian sidik jari. Menambah kolom ke `outbox_local`
// tidak ada hubungannya dengan checkpoint PowerSync, dan memaksa unduh ulang
// katalog karenanya berarti membuang jendela riwayat 90 hari tanpa alasan.
test('T5 perubahan tabel lokal-saja tidak mengubah sidik jari', async () => {
  const { kolomPerTabel, sidikJariRawTable } = await import(SKEMA);
  const asli = kolomPerTabel(sql());
  const ubah = { ...asli, outbox_local: [...asli.outbox_local, 'prioritas'] };
  assert.equal(sidikJariRawTable(asli), sidikJariRawTable(ubah));
});

test('T5 perangkat baru: bangun tabel dan bersihkan state sync', async () => {
  const { putuskanMigrasi } = await import(MIGRASI);
  const k = putuskanMigrasi({ sidikTersimpan: null, sidikSekarang: 'abc' });
  assert.equal(k.perluBangunUlang, true);
  assert.equal(k.perluBersihkanSync, true);
  assert.match(k.alasan, /belum/i);
});

test('T5 sidik jari sama: tidak melakukan apa pun', async () => {
  const { putuskanMigrasi } = await import(MIGRASI);
  const k = putuskanMigrasi({ sidikTersimpan: 'abc', sidikSekarang: 'abc' });
  assert.equal(k.perluBangunUlang, false);
  assert.equal(k.perluBersihkanSync, false);
});

// Inti T5. Membangun ulang TANPA membersihkan state sync menghasilkan keadaan
// yang paling berbahaya di seluruh jalur turun: katalog kosong permanen,
// sementara `waitForFirstSync()` melaporkan sukses dalam 0 ms.
test('T5 sidik jari berubah: bangun ulang SELALU disertai bersihkan sync', async () => {
  const { putuskanMigrasi } = await import(MIGRASI);
  const k = putuskanMigrasi({ sidikTersimpan: 'lama', sidikSekarang: 'baru' });
  assert.equal(k.perluBangunUlang, true);
  assert.equal(k.perluBersihkanSync, true);
  assert.match(k.alasan, /berubah/i);
});

// Property kecil: TIDAK ADA masukan yang menghasilkan "bangun ulang tanpa
// bersihkan". Itu satu-satunya kombinasi yang menghasilkan katalog kosong
// permanen, dan ia harus mustahil, bukan sekadar tidak dipilih.
test('T5 kombinasi bangun-ulang-tanpa-bersihkan tidak dapat dihasilkan', async () => {
  const { putuskanMigrasi } = await import(MIGRASI);
  const nilai = [null, '', 'a', 'b', 'sidik-panjang-sekali'];
  for (const tersimpan of nilai) {
    for (const sekarang of nilai) {
      const k = putuskanMigrasi({ sidikTersimpan: tersimpan, sidikSekarang: sekarang });
      assert.ok(
        !(k.perluBangunUlang && !k.perluBersihkanSync),
        `bangun ulang tanpa bersihkan untuk (${tersimpan}, ${sekarang})`
      );
    }
  }
});

// ⛔ Yang paling mahal kalau salah di seluruh berkas ini. `outbox_local`
// adalah antrean penjualan yang BELUM terkirim ke server; men-drop-nya saat
// migrasi menghapus uang merchant yang tidak tercatat di mana pun, dan tidak
// ada apa pun yang dapat memulihkannya.
test('T5 rencana DDL tidak pernah men-drop tabel murni lokal', async () => {
  const { rencanaDdl } = await import(MIGRASI);
  const { TABEL_LOKAL_SAJA, TABEL_RAW } = await import(SKEMA);
  const r = rencanaDdl(sql());

  for (const t of TABEL_LOKAL_SAJA) {
    assert.ok(
      !r.drop.some((d) => d.includes(`"${t}"`)),
      `${t} ikut di-drop -- antrean upload akan hilang`
    );
  }
  for (const t of TABEL_RAW) {
    assert.ok(
      r.drop.includes(`DROP TABLE IF EXISTS "${t}"`),
      `raw table ${t} tidak ikut dibangun ulang`
    );
  }
});

test('T5 tabel lokal dibuat IF NOT EXISTS, raw table dibuat keras', async () => {
  const { rencanaDdl } = await import(MIGRASI);
  const r = rencanaDdl(sql());

  const cari = (awalan) => r.buat.filter((b) => b.toUpperCase().includes(awalan.toUpperCase()));

  // Lokal-saja: isinya harus selamat, jadi CREATE-nya tidak boleh gagal dan
  // tidak boleh menimpa.
  for (const t of ['outbox_local', 'device_config', 'stock_snapshot']) {
    const b = cari(`TABLE IF NOT EXISTS ${t} `);
    assert.equal(b.length, 1, `${t} harus dibuat dengan IF NOT EXISTS`);
  }
  // Index milik tabel lokal ikut, kalau tidak boot kedua gagal.
  assert.equal(cari('INDEX IF NOT EXISTS ix_outbox_status').length, 1);

  // Raw table baru saja di-drop; CREATE biasa membuat kegagalan drop terlihat
  // seketika alih-alih melanjutkan di atas tabel berbentuk lama.
  assert.ok(r.buat.some((b) => /^CREATE TABLE "?order"?\s*\(/i.test(b)));
  assert.ok(!r.buat.some((b) => /CREATE TABLE IF NOT EXISTS "?order"?/i.test(b)));

  assert.ok(r.pragma.length >= 2, 'PRAGMA harus ikut dan dijalankan lebih dulu');
});

test('T5 urutan langkah: bersihkan sync, DDL, baru simpan sidik jari', async () => {
  const { jalankanMigrasi } = await import(MIGRASI);
  const { kolomPerTabel, sidikJariRawTable } = await import(SKEMA);
  const jejak = [];
  const sidik = sidikJariRawTable(kolomPerTabel(sql()));

  await jalankanMigrasi({
    sqlSkema: sql(),
    bacaSidik: async () => {
      jejak.push('baca');
      return null;
    },
    jalankanDdl: async () => {
      jejak.push('ddl');
    },
    bersihkanSync: async () => {
      jejak.push('bersih');
    },
    simpanSidik: async (s) => {
      jejak.push(`simpan:${s === sidik}`);
    },
  });

  // Dua hal yang dipaku urutannya:
  //
  //   `bersih` sebelum `ddl` -- itu urutan yang benar-benar dijalankan dan
  //   diukur di prototipe 05 (init -> disconnectAndClear -> pasang tabel).
  //   Urutan sebaliknya belum pernah dijalankan sama sekali.
  //
  //   `simpan` TERAKHIR -- kalau sidik jari disimpan lebih dulu dan DDL gagal
  //   di tengah, boot berikutnya menyimpulkan "tidak ada yang berubah" di atas
  //   skema setengah jadi, dan itu tidak akan pernah pulih sendiri.
  assert.deepEqual(jejak, ['baca', 'bersih', 'ddl', 'simpan:true']);
});

test('T5 tanpa perubahan, DDL dan pembersihan tidak dijalankan sama sekali', async () => {
  const { jalankanMigrasi } = await import(MIGRASI);
  const { kolomPerTabel, sidikJariRawTable } = await import(SKEMA);
  const jejak = [];
  const sidik = sidikJariRawTable(kolomPerTabel(sql()));

  const hasil = await jalankanMigrasi({
    sqlSkema: sql(),
    bacaSidik: async () => sidik,
    jalankanDdl: async () => jejak.push('ddl'),
    bersihkanSync: async () => jejak.push('bersih'),
    simpanSidik: async () => jejak.push('simpan'),
  });

  assert.deepEqual(jejak, []);
  assert.equal(hasil.perluBangunUlang, false);
});
