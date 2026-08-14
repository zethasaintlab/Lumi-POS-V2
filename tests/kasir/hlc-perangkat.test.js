'use strict';

// HLC perangkat — menutup lubang I10 di jalur produksi.
//
// ⛔ I10 (monotonisitas HLC per perangkat) dijaga harness DST sejak F2, tapi
// jalur penjualan sungguhan memakai `Date.now()` apa adanya sampai sekarang.
// Jam perangkat yang mundur — NTP menyesuaikan, pengguna mengubah zona,
// baterai RTC habis — menghasilkan dua order dengan HLC yang tidak berurutan,
// dan urutan kausal di server jadi salah tanpa satu pun error.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../apps/kasir/src/lokal/hlc.ts';

function dbPalsu(hlcTersimpan = null, { legacy = null } = {}) {
  const state = { hlc_teks: hlcTersimpan, hlc_state: legacy, tulis: [] };
  const db = {
    state,
    async getAll(sql) {
      if (/FROM device_config/.test(sql)) return [{ hlc_teks: state.hlc_teks, hlc_state: state.hlc_state }];
      return [];
    },
    async execute(sql, params = []) {
      state.tulis.push({ sql, params });
      if (/hlc_teks/.test(sql)) state.hlc_teks = params[0];
      return { rowsAffected: 1 };
    },
    async transaction(fn) {
      return fn(db);
    },
  };
  return db;
}

// ---------------------------------------------------------------------------

test('memuat keadaan tersimpan; perangkat baru mulai dari nol', async () => {
  const { muatHlc } = await import(MOD);

  const baru = await muatHlc(dbPalsu(null), () => 1_000_000);
  assert.equal(typeof baru.tick(), 'bigint');

  // Nilai tersimpan menjadi titik awal. Tanpa ini, boot berikutnya memulai
  // dari nol dan SETIAP order berikutnya ber-HLC lebih kecil daripada yang
  // sudah ada — urutan kausal terbalik untuk seluruh riwayat perangkat.
  const lanjut = await muatHlc(dbPalsu('999999999999'), () => 1_000_000);
  assert.ok(lanjut.tick() > 999999999999n);
});

test('⛔ jam yang MUNDUR tidak menurunkan HLC', async () => {
  const { muatHlc } = await import(MOD);

  let jam = 2_000_000;
  const hlc = await muatHlc(dbPalsu(null), () => jam);

  const a = hlc.tick();
  jam = 1_000_000; // NTP menyesuaikan mundur satu detik
  const b = hlc.tick();
  const c = hlc.tick();

  assert.ok(b > a, 'HLC harus tetap naik meski jam mundur');
  assert.ok(c > b);
});

test('⛔ nilai DISIMPAN di transaksi yang sama dengan penjualan', async () => {
  const { muatHlc, simpanHlc } = await import(MOD);
  const db = dbPalsu(null);
  const hlc = await muatHlc(db, () => 3_000_000);

  const nilai = hlc.tick();
  await db.transaction(async (tx) => {
    await tx.execute(`INSERT INTO "order" (id) VALUES ('o1')`);
    await simpanHlc(tx, nilai);
  });

  assert.equal(db.state.hlc_teks, nilai.toString());

  // ⛔ Urutannya yang menentukan: kalau penyimpanan terjadi DI LUAR transaksi
  // penjualan, crash di antara keduanya membuat boot berikutnya memuat nilai
  // LAMA — dan tick berikutnya dapat menghasilkan HLC yang SUDAH DIPAKAI
  // order yang sudah ter-commit. Dua order dengan HLC sama adalah pelanggaran
  // I10 yang tidak menghasilkan satu pun error.
  const tulisDalamTransaksi = db.state.tulis.map((t) => t.sql);
  assert.ok(tulisDalamTransaksi.some((s) => /hlc_teks/.test(s)));
});

