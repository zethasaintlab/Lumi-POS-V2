'use strict';

// T1 -- tabel rute kasir dan pencocokannya.
//
// Router ini ditulis sendiri (keputusan user 8 Agustus 2026, PLAN-pondasi-kasir
// §3.2). Alasannya bukan bahwa react-router buruk: permukaan yang dibutuhkan
// kasir kecil -- delapan rute, satu layout, tanpa nested route -- Tauri tidak
// memberi kasir URL bar, dan bentuk buatan sendiri adalah satu-satunya yang
// dapat diuji di `node --test` tanpa browser sama sekali.
//
// Daftar rutenya BUKAN karangan. Ia terjemahan langsung dari
// `product/IA-lumi-pos-v1.md` §7 (baris 308-317), dan setiap rute membawa kode
// layar dari §2.2 supaya drift antara IA dan kode terlihat sebagai kegagalan
// test, bukan sebagai penemuan enam bulan lagi.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const RUTE = '../../apps/kasir/src/rute/tabel.ts';

test('setiap rute di IA §7 dapat dicocokkan', async () => {
  const { cocokkanRute } = await import(RUTE);

  const harapan = [
    ['/login', 'K-01'],
    ['/shift/buka', 'K-02'],
    ['/', 'K-03'],
    ['/riwayat', 'K-08'],
    ['/shift/tutup', 'K-12'],
    ['/sync', 'K-14'],
    ['/perangkat', 'K-15'],
  ];

  for (const [jalur, layar] of harapan) {
    const hasil = cocokkanRute(jalur);
    assert.equal(hasil.layar, layar, `jalur ${jalur}`);
    assert.deepEqual(hasil.params, {}, `jalur ${jalur} tidak boleh punya params`);
  }
});

test('rute berparameter mengembalikan nilainya', async () => {
  const { cocokkanRute } = await import(RUTE);
  const hasil = cocokkanRute('/riwayat/ord-01J9ABC');
  assert.equal(hasil.layar, 'K-09');
  assert.deepEqual(hasil.params, { orderId: 'ord-01J9ABC' });
});

// Yang paling mudah salah pada router buatan sendiri: `/riwayat` tertelan oleh
// pola `/riwayat/:orderId`, atau sebaliknya. Keduanya ada di IA sebagai layar
// BERBEDA (K-08 daftar, K-09 detail).
test('rute statis tidak tertelan rute berparameter', async () => {
  const { cocokkanRute } = await import(RUTE);
  assert.equal(cocokkanRute('/riwayat').layar, 'K-08');
  assert.equal(cocokkanRute('/riwayat/x').layar, 'K-09');
});

// Segmen parameter yang KOSONG bukan detail transaksi. Tanpa aturan ini,
// `/riwayat/` membuka layar detail dengan orderId '' -- dan query yang dibangun
// darinya mencari order ber-id kosong, lalu menampilkan empty state yang salah
// alih-alih daftar riwayat.
test('segmen parameter kosong tidak dianggap cocok', async () => {
  const { cocokkanRute } = await import(RUTE);
  assert.equal(cocokkanRute('/riwayat/').layar, 'K-08');
});

test('garis miring di akhir tidak mengubah hasil', async () => {
  const { cocokkanRute } = await import(RUTE);
  assert.equal(cocokkanRute('/sync/').layar, 'K-14');
  assert.equal(cocokkanRute('/shift/buka/').layar, 'K-02');
});

// IA §7 menuliskan rute kasir BERSARANG di bawah `/kasir`. Apakah prefiks itu
// benar-benar muncul di pathname bergantung pada bagaimana aplikasi disajikan
// -- Tauri menyajikannya dari root. Daripada menebak salah satu bacaan,
// pencocokan menerima keduanya dan prefiksnya dicatat sebagai konstanta.
test('prefiks /kasir dari IA §7 diterima, dengan atau tanpa', async () => {
  const { cocokkanRute, BASIS } = await import(RUTE);
  assert.equal(BASIS, '/kasir');
  assert.equal(cocokkanRute('/kasir/sync').layar, 'K-14');
  assert.equal(cocokkanRute('/kasir').layar, 'K-03');
  assert.equal(cocokkanRute('/kasir/').layar, 'K-03');
  assert.equal(cocokkanRute('/kasir/riwayat/ord-9').params.orderId, 'ord-9');
});

test('query dan fragment diabaikan, bukan dianggap bagian jalur', async () => {
  const { cocokkanRute } = await import(RUTE);
  assert.equal(cocokkanRute('/sync?dari=topbar').layar, 'K-14');
  assert.equal(cocokkanRute('/sync#antrean').layar, 'K-14');
});

// Rute tak dikenal TIDAK BOLEH diam-diam jatuh ke layar kasir. Kasir yang
// mengetik rute salah lalu mendapat grid produk tidak punya cara tahu bahwa
// navigasinya gagal.
test('rute tak dikenal punya layarnya sendiri', async () => {
  const { cocokkanRute } = await import(RUTE);
  const hasil = cocokkanRute('/tidak-ada');
  assert.equal(hasil.layar, 'TIDAK-DITEMUKAN');
  assert.deepEqual(hasil.params, {});
});

test('tabel rute konsisten: jalur unik, kode layar unik', async () => {
  const { TABEL_RUTE } = await import(RUTE);
  const jalur = TABEL_RUTE.map((r) => r.jalur);
  const layar = TABEL_RUTE.map((r) => r.layar);
  assert.equal(new Set(jalur).size, jalur.length, 'ada jalur ganda');
  assert.equal(new Set(layar).size, layar.length, 'ada kode layar ganda');
  assert.ok(
    jalur.every((j) => j.startsWith('/')),
    'setiap jalur harus absolut'
  );
});

// Penjaga terhadap IA, bukan terhadap diri sendiri. Kalau `IA-lumi-pos-v1.md`
// §7 bertambah atau berkurang rute kasir, test ini merah -- dan itulah yang
// memaksa tabel di kode ikut diperbarui alih-alih hanyut diam-diam.
test('tabel rute cocok dengan daftar URL di IA §7', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { TABEL_RUTE, BASIS } = await import(RUTE);

  const ia = fs.readFileSync(
    path.join(__dirname, '..', '..', 'product', 'IA-lumi-pos-v1.md'),
    'utf8'
  );

  // Blok `/kasir` di dalam pagar kode "Struktur URL": baris berindentasi
  // sampai blok aplikasi berikutnya (`/app`).
  const mulai = ia.indexOf('\n/kasir');
  assert.ok(mulai > 0, 'blok /kasir tidak ditemukan di IA §7');
  const sisa = ia.slice(mulai + 1);
  const akhir = sisa.indexOf('\n/app');
  assert.ok(akhir > 0, 'blok /app tidak ditemukan setelah /kasir');

  const dariIa = sisa
    .slice(0, akhir)
    .split('\n')
    .slice(1) // baris `/kasir` sendiri
    .map((b) => b.trim().split(/\s{2,}/)[0].trim())
    .filter((b) => b.startsWith('/'));

  assert.deepEqual(
    [...dariIa].sort(),
    [...TABEL_RUTE.map((r) => r.jalur)].sort(),
    `IA §7 dan TABEL_RUTE berbeda (basis ${BASIS})`
  );
});
