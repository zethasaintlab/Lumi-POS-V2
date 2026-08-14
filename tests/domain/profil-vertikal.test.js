'use strict';

// OQ-09 — resolusi `VerticalProfile` per outlet dengan default tenant.
//
// `CLAUDE.md`: "VerticalProfile per outlet, mewarisi default tenant. Pusat
// menetapkan standar, cabang boleh override. Resolusi =
// `COALESCE(profil_outlet, profil_default_tenant)`."
//
// Ada di `packages/domain` karena FR-E4 menuntut peringatan stok bekerja saat
// kasir offline — jadi perangkat harus meresolusinya sendiri, dengan aturan
// yang sama persis dengan server.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../packages/domain/src/profil-vertikal.ts';

const profil = (over = {}) => ({
  id: 'p1',
  name: 'fnb',
  allowNegativeStock: true,
  isTenantDefault: false,
  ...over,
});

test('profil outlet MENANG atas default tenant', async () => {
  const { resolusiProfil } = await import(MOD);
  const hasil = resolusiProfil({
    profilOutlet: profil({ id: 'outlet', allowNegativeStock: false }),
    profilDefaultTenant: profil({ id: 'tenant', allowNegativeStock: true, isTenantDefault: true }),
  });
  assert.equal(hasil.id, 'outlet');
  assert.equal(hasil.allowNegativeStock, false);
});

test('tanpa profil outlet, default tenant yang dipakai', async () => {
  const { resolusiProfil } = await import(MOD);
  const hasil = resolusiProfil({
    profilOutlet: null,
    profilDefaultTenant: profil({ id: 'tenant', allowNegativeStock: false, isTenantDefault: true }),
  });
  assert.equal(hasil.id, 'tenant');
  assert.equal(hasil.allowNegativeStock, false);
});

test('⛔ tanpa profil apa pun: default F&B, dan ia DITANDAI sebagai default', async () => {
  // Perangkat yang katalognya belum turun penuh tidak boleh kehilangan
  // kemampuan menjual. Yang penting: hasilnya menyatakan bahwa ia jatuh ke
  // bawaan, supaya UI dapat mengatakannya alih-alih menampilkan aturan yang
  // tidak berasal dari konfigurasi merchant mana pun.
  const { resolusiProfil } = await import(MOD);
  const hasil = resolusiProfil({ profilOutlet: null, profilDefaultTenant: null });
  assert.equal(hasil.allowNegativeStock, true, 'default F&B: boleh negatif (spec-e:136)');
  assert.equal(hasil.dariBawaan, true, 'hasil tidak menyatakan bahwa ia bawaan');
});

test('hasil dari profil sungguhan TIDAK ditandai bawaan', async () => {
  const { resolusiProfil } = await import(MOD);
  const hasil = resolusiProfil({ profilOutlet: profil(), profilDefaultTenant: null });
  assert.equal(hasil.dariBawaan, false);
});

test('⛔ keputusan menambah ke keranjang: peringatan, bukan blokir (FR-E4)', async () => {
  // `spec-e:142-147`: stok 1, kasir menambah 3 → peringatan "Stok tersisa 1",
  // penjualan TETAP dapat diselesaikan, stok menjadi −2.
  const { keputusanStok } = await import(MOD);

  const k = keputusanStok({ stokMilli: 1000, dimintaMilli: 3000, bolehNegatif: true });
  assert.equal(k.boleh, true, 'penjualan harus tetap dapat diselesaikan');
  assert.equal(k.peringatan, true);
  assert.equal(k.sisaMilli, 1000, 'pesan menyebut sisa yang sebenarnya');
  assert.equal(k.maksimumMilli, null, 'tidak ada pembatasan kuantitas saat boleh negatif');
});

test('⛔ allow_negative_stock = false MEMBATASI kuantitas, dengan angkanya', async () => {
  // `spec-e:149-152`: qty maksimum dibatasi 1, "dengan pesan yang
  // menjelaskan" — jadi batasnya harus ikut terbawa, bukan sekadar `false`.
  const { keputusanStok } = await import(MOD);

  const k = keputusanStok({ stokMilli: 1000, dimintaMilli: 3000, bolehNegatif: false });
  assert.equal(k.boleh, false);
  assert.equal(k.maksimumMilli, 1000);
  assert.equal(k.sisaMilli, 1000);
});

test('stok cukup: tanpa peringatan, tanpa batas', async () => {
  const { keputusanStok } = await import(MOD);
  const k = keputusanStok({ stokMilli: 5000, dimintaMilli: 2000, bolehNegatif: false });
  assert.equal(k.boleh, true);
  assert.equal(k.peringatan, false);
  assert.equal(k.maksimumMilli, null);
});

test('⛔ stok yang SUDAH negatif tidak mengizinkan penjualan saat blokir aktif', async () => {
  // Maksimum tidak boleh negatif — "boleh menjual −2 unit" tidak berarti apa
  // pun, dan angka negatif di pesan kasir akan terbaca sebagai kesalahan
  // sistem.
  const { keputusanStok } = await import(MOD);
  const k = keputusanStok({ stokMilli: -2000, dimintaMilli: 1000, bolehNegatif: false });
  assert.equal(k.boleh, false);
  assert.equal(k.maksimumMilli, 0);
});

test('⛔ produk yang stoknya TIDAK dilacak tidak pernah diperingatkan', async () => {
  // FR-E2: variation ber-`track_stock = false` tidak punya movement sama
  // sekali, jadi `SUM(delta)` selalu 0. Memperlakukannya seperti stok habis
  // akan memblokir setiap produk jasa.
  const { keputusanStok } = await import(MOD);
  const k = keputusanStok({ stokMilli: 0, dimintaMilli: 3000, bolehNegatif: false, lacakStok: false });
  assert.equal(k.boleh, true);
  assert.equal(k.peringatan, false);
  assert.equal(k.maksimumMilli, null);
});