test('disimpan sebagai TEKS, bukan angka', async () => {
  const { muatHlc, simpanHlc } = await import(MOD);
  const db = dbPalsu(null);
  const hlc = await muatHlc(db, () => Date.parse('2026-08-13T10:00:00Z'));

  const nilai = hlc.tick();
  await simpanHlc(db, nilai);

  // HLC adalah bilangan 57-bit — melebihi presisi double. Menyimpannya
  // sebagai angka di SQLite (yang memakai REAL untuk nilai besar) akan
  // membulatkannya diam-diam, dan nilai yang dimuat kembali TIDAK SAMA
  // dengan yang ditulis.
  assert.equal(typeof db.state.hlc_teks, 'string');
  assert.equal(BigInt(db.state.hlc_teks), nilai, 'round-trip harus utuh');
});

test('⛔ round-trip utuh untuk nilai di atas Number.MAX_SAFE_INTEGER', async () => {
  const { muatHlc, simpanHlc } = await import(MOD);

  // COUNTER_BITS = 16 (packages/domain/src/hlc.ts). Dengan physical berupa
  // milidetik epoch (~1,79e12), HLC SELALU melampaui 2^53 — jadi kebutuhan
  // string bukan teoretis, ia berlaku untuk setiap nilai nyata.
  const besar = (BigInt(Date.parse('2026-08-13T10:00:00Z')) << 16n) + 7n;
  assert.ok(besar > BigInt(Number.MAX_SAFE_INTEGER), `${besar} harus > 2^53`);

  const db = dbPalsu(besar.toString());
  const hlc = await muatHlc(db, () => 1);
  const berikutnya = hlc.tick();
  assert.ok(berikutnya > besar, 'harus melanjutkan dari nilai besar, bukan dari nol');

  await simpanHlc(db, berikutnya);
  assert.equal(BigInt(db.state.hlc_teks), berikutnya);
});

test('keadaan tersimpan yang RUSAK tidak menjatuhkan aplikasi', async () => {
  const { muatHlc } = await import(MOD);

  // Baris yang disunting tangan, atau migrasi yang setengah jalan. Melempar
  // di sini berarti aplikasi tidak dapat dibuka sama sekali; jatuh ke nol
  // berarti HLC mundur diam-diam. Yang dipilih: jatuh ke JAM SEKARANG, yang
  // hampir pasti lebih besar daripada nilai lama mana pun.
  for (const rusak of ['', 'bukan-angka', null]) {
    const hlc = await muatHlc(dbPalsu(rusak), () => 5_000_000);
    const nilai = hlc.tick();
    assert.ok(nilai > 0n, `harus tetap jalan untuk ${JSON.stringify(rusak)}`);
  }
});

test('⛔ perangkat LAMA: nilai dari kolom INTEGER tidak membuat HLC mundur', async () => {
  const { muatHlc } = await import(MOD);

  // Ditemukan dengan MENJALANKAN aplikasi, bukan lewat test. Kolom
  // `hlc_state` bertipe INTEGER mengembalikan nilai sebagai `number` yang
  // sudah kehilangan presisi di atas 2^53. Versi pertama `awalYangAman`
  // menolaknya (bukan string) lalu jatuh ke jam dinding — dan jam yang sedang
  // mundur membuat HLC TURUN setelah restart, tanpa satu pun error.
  const dipakai = (BigInt(Date.parse('2026-08-13T10:00:00Z')) << 16n) + 5n;
  // Jam SENGAJA mundur satu jam, seperti NTP yang menyesuaikan.
  const jamMundur = () => Date.parse('2026-08-13T09:00:00Z');

  // ⛔ KETIGA bentuk diuji, karena driver benar-benar mengembalikan ketiganya.
  // Diukur dari database sungguhan: `@powersync/web` mengembalikan kolom
  // INTEGER yang besar sebagai **bigint**. Versi pertama kode ini hanya
  // memeriksa `number`, jadi cabang perangkat-lama tidak pernah diambil dan
  // HLC tetap mundur — hijau di test, salah di aplikasi.
  for (const bentuk of [dipakai, Number(dipakai), dipakai.toString()]) {
    const hlc = await muatHlc(dbPalsu(null, { legacy: bentuk }), jamMundur);
    const berikutnya = hlc.tick();
    assert.ok(
      berikutnya > dipakai,
      `${typeof bentuk}: ${berikutnya} harus > ${dipakai} meski jam mundur`
    );
  }
});
