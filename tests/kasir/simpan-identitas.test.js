'use strict';

// FR-H4 — ganti identitas perangkat diblokir saat antrean tidak kosong.
// `spec-h:279`.
//
// ⛔ Test PERILAKU, bukan penjaga struktural. Versi pertama aturan ini hidup
// di dalam komponen `Perangkat.tsx` dan hanya dijaga penjaga yang memindai
// kode — lalu sabotase membuktikan penjaga itu lolos ketika pemanggilnya
// dihapus dan import-nya tertinggal. Pemeriksaan yang dapat dipalsukan oleh
// satu baris import bukan pemeriksaan.
//
// Karena itu aturannya dipindah ke `perangkat/simpan-identitas.ts`, bentuk
// yang sama dengan `keluar()` di `konteks/useSesi.ts`: satu fungsi yang
// membaca antrean tepat sebelum menulis.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../apps/kasir/src/perangkat/simpan-identitas.ts';

const LAMA = {
  device_id: 'd1', device_code: 'K1', tenant_id: 't1', outlet_id: 'o1',
  base_url: 'http://server', token_secret: 'rahasia',
};

const BARU = {
  deviceId: 'd1', deviceCode: 'K1', tenantId: 't1', outletId: 'o1',
  baseUrl: 'http://server', tokenSecret: 'rahasia',
};

function dbPalsu({ konfig = LAMA, menunggu = 0, gagal = 0 } = {}) {
  const state = { tulis: [] };
  return {
    state,
    async getAll(sql) {
      if (/FROM device_config/.test(sql)) return konfig === null ? [] : [konfig];
      if (/FROM outbox_local/.test(sql)) {
        // ⛔ `ringkasanAntrean` memakai SATU baris agregat, bukan satu baris
        // per item. Fake yang mengembalikan bentuk yang salah membuat
        // hitungannya nol — dan nol adalah jawaban yang membuat blokir FR-H4
        // terlihat berfungsi sambil tidak pernah menyala.
        return [{ menunggu, gagal, tertua: null, terakhir: null }];
      }
      return [];
    },
    async execute(sql, params = []) {
      state.tulis.push({ sql: sql.trim().split('\n')[0], params });
      return { rowsAffected: 1 };
    },
    async transaction(fn) {
      return fn(this);
    },
  };
}

test('antrean kosong: ganti outlet tersimpan', async () => {
  const { simpanIdentitasPerangkat } = await import(MOD);
  const db = dbPalsu();
  const hasil = await simpanIdentitasPerangkat(db, { ...BARU, outletId: 'o2' });

  assert.equal(hasil.berhasil, true, hasil.pesan);
  assert.ok(db.state.tulis.some((t) => /device_config/.test(t.sql)), 'tidak ada penulisan');
});

test('⛔ antrean tidak kosong: ganti outlet DITOLAK, dan tidak menulis apa pun', async () => {
  const { simpanIdentitasPerangkat } = await import(MOD);
  const db = dbPalsu({ menunggu: 14 });
  const hasil = await simpanIdentitasPerangkat(db, { ...BARU, outletId: 'o2' });

  assert.equal(hasil.berhasil, false);
  assert.match(hasil.pesan, /14/, 'pesan tidak menyebut jumlahnya');
  // Yang ditulis sebagian jauh lebih buruk daripada yang ditolak: antrean
  // lama akan dikirim atas nama outlet baru.
  assert.equal(db.state.tulis.length, 0, 'ada yang tertulis padahal ditolak');
});

test('⛔ item GAGAL ikut dihitung', async () => {
  const { simpanIdentitasPerangkat } = await import(MOD);
  // Item yang gagal terkirim tetap penjualan yang hanya ada di perangkat ini.
  // Menghitung yang menunggu saja membuat FR-H4 tidak berlaku pada keadaan
  // yang paling membutuhkannya.
  const db = dbPalsu({ menunggu: 0, gagal: 3 });
  const hasil = await simpanIdentitasPerangkat(db, { ...BARU, tenantId: 't2' });
  assert.equal(hasil.berhasil, false);
  assert.match(hasil.pesan, /3/);
});

test('⛔ ganti ALAMAT SERVER tetap boleh saat antrean penuh', async () => {
  const { simpanIdentitasPerangkat } = await import(MOD);
  // Server yang pindah alamat menghasilkan antrean yang tidak dapat terkuras.
  // Memblokir perbaikannya karena antreannya tidak kosong adalah kunci yang
  // tidak punya kunci pembuka.
  const db = dbPalsu({ menunggu: 14 });
  const hasil = await simpanIdentitasPerangkat(db, { ...BARU, baseUrl: 'http://server.baru' });
  assert.equal(hasil.berhasil, true, hasil.pesan);
});

test('⛔ ganti KREDENSIAL tetap boleh saat antrean penuh', async () => {
  const { simpanIdentitasPerangkat } = await import(MOD);
  // Kredensial yang kedaluwarsa adalah sebab antrean macet yang paling sering
  // — dan memperbaikinya justru cara mengurasnya.
  const db = dbPalsu({ gagal: 9 });
  const hasil = await simpanIdentitasPerangkat(db, { ...BARU, tokenSecret: 'baru' });
  assert.equal(hasil.berhasil, true, hasil.pesan);
});

test('⛔ ganti KODE PERANGKAT tetap boleh — ia hanya prefiks nomor struk', async () => {
  const { simpanIdentitasPerangkat } = await import(MOD);
  const db = dbPalsu({ menunggu: 2 });
  const hasil = await simpanIdentitasPerangkat(db, { ...BARU, deviceCode: 'K2' });
  assert.equal(hasil.berhasil, true, hasil.pesan);
});

test('perangkat yang BELUM dikonfigurasi selalu dapat didaftarkan', async () => {
  const { simpanIdentitasPerangkat } = await import(MOD);
  // Provisioning pertama harus selalu lolos; menganggapnya "ganti identitas"
  // membuat perangkat baru tidak dapat didaftarkan sama sekali.
  const db = dbPalsu({ konfig: null, menunggu: 5 });
  const hasil = await simpanIdentitasPerangkat(db, BARU);
  assert.equal(hasil.berhasil, true, hasil.pesan);
});

test('menyimpan nilai yang SAMA tidak dianggap ganti identitas', async () => {
  const { simpanIdentitasPerangkat } = await import(MOD);
  const db = dbPalsu({ menunggu: 7 });
  const hasil = await simpanIdentitasPerangkat(db, BARU);
  assert.equal(hasil.berhasil, true, hasil.pesan);
});
