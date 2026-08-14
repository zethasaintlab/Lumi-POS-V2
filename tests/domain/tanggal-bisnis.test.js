'use strict';

// Tanggal bisnis — prasyarat K-02 (buka shift).
//
// `CLAUDE.md`: "Tanggal bisnis: berakhir saat tutup shift, bukan tengah
// malam. Default 04:00." Sampai sekarang `business_date` selalu DISUPLAI
// klien di kontrak API dan tidak ada satu pun kode yang menghitungnya —
// artinya aturan itu hidup hanya di dokumen.
//
// Ia murni dan dibagi server/klien: penjualan pukul 01:00 harus jatuh ke
// tanggal bisnis yang SAMA di layar kasir, di laporan, dan di nomor struk.
// Dua salinan aturan ini menghasilkan struk `K1-20260812-0001` untuk
// penjualan yang laporannya catat sebagai 11 Agustus.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../packages/domain/src/tanggal-bisnis.ts';

const JAKARTA = 'Asia/Jakarta'; // UTC+7, tanpa DST

test('sebelum pukul 04:00 masih tanggal bisnis KEMARIN', async () => {
  const { tanggalBisnis } = await import(MOD);

  // 01:30 waktu Jakarta pada 12 Agustus = 18:30 UTC 11 Agustus.
  // Kafe yang tutup pukul 02:00 masih menjual di "hari" 11 Agustus.
  assert.equal(
    tanggalBisnis(new Date('2026-08-11T18:30:00Z'), JAKARTA, '04:00'),
    '2026-08-11'
  );

  // 03:59 Jakarta 12 Agustus — masih 11 Agustus. Menit terakhir.
  assert.equal(
    tanggalBisnis(new Date('2026-08-11T20:59:00Z'), JAKARTA, '04:00'),
    '2026-08-11'
  );
});

test('pukul 04:00 tepat sudah tanggal bisnis BARU', async () => {
  const { tanggalBisnis } = await import(MOD);

  // 04:00 Jakarta 12 Agustus = 21:00 UTC 11 Agustus.
  // Batasnya inklusif ke bawah: 04:00 memulai hari baru, bukan mengakhirinya.
  // Kalau eksklusif, ada satu menit yang tidak masuk hari mana pun.
  assert.equal(
    tanggalBisnis(new Date('2026-08-11T21:00:00Z'), JAKARTA, '04:00'),
    '2026-08-12'
  );
});

test('siang hari = tanggal kalender yang sama', async () => {
  const { tanggalBisnis } = await import(MOD);

  // 14:00 Jakarta 11 Agustus = 07:00 UTC.
  assert.equal(
    tanggalBisnis(new Date('2026-08-11T07:00:00Z'), JAKARTA, '04:00'),
    '2026-08-11'
  );
});

test('⛔ dihitung di zona OUTLET, bukan zona perangkat', async () => {
  const { tanggalBisnis } = await import(MOD);

  // Momen yang sama, dua outlet di zona berbeda. Ini yang membuat fungsi
  // menerima timezone alih-alih memakai `Date` lokal: tablet yang zonanya
  // salah set (atau dikirim antar kota) akan menanggalkan penjualan ke hari
  // yang salah, dan `UNIQUE(device_id, business_date, sequence)` akan menolak
  // struk berikutnya dengan galat yang tidak menunjuk ke sebabnya sama sekali.
  const momen = new Date('2026-08-11T19:00:00Z'); // 02:00 Jakarta 12 Agu
  assert.equal(tanggalBisnis(momen, JAKARTA, '04:00'), '2026-08-11');
  // 19:00 UTC = 07:00 Jayapura (UTC+9) 12 Agustus -> sudah lewat 04:00
  assert.equal(tanggalBisnis(momen, 'Asia/Jayapura', '04:00'), '2026-08-12');
});

test('batas dapat dikonfigurasi per outlet', async () => {
  const { tanggalBisnis } = await import(MOD);

  // `outlet.business_day_ends_at` adalah kolom sungguhan; 04:00 hanya default.
  const momen = new Date('2026-08-11T22:30:00Z'); // 05:30 Jakarta 12 Agu
  assert.equal(tanggalBisnis(momen, JAKARTA, '04:00'), '2026-08-12');
  assert.equal(tanggalBisnis(momen, JAKARTA, '06:00'), '2026-08-11', 'batas 06:00 belum lewat');
  assert.equal(tanggalBisnis(momen, JAKARTA, '00:00'), '2026-08-12', 'batas tengah malam = kalender');
});

test('melintasi batas bulan dan tahun', async () => {
  const { tanggalBisnis } = await import(MOD);

  // 01:00 Jakarta 1 September = 18:00 UTC 31 Agustus -> masih 31 Agustus.
  assert.equal(tanggalBisnis(new Date('2026-08-31T18:00:00Z'), JAKARTA, '04:00'), '2026-08-31');
  // 01:00 Jakarta 1 Januari 2027 -> masih 31 Desember 2026.
  assert.equal(tanggalBisnis(new Date('2026-12-31T18:00:00Z'), JAKARTA, '04:00'), '2026-12-31');
});

test('bentuk batas yang tidak sah ditolak', async () => {
  const { tanggalBisnis } = await import(MOD);
  const momen = new Date('2026-08-11T07:00:00Z');

  // PostgreSQL mengembalikan `time` sebagai "04:00:00"; keduanya harus
  // diterima, karena nilainya datang dari kolom itu lewat replikasi.
  assert.equal(tanggalBisnis(momen, JAKARTA, '04:00:00'), '2026-08-11');

  for (const rusak of ['', '4', '25:00', 'pagi', null, undefined]) {
    assert.throws(() => tanggalBisnis(momen, JAKARTA, rusak), /batas/i, `harus tolak ${String(rusak)}`);
  }
});

test('nomor struk memakai tanggal bisnis, bukan tanggal kalender', async () => {
  const { nomorStruk } = await import(MOD);

  // `CLAUDE.md`: `K1-20260726-0007` — prefiks device + tanggal + urutan.
  assert.equal(nomorStruk('K1', '2026-07-26', 7), 'K1-20260726-0007');
  assert.equal(nomorStruk('K1', '2026-07-26', 1), 'K1-20260726-0001');
  // Urutan di atas 9999 tidak dipotong: memotongnya menghasilkan nomor struk
  // DUPLIKAT, dan `UNIQUE(device_id, business_date, sequence)` akan menolak
  // penjualan di tengah antrean.
  assert.equal(nomorStruk('K1', '2026-07-26', 12345), 'K1-20260726-12345');
});
