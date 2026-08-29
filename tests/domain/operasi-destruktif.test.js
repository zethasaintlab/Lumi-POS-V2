'use strict';

// FR-H4 [P0] — blokir operasi destruktif saat antrean tidak kosong.
// `spec-h:270`.
//
// "Pelajaran langsung dari daftar 'jangan' milik Toast, di mana instruksi
// manual melindungi data. Lumi POS menegakkannya secara TEKNIS, bukan lewat
// dokumentasi."
//
// ⛔ Yang paling menentukan di berkas ini bukan blokirnya, melainkan apa yang
// TIDAK diblokir: alamat server dan kredensial perangkat. Keduanya adalah
// jalan memperbaiki antrean yang macet, dan memblokirnya karena antreannya
// tidak kosong mengunci merchant di dalam keadaan itu selamanya.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../packages/domain/src/operasi-destruktif.ts';

const IDENTITAS = { tenantId: 't1', outletId: 'o1', deviceId: 'd1' };

test('antrean kosong: keempat operasi diizinkan', async () => {
  const { OPERASI_DESTRUKTIF, periksaOperasiDestruktif } = await import(MOD);
  assert.equal(OPERASI_DESTRUKTIF.length, 4, 'daftar operasi berubah tanpa test menyusul');
  for (const op of OPERASI_DESTRUKTIF) {
    const izin = periksaOperasiDestruktif(op, { jumlahBelumTerkirim: 0 });
    assert.equal(izin.boleh, true, `${op} diblokir padahal antrean kosong`);
    assert.equal(izin.pesan, '');
  }
});

test('⛔ antrean tidak kosong: KEEMPAT operasi diblokir (AC pertama)', async () => {
  const { OPERASI_DESTRUKTIF, periksaOperasiDestruktif } = await import(MOD);
  for (const op of OPERASI_DESTRUKTIF) {
    assert.equal(
      periksaOperasiDestruktif(op, { jumlahBelumTerkirim: 1 }).boleh,
      false,
      `${op} lolos padahal ada 1 item tertunda`
    );
  }
});

test('⛔ pesan menyebut JUMLAH, bukan kalimat generik (AC kedua)', async () => {
  const { OPERASI_DESTRUKTIF, periksaOperasiDestruktif } = await import(MOD);
  // Kasir yang tidak tahu berapa banyak tidak dapat menilai apakah menunggu
  // sebentar cukup atau harus memanggil manajer.
  for (const op of OPERASI_DESTRUKTIF) {
    const { pesan } = periksaOperasiDestruktif(op, { jumlahBelumTerkirim: 14 });
    assert.match(pesan, /14/, `pesan ${op} tidak menyebut jumlahnya`);
  }
});

test('⛔ pesan menawarkan JALAN KELUAR (AC keempat)', async () => {
  const { OPERASI_DESTRUKTIF, periksaOperasiDestruktif } = await import(MOD);
  // `spec-h:290`: "[Coba kirim sekarang] dan [Ekspor darurat]". Blokir tanpa
  // jalan keluar adalah tombol mati tanpa keterangan — dan yang menemuinya
  // akan mencari jalan pintas di luar aplikasi.
  for (const op of OPERASI_DESTRUKTIF) {
    const { pesan } = periksaOperasiDestruktif(op, { jumlahBelumTerkirim: 3 });
    assert.match(pesan, /[Ee]kspor darurat/, `pesan ${op} tidak menawarkan ekspor darurat`);
  }
});

test('setiap operasi menjelaskan AKIBATNYA sendiri, bukan kalimat yang sama', async () => {
  const { OPERASI_DESTRUKTIF, periksaOperasiDestruktif } = await import(MOD);
  const pesan = OPERASI_DESTRUKTIF.map(
    (op) => periksaOperasiDestruktif(op, { jumlahBelumTerkirim: 2 }).pesan
  );
  assert.equal(new Set(pesan).size, pesan.length, 'ada dua operasi berpesan identik');
});

test('⛔ operasi tak dikenal DITOLAK, bukan diizinkan', async () => {
  const { periksaOperasiDestruktif } = await import(MOD);
  // Daftar tertutup yang gagal-TERBUKA tidak menjaga apa pun: operasi
  // destruktif berikutnya yang lahir akan lolos tanpa ada yang menyadarinya.
  assert.equal(periksaOperasiDestruktif('format_disk', { jumlahBelumTerkirim: 0 }).boleh, false);
});

// ---------------------------------------------------------------------------
// Identitas perangkat
// ---------------------------------------------------------------------------

test('⛔ alamat server dan kredensial TIDAK dihitung sebagai ganti identitas', async () => {
  const { identitasBerubah } = await import(MOD);
  // Server yang pindah alamat atau kredensial yang kedaluwarsa menghasilkan
  // antrean yang tidak dapat terkuras. Memblokir perbaikannya karena
  // antreannya tidak kosong adalah kunci yang tidak punya kunci pembuka.
  assert.equal(
    identitasBerubah(IDENTITAS, { ...IDENTITAS, baseUrl: 'http://baru', tokenSecret: 'x' }),
    false
  );
});

test('⛔ `deviceCode` bukan identitas — ia hanya prefiks nomor struk', async () => {
  const { identitasBerubah } = await import(MOD);
  // Memasukkannya membuat merchant yang memperbaiki salah ketik "K1" → "K2"
  // terkunci sampai antreannya kosong.
  assert.equal(identitasBerubah(IDENTITAS, { ...IDENTITAS, deviceCode: 'K9' }), false);
});

test('tenant, outlet, dan device masing-masing menghitung', async () => {
  const { identitasBerubah } = await import(MOD);
  assert.equal(identitasBerubah(IDENTITAS, { ...IDENTITAS, tenantId: 't2' }), true);
  assert.equal(identitasBerubah(IDENTITAS, { ...IDENTITAS, outletId: 'o2' }), true);
  assert.equal(identitasBerubah(IDENTITAS, { ...IDENTITAS, deviceId: 'd2' }), true);
});

test('⛔ perangkat yang BELUM pernah dikonfigurasi tidak dianggap berubah', async () => {
  const { identitasBerubah } = await import(MOD);
  // Provisioning pertama harus selalu lolos. Menganggapnya "ganti identitas"
  // membuat perangkat baru tidak dapat didaftarkan sama sekali bila entah
  // bagaimana sudah ada baris di antreannya.
  assert.equal(identitasBerubah(null, IDENTITAS), false);
});

test('⛔ logout memakai aturan yang SAMA, bukan salinannya', async () => {
  const { periksaOperasiDestruktif } = await import(MOD);
  const { bolehLogout } = await import('../../apps/kasir/src/identitas/login.ts');
  // Dua salinan menghasilkan dua kalimat berbeda untuk keadaan yang sama, dan
  // yang satu akan lupa menyebut jumlahnya.
  for (const n of [0, 1, 14]) {
    assert.deepEqual(
      bolehLogout({ jumlahBelumTerkirim: n }),
      periksaOperasiDestruktif('logout', { jumlahBelumTerkirim: n }),
      `bolehLogout menyimpang pada ${n} item`
    );
  }
});
