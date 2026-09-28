'use strict';

// FR-E4/E5 — pemeriksaan stok SEBELUM kuantitas naik. Satu fungsi murni yang
// dipakai ketukan kartu (`pilihVariation`) DAN tombol + Edit Item, supaya
// keduanya mengucapkan kalimat yang sama dan tidak ada jalur kedua yang
// melewatinya (spec kasir § 6, R6).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../apps/kasir/src/kasir/batas-stok.ts';
const DOMAIN = '../../packages/domain/src/profil-vertikal.ts';

function dasar(sisip = {}) {
  return {
    namaItem: 'Kopi Susu',
    variationId: 'v1',
    lacakStok: true,
    dimintaMilli: 2000,
    stok: new Map([['v1', 3000]]),
    habis: new Set(),
    bolehNegatif: false,
    ...sisip,
  };
}

test('⛔ habis diperiksa SEBELUM stok terhitung', async () => {
  const { periksaTambahStok } = await import(MOD);
  // Stok melimpah (3000 >= 2000) dan tetap ditolak: penandaan habis manual
  // tidak pernah disimpulkan dari stok terhitung (spec-e:217, FR-E5).
  const h = periksaTambahStok(dasar({ habis: new Set(['v1']) }));
  assert.equal(h.boleh, false, 'variation ditandai habis tetapi + diizinkan (stok terhitung mengalahkan penandaan)');
  assert.equal(h.pesan, 'Kopi Susu ditandai habis. Manajer dapat membuka kembali penandaannya.');
  // Bahkan bila boleh negatif dan stok tidak dilacak: penandaan tetap memblokir.
  const h2 = periksaTambahStok(dasar({ habis: new Set(['v1']), bolehNegatif: true, lacakStok: false }));
  assert.equal(h2.boleh, false, 'penandaan habis dikalahkan bolehNegatif/lacakStok');
});

test('⛔ stok kurang + tidak boleh negatif → ditolak dengan kalimat FR-E4 berangka', async () => {
  const { periksaTambahStok } = await import(MOD);
  const h = periksaTambahStok(dasar({ dimintaMilli: 4000 }));
  assert.equal(h.boleh, false);
  assert.equal(h.pesan, 'Kopi Susu tersisa 3. Tidak dapat menambah lagi.');
});

test('boleh negatif → boleh + peringatan, tidak memblokir', async () => {
  const { periksaTambahStok } = await import(MOD);
  const h = periksaTambahStok(dasar({ dimintaMilli: 4000, bolehNegatif: true }));
  assert.equal(h.boleh, true, 'peringatan stok memblokir penjualan (spec-e:146: TIDAK boleh)');
  assert.equal(h.peringatan, 'Stok Kopi Susu tersisa 3');
  // Stok cukup → boleh tanpa peringatan.
  const ok = periksaTambahStok(dasar({ dimintaMilli: 3000 }));
  assert.deepEqual(ok, { boleh: true, peringatan: null });
});

test('stok tidak dilacak → selalu boleh', async () => {
  const { periksaTambahStok } = await import(MOD);
  const h = periksaTambahStok(dasar({ lacakStok: false, dimintaMilli: 999000, stok: new Map() }));
  assert.deepEqual(h, { boleh: true, peringatan: null });
});

test('variation tanpa catatan stok dibaca 0 (sama dengan Kasir.tsx), bukan tak terbatas', async () => {
  const { periksaTambahStok } = await import(MOD);
  const h = periksaTambahStok(dasar({ stok: new Map(), dimintaMilli: 1000 }));
  assert.equal(h.boleh, false);
  assert.equal(h.pesan, 'Kopi Susu tersisa 0. Tidak dapat menambah lagi.');
});

test('property: keputusan sama dengan keputusanStok untuk seluruh kombinasi', async () => {
  const { periksaTambahStok } = await import(MOD);
  const { keputusanStok } = await import(DOMAIN);
  let kasus = 0;
  for (const stokMilli of [0, 500, 1000, 3000]) {
    for (const dimintaMilli of [1000, 2000, 4000]) {
      for (const bolehNegatif of [true, false]) {
        for (const lacakStok of [true, false]) {
          kasus += 1;
          const acuan = keputusanStok({ stokMilli, dimintaMilli, bolehNegatif, lacakStok });
          const h = periksaTambahStok(
            dasar({ stok: new Map([['v1', stokMilli]]), dimintaMilli, bolehNegatif, lacakStok })
          );
          const nama = `stok=${stokMilli} diminta=${dimintaMilli} negatif=${bolehNegatif} lacak=${lacakStok}`;
          assert.equal(h.boleh, acuan.boleh, `boleh menyimpang dari keputusanStok (${nama})`);
          if (h.boleh) {
            assert.equal(
              h.peringatan !== null,
              acuan.peringatan,
              `peringatan menyimpang dari keputusanStok (${nama})`
            );
          } else {
            assert.ok(h.pesan.includes(`tersisa ${acuan.sisaMilli / 1000}`), `pesan tak menyebut sisa (${nama}): ${h.pesan}`);
          }
        }
      }
    }
  }
  assert.equal(kasus, 48, 'jumlah kombinasi bukan 48 — enumerasi berubah tanpa disadari');
});
