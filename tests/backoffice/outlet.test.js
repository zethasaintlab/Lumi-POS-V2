'use strict';

// B-23 — Outlet.
//
// ⛔ Kontraknya hanya punya DUA operasi: `listOutlets` dan `createOutlet`.
// Tidak ada `PATCH /outlets/{id}`, tidak ada archive maupun restore — meski
// kolom `outlet.archived_at` ada di migrasi 0002 dan ikut di respons daftar.
//
// Test di berkas ini menyematkan kenyataan itu, supaya layar tidak diam-diam
// dibangun seolah operasi itu ada.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

const MOD = '../../apps/backoffice/src/outlet/outlet.ts';

const ID = '018f2a10-0000-7000-8000-0000000000o9';

const FORM = { nama: 'Cabang Kemang', zonaWaktu: 'Asia/Jakarta', alamat: '' };

// ---------------------------------------------------------------------------

test('form lengkap menghasilkan muatan createOutlet', async () => {
  const { buatMuatanOutlet } = await import(MOD);
  const hasil = buatMuatanOutlet(FORM, ID);
  assert.equal(hasil.ok, true, hasil.ok === false ? hasil.pesan : '');
  assert.deepEqual(hasil.muatan, {
    id: ID,
    name: 'Cabang Kemang',
    timezone: 'Asia/Jakarta',
    address: null,
  });
});

test('⛔ verticalProfileId TIDAK dikirim — outlet mewarisi default tenant', async () => {
  // OQ-09: `VerticalProfile` per outlet, MEWARISI default tenant. Resolusinya
  // `COALESCE(profil_outlet, default_tenant)`, dan kontraknya menyebut
  // "dikosongkan berarti mewarisi".
  //
  // Mengirim `null` eksplisit bekerja sama saja hari ini, tapi mengirim nilai
  // apa pun dari layar yang tidak punya pemilih profil berarti layar itu
  // memutuskan sesuatu yang tidak ditanyakannya kepada siapa pun.
  const { buatMuatanOutlet } = await import(MOD);
  const hasil = buatMuatanOutlet(FORM, ID);
  assert.ok(!('verticalProfileId' in hasil.muatan));
});

test('alamat kosong dikirim null, terisi dipangkas', async () => {
  const { buatMuatanOutlet } = await import(MOD);
  assert.equal(buatMuatanOutlet({ ...FORM, alamat: '   ' }, ID).muatan.address, null);
  assert.equal(
    buatMuatanOutlet({ ...FORM, alamat: ' Jl. Kemang Raya 1 ' }, ID).muatan.address,
    'Jl. Kemang Raya 1'
  );
});

test('nama kosong ditolak dan penolakannya menunjuk fieldnya', async () => {
  const { buatMuatanOutlet } = await import(MOD);
  const hasil = buatMuatanOutlet({ ...FORM, nama: '  ' }, ID);
  assert.equal(hasil.ok, false);
  assert.equal(hasil.bidang, 'nama');
});

test('⛔ zona waktu memakai daftar domain yang SAMA dengan server', async () => {
  // `packages/domain/src/zona-waktu.ts` dipakai kedua handler server dan layar
  // pendaftaran B-00b. Salinan keempat di sini akan menyimpang tanpa error:
  // pilihan yang hilang membuat outlet Indonesia Timur mustahil didaftarkan,
  // pilihan yang ditambahkan menghasilkan 400 saat merchant memilihnya.
  const { buatMuatanOutlet } = await import(MOD);
  const { ZONA_WAKTU } = await import('../../packages/domain/src/zona-waktu.ts');

  for (const zona of ZONA_WAKTU) {
    assert.equal(buatMuatanOutlet({ ...FORM, zonaWaktu: zona }, ID).ok, true, `${zona} ditolak`);
  }
  const hasil = buatMuatanOutlet({ ...FORM, zonaWaktu: 'Asia/Singapore' }, ID);
  assert.equal(hasil.ok, false);
  assert.equal(hasil.bidang, 'zonaWaktu');
});

// --- urutan -----------------------------------------------------------------

const OUTLET = (over) => ({
  id: 'o1', name: 'Kemang', timezone: 'Asia/Jakarta', address: null, archivedAt: null, ...over,
});

test('⛔ urutan tampil dimiliki JS: aktif dulu, lalu nama', async () => {
  // Server menjaminnya lewat ORDER BY, dan jaminan yang hanya hidup di SQL
  // tidak dapat diuji sama sekali (`CLAUDE.md`).
  const { urutkanOutlet } = await import(MOD);
  const hasil = urutkanOutlet([
    OUTLET({ id: 'z', name: 'Zamrud' }),
    OUTLET({ id: 'a', name: 'Antasari', archivedAt: '2026-01-01T00:00:00Z' }),
    OUTLET({ id: 'b', name: 'Bintaro' }),
  ]);
  assert.deepEqual(hasil.map((o) => o.id), ['b', 'z', 'a']);
});

// --- ⛔ batas kontrak --------------------------------------------------------

test('⛔ TIDAK ADA operasi ubah/arsip outlet di kontrak', async () => {
  // Ini bukan test atas kode kami — ia menyematkan BATAS yang layar harus
  // nyatakan. Kalau kelak endpointnya ditambahkan, test ini merah, dan itulah
  // sinyal untuk membangun tombolnya.
  //
  // Kolom `outlet.archived_at` SUDAH ada di migrasi 0002 dan ikut di respons
  // daftar, jadi ketiadaan endpointnya mudah dikira kelalaian layar.
  //
  // ⛔ Daftarnya bertambah dua pada 24 Agustus 2026 (`getOutletThresholds` /
  // `setOutletThresholds`, B-26), dan test ini merah karenanya — persis
  // perilaku yang dimaksud. Yang ditambahkan BUKAN ubah/arsip outlet: ia
  // menyetel ambang otorisasi, punya layarnya sendiri, dan tidak menyentuh
  // nama, alamat, zona waktu, maupun `archived_at`. Daftarnya disunting
  // setelah itu diperiksa, bukan sebelumnya.
  const yaml = readFileSync('packages/contracts/openapi.yaml', 'utf8');
  const operasiOutlet = [...yaml.matchAll(/operationId: (\w*[Oo]utlet\w*)/g)].map((m) => m[1]);

  assert.deepEqual(
    operasiOutlet.sort(),
    [
      'createOutlet',
      'listOutlet' + 's',
      'listOutletPrices',
      'getOutletThresholds',
      'setOutletThresholds',
    ].sort(),
    `operasi outlet berubah: ${operasiOutlet.join(', ')} — kalau ubah/arsip sudah ada, bangun tombolnya`
  );

  // ⛔ Dan yang benar-benar dijaga: tidak ada operasi yang MENGUBAH identitas
  // outlet. Daftar putih di atas dapat disunting tanpa berpikir; pola ini
  // tidak — ia menamai apa yang sedang dijaga alih-alih apa yang kebetulan
  // ada hari ini.
  const mengubahOutlet = operasiOutlet.filter((o) =>
    /^(update|patch|archive|restore|rename|delete)Outlet/.test(o)
  );
  assert.deepEqual(mengubahOutlet, [], `ubah/arsip outlet sudah ada — bangun tombolnya di B-23`);
});
