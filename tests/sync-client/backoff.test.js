'use strict';

// T6 -- spec-h:62-63:
//
//   "Exponential backoff: 2s, 4s, 8s, 16s, 32s, 60s, lalu tetap 60s."
//   "Setelah 20 percobaan gagal, status menjadi `failed` ... Item `failed`
//    TIDAK dihapus."
//
// Tangga ini diketik ulang dari spec, bukan diimpor dari implementasi. Kalau
// test dan kode lahir dari sumber yang sama, keduanya bisa salah bersamaan.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const BACKOFF = '../../packages/sync-client/src/backoff.ts';

const TANGGA_MENURUT_SPEC = [2, 4, 8, 16, 32, 60];
const BATAS_PERCOBAAN = 20;

test('jeda mengikuti tangga spec, lalu tetap 60 detik', async () => {
  const { jedaBackoffMs, BATAS_PERCOBAAN_GAGAL } = await import(BACKOFF);

  // Percobaan ke-1 yang gagal -> jeda pertama di tangga.
  TANGGA_MENURUT_SPEC.forEach((detik, i) => {
    assert.equal(
      jedaBackoffMs(i + 1),
      detik * 1000,
      `setelah percobaan ke-${i + 1} jedanya harus ${detik}s`
    );
  });

  // "lalu tetap 60s" -- diperiksa sampai jauh melewati ujung tangga, bukan
  // hanya satu langkah sesudahnya.
  for (const attempts of [7, 8, 12, 19, 20, 50]) {
    assert.equal(jedaBackoffMs(attempts), 60_000, `percobaan ke-${attempts} harus tetap 60s`);
  }

  assert.equal(BATAS_PERCOBAAN_GAGAL, BATAS_PERCOBAAN);
});

test('jeda tidak pernah negatif atau nol', async () => {
  const { jedaBackoffMs } = await import(BACKOFF);
  for (let a = 0; a <= 25; a += 1) {
    assert.ok(jedaBackoffMs(a) > 0, `percobaan ke-${a} menghasilkan jeda ${jedaBackoffMs(a)}`);
  }
});

// Jatuh-tempo dihitung dari `last_attempt_at`, BUKAN dari kolom
// `next_attempt_at` yang disimpan. Menyimpannya berarti dua sumber kebenaran
// yang harus dijaga tetap sepakat; menurunkannya membuat tangga hidup di satu
// tempat saja.
test('sudahJatuhTempo: item baru selalu jatuh tempo', async () => {
  const { sudahJatuhTempo } = await import(BACKOFF);
  assert.equal(sudahJatuhTempo({ attempts: 0, last_attempt_at: null }, 1_000_000), true);
});

test('sudahJatuhTempo menghormati jeda sejak percobaan terakhir', async () => {
  const { sudahJatuhTempo } = await import(BACKOFF);
  const t0 = Date.parse('2026-08-08T10:00:00.000Z');
  const baris = { attempts: 1, last_attempt_at: '2026-08-08T10:00:00.000Z' };

  assert.equal(sudahJatuhTempo(baris, t0 + 1_999), false, '1,999 detik belum cukup');
  assert.equal(sudahJatuhTempo(baris, t0 + 2_000), true, 'tepat 2 detik sudah jatuh tempo');
  assert.equal(sudahJatuhTempo(baris, t0 + 10_000), true);

  const baris6 = { attempts: 6, last_attempt_at: '2026-08-08T10:00:00.000Z' };
  assert.equal(sudahJatuhTempo(baris6, t0 + 59_999), false);
  assert.equal(sudahJatuhTempo(baris6, t0 + 60_000), true);
});

// Jam perangkat dapat mundur (koreksi NTP, pengguna mengubah tanggal). Item
// yang `last_attempt_at`-nya di MASA DEPAN tidak boleh terkunci selamanya --
// antrean yang berhenti karena jam salah adalah penjualan yang tidak pernah
// naik, dan tidak ada yang akan menghubungkannya dengan jam.
test('sudahJatuhTempo: jam mundur tidak mengunci antrean selamanya', async () => {
  const { sudahJatuhTempo } = await import(BACKOFF);
  const sekarang = Date.parse('2026-08-08T10:00:00.000Z');
  const dariMasaDepan = { attempts: 3, last_attempt_at: '2027-01-01T00:00:00.000Z' };
  assert.equal(sudahJatuhTempo(dariMasaDepan, sekarang), true);
});
