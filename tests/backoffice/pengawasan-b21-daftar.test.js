'use strict';

// B-21 — daftar delapan laporan exception (FR-G5) dan aturan tampilannya.
//
// `IA:200` menamai layarnya "Laporan Exception (8 laporan)". Sampai 23 Agustus
// 2026 hanya SATU di antaranya punya layar, sementara `spec-g:151` menyebut
// fitur ini "yang dibeli owner" — tujuh laporan yang endpointnya ada tapi tidak
// punya jalan masuk sama sekali.
//
// Yang diuji di sini bukan tata letaknya melainkan aturannya: apakah kedelapan
// laporan benar-benar terdaftar, apakah keadaan kosong masih dapat dibedakan
// dari kegagalan memuat pada SETIAP laporan, dan apakah kata-katanya tetap
// deskriptif sekarang setelah jumlahnya delapan kali lipat.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const AKAR = join(__dirname, '..', '..');
const DAFTAR = '../../apps/backoffice/src/pengawasan/b21-daftar.ts';

// ---------------------------------------------------------------------------
// Daftar
// ---------------------------------------------------------------------------

test('⛔ kedelapan laporan FR-G5 terdaftar, tidak satu pun hilang diam-diam', async () => {
  // `spec-g:149` menyebut delapan. Layar yang memuat tujuh terlihat lengkap —
  // yang hilang tidak meninggalkan ruang kosong di mana pun.
  const { LAPORAN } = await import(DAFTAR);
  assert.deepEqual(
    LAPORAN.map((l) => l.id),
    ['x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'x8']
  );
});

test('⛔ laporan yang TIDAK dapat dibangun tetap terdaftar, dengan alasannya', async () => {
  // X6 menuntut jejak keranjang, dan keranjang kasir hanya hidup di memori.
  // Menghilangkan tabnya membuat merchant yang membaca spec menyimpulkan
  // laporannya rusak — atau bahwa ia salah mencari. Batas yang dinyatakan
  // hanya berguna kalau ia terlihat di tempat orang mencarinya.
  const { definisi } = await import(DAFTAR);
  const x6 = definisi('x6');
  assert.equal(x6.endpoint, null);
  assert.ok(x6.alasanTidakAda.length > 40, 'X6 tanpa alasan yang dapat dibaca');
  assert.match(x6.alasanTidakAda, /memori|telemetri/i);
});

test('setiap laporan yang punya endpoint punya kunci baris dan catatan', async () => {
  const { LAPORAN } = await import(DAFTAR);
  for (const l of LAPORAN.filter((x) => x.endpoint !== null)) {
    assert.notEqual(l.kunci, '', `${l.id} tanpa kunci baris`);
    assert.ok(l.catatan.length > 0, `${l.id} tanpa catatan penjelas`);
    assert.ok(l.kosong.judul.length > 0, `${l.id} tanpa judul keadaan kosong`);
  }
});

test('⛔ setiap endpoint benar-benar ada di kontrak OpenAPI', async () => {
  // Path yang salah ketik menghasilkan 404 yang layarnya tampilkan sebagai
  // "laporan tidak dapat dimuat" — bentuk kegagalan yang tidak dapat
  // dibedakan dari server mati, dan yang tidak satu pun test lain lihat.
  const { LAPORAN } = await import(DAFTAR);
  const spec = readFileSync(join(AKAR, 'packages', 'contracts', 'openapi.yaml'), 'utf8');
  for (const l of LAPORAN) {
    if (l.endpoint === null) continue;
    assert.ok(spec.includes(`\n  ${l.endpoint}:`), `endpoint ${l.endpoint} tidak ada di OpenAPI`);
  }
});

test('id yang tidak dikenal MELEMPAR, tidak mengembalikan laporan pertama', async () => {
  const { definisi } = await import(DAFTAR);
  assert.throws(() => definisi('x9'), RangeError);
});

// ---------------------------------------------------------------------------
// Baris
// ---------------------------------------------------------------------------

test('⛔ X3 MENYARANG barisnya, dan "nol baris" tidak boleh salah dibaca', async () => {
  // Pembungkus `exceptionHandlers` menaruh hasil X3 di bawah kunci `laporan`,
  // dan hasil itu sendiri sebuah objek `{ambang, jumlahSeluruhRefund, refund}`.
  // Membaca `hasil[kunci]` apa adanya menghasilkan objek, `objek.length` adalah
  // `undefined`, dan `undefined > 0` adalah `false`: layar berkata "tidak ada
  // refund" untuk periode yang penuh refund — tanpa satu pun error.
  const { barisLaporan, definisi } = await import(DAFTAR);
  const hasil = {
    from: '2026-08-10',
    to: '2026-08-10',
    outletId: null,
    laporan: { ambang: '50000', jumlahSeluruhRefund: 9, refund: [{ refundId: 'r1' }] },
  };
  assert.equal(barisLaporan(definisi('x3'), hasil).length, 1);
});

test('bentuk larik biasa dibaca apa adanya', async () => {
  const { barisLaporan, definisi } = await import(DAFTAR);
  assert.equal(barisLaporan(definisi('x2'), { void: [{ auditId: 'a' }, { auditId: 'b' }] }).length, 2);
  assert.equal(barisLaporan(definisi('x4'), { perKasir: [] }).length, 0);
});

test('respons tanpa kunci yang dicari dibaca NOL baris, bukan melempar', async () => {
  // Layar yang jatuh karena satu field tak terduga lebih buruk daripada layar
  // yang menampilkan keadaan kosong — dan keadaan kosongnya menyebut
  // kemungkinan data belum sampai.
  const { barisLaporan, definisi } = await import(DAFTAR);
  assert.deepEqual(barisLaporan(definisi('x5'), {}), []);
  assert.deepEqual(barisLaporan(definisi('x6'), {}), []);
});

// ---------------------------------------------------------------------------
// Keadaan layar — untuk KEDELAPAN laporan
// ---------------------------------------------------------------------------

test('⛔ keadaan kosong SETIAP laporan menyebut kemungkinan belum tersinkronisasi', async () => {
  // Aturan yang dulu hidup di satu fungsi untuk satu laporan. Delapan salinan
  // berarti tujuh kesempatan melupakannya — dan yang lupa membuat kegagalan
  // sinkronisasi terbaca sebagai pembebasan orang yang namanya tidak muncul.
  const { LAPORAN, pesanLaporan } = await import(DAFTAR);
  const kosong = { from: '2026-08-10', to: '2026-08-12', outletId: null };

  for (const l of LAPORAN.filter((x) => x.endpoint !== null)) {
    const p = pesanLaporan(l, { jenis: 'siap', hasil: kosong }, () => 'Kopi Pagi Menteng');
    assert.notEqual(p, null, `${l.id} tidak menghasilkan keadaan kosong`);
    assert.match(p.badan, /sinkron/i, `${l.id} tidak menyebut sinkronisasi`);
    assert.ok(p.badan.includes('Kopi Pagi Menteng'), `${l.id} tidak menyebut lingkupnya`);
    assert.ok(p.badan.includes('2026-08-10'), `${l.id} tidak menyebut rentangnya`);
    assert.ok(p.badan.includes('2026-08-12'), `${l.id} tidak menyebut akhir rentangnya`);
  }
});

test('⛔ KOSONG, GAGAL, dan BELUM DIMUAT berbeda pada setiap laporan', async () => {
  const { LAPORAN, pesanLaporan } = await import(DAFTAR);
  const nama = () => 'Semua outlet';

  for (const l of LAPORAN.filter((x) => x.endpoint !== null)) {
    const kosong = pesanLaporan(
      l,
      { jenis: 'siap', hasil: { from: '2026-08-10', to: '2026-08-10', outletId: null } },
      nama
    );
    const galat = pesanLaporan(l, { jenis: 'galat', pesan: 'Koneksi putus.' }, nama);
    const awal = pesanLaporan(l, { jenis: 'awal' }, nama);
    const judul = new Set([kosong.judul, galat.judul, awal.judul]);
    assert.equal(judul.size, 3, `${l.id} menyamakan dua keadaan yang berbeda`);
    assert.match(galat.badan, /Koneksi putus\./);
  }
});

test('⛔ laporan tanpa endpoint SELALU menjelaskan dirinya, apa pun keadaannya', async () => {
  // Termasuk saat keadaan menyisakan hasil laporan sebelumnya: berpindah ke
  // tab X6 tidak boleh menampilkan tabel refund yang baru saja dilihat.
  const { definisi, pesanLaporan } = await import(DAFTAR);
  const x6 = definisi('x6');
  for (const keadaan of [
    { jenis: 'awal' },
    { jenis: 'memuat' },
    { jenis: 'galat', pesan: 'Koneksi putus.' },
    { jenis: 'siap', hasil: { perKasir: [{ userId: 'u1' }] } },
  ]) {
    const p = pesanLaporan(x6, keadaan, () => 'x');
    assert.equal(p.badan, x6.alasanTidakAda, `X6 keadaan ${keadaan.jenis} tidak menjelaskan diri`);
  }
});

test('ada data → tidak ada pesan, tabel yang dirender', async () => {
  const { definisi, pesanLaporan } = await import(DAFTAR);
  const p = pesanLaporan(
    definisi('x7'),
    { jenis: 'siap', hasil: { from: 'a', to: 'a', outletId: null, perKasir: [{ userId: 'u1' }] } },
    () => 'x'
  );
  assert.equal(p, null);
});

// ---------------------------------------------------------------------------
// Aturan tampilan
// ---------------------------------------------------------------------------

test('⛔ void sesudah tutup dibaca sebagai KATA, bukan angka negatif', async () => {
  // Server mengirim menit NEGATIF untuk void sesudah penutupan. "−12 menit
  // sebelum tutup" menuntut pembaca menerjemahkan tanda minus sendiri, di
  // laporan yang dipakai untuk memutuskan apakah perlu bicara dengan seseorang.
  const { jarakTutupTampil, posisiTampil } = await import(DAFTAR);
  assert.equal(jarakTutupTampil(-12), '12 menit sesudah tutup');
  assert.equal(jarakTutupTampil(7), '7 menit sebelum tutup');
  assert.equal(jarakTutupTampil(null), '—');
  assert.equal(posisiTampil('sesudah_tutup'), 'Sesudah shift ditutup');
  assert.equal(posisiTampil('akhir_shift'), '60 menit terakhir');
});

test('⛔ tren DATAR berbunyi "belum menunjukkan arah", bukan "stabil"', async () => {
  // `arahTren` mengembalikan `datar` juga untuk deret yang terlalu pendek.
  // Kasir dengan dua shift yang dilabeli "stabil" memberi pembaca keyakinan
  // yang tidak dimiliki datanya.
  const { trenTampil } = await import(DAFTAR);
  assert.match(trenTampil('datar'), /belum menunjukkan arah/i);
  assert.doesNotMatch(trenTampil('datar'), /stabil|aman|wajar/i);
  assert.match(trenTampil('naik'), /lebih/i);
  assert.match(trenTampil('turun'), /kurang/i);
});

test('⛔ selisih kas disebut dengan KATA, bukan hanya tanda minus', async () => {
  const { arahSelisih } = await import(DAFTAR);
  assert.equal(arahSelisih('-50000'), 'kurang');
  assert.equal(arahSelisih('50000'), 'lebih');
  assert.equal(arahSelisih('0'), 'pas');
  assert.equal(arahSelisih(''), 'pas');
});

test('⛔ arah selisih jam disebutkan — maju dan mundur bukan hal yang sama', async () => {
  // "Maju 62 menit" dan "mundur 62 menit" menempatkan transaksi di shift yang
  // berbeda.
  const { skewTampil } = await import(DAFTAR);
  assert.equal(skewTampil(45), 'maju 45 detik');
  assert.equal(skewTampil(-45), 'mundur 45 detik');
  assert.equal(skewTampil(3720), 'maju 1 jam 2 menit');
  assert.equal(skewTampil(-7200), 'mundur 2 jam');
});

test('sebaran alasan memakai label yang sama dengan X1', async () => {
  const { ringkasSebaran } = await import(DAFTAR);
  assert.equal(
    ringkasSebaran([
      { reasonCode: 'salah_input', jumlah: 4 },
      { reasonCode: 'lainnya', jumlah: 1 },
    ]),
    'Salah input 4× · Lainnya 1×'
  );
  assert.equal(ringkasSebaran([]), '—');
});

// ---------------------------------------------------------------------------
// ⛔ Bahasa
// ---------------------------------------------------------------------------

const MENUDUH =
  /curiga|suspicious|fraud|penipuan|mencurigakan|pelanggar|nakal|abuse|kecurangan|maling|skor/i;

test('⛔ tidak ada bahasa menuduh di JUDUL, deskripsi, catatan, atau keadaan kosong', async () => {
  // `spec-g:168`: "produk yang menuduh karyawan merchant akan merusak hubungan
  // merchant dengan stafnya."
  //
  // Penjaga ini membaca DATA, bukan berkas: laporan kesembilan yang ditambahkan
  // kelak akan diperiksa tanpa siapa pun mengingat penjaga ini ada.
  const { LAPORAN } = await import(DAFTAR);
  for (const l of LAPORAN) {
    for (const [nama, teks] of [
      ['tab', l.tab],
      ['judul', l.judul],
      ['deskripsi', l.deskripsi],
      ['catatan', l.catatan],
      ['kosong.judul', l.kosong.judul],
      ['kosong.benda', l.kosong.benda],
      ['kosong.simpul', l.kosong.simpul],
      ['alasanTidakAda', l.alasanTidakAda ?? ''],
    ]) {
      assert.doesNotMatch(teks, MENUDUH, `bahasa menuduh di ${l.id}.${nama}`);
    }
  }
});

test('⛔ setiap judul menyatakan APA YANG DIHITUNG, bukan kesimpulannya', async () => {
  // Judul adalah satu-satunya bagian laporan yang ikut tercetak dan ikut
  // dibicarakan. "Void di ujung shift" menyatakan fakta; "Void mencurigakan"
  // adalah kesimpulan yang ditarik sistem atas nama manusia.
  const { LAPORAN } = await import(DAFTAR);
  const VONIS = /wajar|tidak wajar|bermasalah|perlu ditindak|melanggar|tinggi sekali/i;
  for (const l of LAPORAN) {
    assert.doesNotMatch(l.judul, VONIS, `${l.id} berjudul kesimpulan`);
    assert.ok(l.tab.length <= 16, `tab ${l.id} terlalu panjang untuk delapan tab sebaris`);
  }
});
