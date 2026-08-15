'use strict';

// Id tenant yang diingat antar kunjungan.
//
// ⛔ Ia punya DUA penulis sejak B-00b ada: layar Masuk (setelah login berhasil)
// dan layar Daftar (setelah pendaftaran berhasil). Kunci `localStorage` yang
// hidup di salah satu berkas layar akan disalin ke yang lain, dan salinan yang
// menyimpang menghasilkan merchant yang baru mendaftar tetap disodori field
// kosong — persis keadaan yang B-00b dibuat untuk hilangkan.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../apps/backoffice/src/tenant-terakhir.ts';

function penyimpananPalsu(awal = {}) {
  const peta = new Map(Object.entries(awal));
  return {
    getItem: (k) => (peta.has(k) ? peta.get(k) : null),
    setItem: (k, v) => void peta.set(k, v),
    removeItem: (k) => void peta.delete(k),
  };
}

// ---------------------------------------------------------------------------

test('yang diingat dibaca kembali apa adanya', async () => {
  const { bacaTenantTerakhir, ingatTenant } = await import(MOD);
  const p = penyimpananPalsu();
  ingatTenant('018f2a10-0000-7000-8000-000000000001', p);
  assert.equal(bacaTenantTerakhir(p), '018f2a10-0000-7000-8000-000000000001');
});

test('penyimpanan kosong mengembalikan string kosong, bukan null', async () => {
  // Nilainya dipakai langsung sebagai `value` sebuah `<input>`. `null` di sana
  // membuat React berpindah dari uncontrolled ke controlled dan memuntahkan
  // peringatan di setiap ketikan.
  const { bacaTenantTerakhir } = await import(MOD);
  assert.equal(bacaTenantTerakhir(penyimpananPalsu()), '');
});

test('⛔ penyimpanan yang MELEMPAR tidak menjatuhkan layar', async () => {
  // Safari private mode melempar pada `setItem`, dan beberapa konfigurasi
  // privasi memblokir `localStorage` sama sekali. Yang hilang cukup
  // "diingat sampai kunjungan berikutnya"; yang tidak boleh hilang adalah
  // kemampuan mendaftar dan masuk.
  const { bacaTenantTerakhir, ingatTenant } = await import(MOD);
  const meledak = {
    getItem() {
      throw new Error('akses ditolak');
    },
    setItem() {
      throw new Error('kuota habis');
    },
    removeItem() {
      throw new Error('akses ditolak');
    },
  };

  assert.equal(bacaTenantTerakhir(meledak), '');
  assert.doesNotThrow(() => ingatTenant('apa pun', meledak));
});

test('⛔ nilai kosong TIDAK menimpa yang sudah diingat', async () => {
  // Layar Masuk memanggil `ingatTenant` dengan isian fieldnya, dan field itu
  // sekarang OPSIONAL — merchant yang masuk lewat resolusi email
  // mengirimkannya kosong. Menimpanya berarti pendaftaran yang baru saja
  // menyimpan id tenant kehilangannya pada login pertama.
  const { bacaTenantTerakhir, ingatTenant } = await import(MOD);
  const p = penyimpananPalsu();
  ingatTenant('018f2a10-0000-7000-8000-000000000001', p);
  ingatTenant('   ', p);
  assert.equal(bacaTenantTerakhir(p), '018f2a10-0000-7000-8000-000000000001');
});

test('kuncinya BERNAMA, dan namanya bagian dari kontrak', async () => {
  // Berkas ini menggantikan konstanta privat di `Masuk.tsx`. Kunci yang
  // berubah berarti merchant yang sudah pernah masuk kehilangan id tenantnya
  // tanpa satu pun error.
  const { KUNCI_TENANT_TERAKHIR } = await import(MOD);
  assert.equal(KUNCI_TENANT_TERAKHIR, 'lumi.backoffice.tenant-terakhir');
});
