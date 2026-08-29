'use strict';

// B-21 — aturan tampilan X1 (void & refund per pelaku). Daftar kedelapan
// laporan dan aturan bersamanya diuji di `pengawasan-b21-daftar.test.js`.
//
// ⛔ Kenapa aturannya dipisahkan dari komponen: layar ini MENAMAI ORANG.
// Ia satu-satunya layar back-office yang menempatkan nama pegawai di sebelah
// angka yang dapat dibaca sebagai tuduhan, dan sejak keputusan 1 Agustus 2026
// menghapus PIN manajer dari void, ia satu-satunya kontrol terhadap
// penyalahgunaannya.
//
// Yang diuji di sini karena itu bukan "apakah tabelnya terisi" melainkan
// apakah kata-katanya tetap deskriptif, apakah angkanya tidak dihitung ulang
// di klien, dan apakah keadaan kosong dapat dibedakan dari kegagalan memuat.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const AKAR = join(__dirname, '..', '..');
const B21 = '../../apps/backoffice/src/pengawasan/b21.ts';
const DAFTAR = '../../apps/backoffice/src/pengawasan/b21-daftar.ts';

/** Keadaan layar dinilai lewat definisi laporannya — lihat `b21-daftar.ts`. */
async function pesanX1(keadaan, namaOutlet) {
  const { definisi, pesanLaporan } = await import(DAFTAR);
  return pesanLaporan(definisi('x1'), keadaan, namaOutlet);
}

// ---------------------------------------------------------------------------
// Label alasan
// ---------------------------------------------------------------------------

test('⛔ SETIAP kode alasan di domain punya label — daftarnya diturunkan', async () => {
  // Daftar alasan hidup di `packages/domain/src/cancellation.ts` dan ditegakkan
  // server sebagai daftar tertutup. Label di sini adalah salinan KEDUA, dan
  // salinan kedua bergeser: kode alasan yang ditambahkan kelak akan tampil
  // sebagai slug mentah ("pelanggan_tidak_puas") di laporan yang dibaca owner.
  //
  // Penjaga ini membaca daftarnya dari domain, bukan mengulanginya.
  const { LABEL_ALASAN } = await import(B21);
  const { VOID_REASON_CODES, REFUND_REASON_CODES } = await import(
    '../../packages/domain/src/cancellation.ts'
  );

  const hilang = [...VOID_REASON_CODES, ...REFUND_REASON_CODES].filter(
    (kode) => LABEL_ALASAN[kode] === undefined
  );
  assert.deepEqual(hilang, [], `kode alasan tanpa label: ${hilang.join(', ')}`);
});

test('kode tak dikenal tampil APA ADANYA, bukan kosong', async () => {
  // Baris lama dapat memuat kode yang sudah tidak ada di daftar. Sel kosong di
  // kolom Alasan terbaca seperti pembatalan tanpa alasan — persis keadaan yang
  // laporan ini cari.
  const { labelAlasan } = await import(B21);
  assert.equal(labelAlasan('kode_lama_2025'), 'kode_lama_2025');
  assert.equal(labelAlasan(null), 'Tanpa alasan');
});

test('label alasan dipakai untuk kode yang dikenal', async () => {
  const { labelAlasan } = await import(B21);
  assert.equal(labelAlasan('salah_input'), 'Salah input');
  assert.equal(labelAlasan('pelanggan_tidak_puas'), 'Pelanggan tidak puas');
});

test('ringkasan alasan terbaca sebagai satu baris', async () => {
  const { ringkasAlasan } = await import(B21);
  assert.equal(
    ringkasAlasan([
      { reasonCode: 'salah_input', jumlah: 3 },
      { reasonCode: 'lainnya', jumlah: 1 },
    ]),
    'Salah input 3× · Lainnya 1×'
  );
  assert.equal(ringkasAlasan([]), '—');
});

// ---------------------------------------------------------------------------
// Rasio
// ---------------------------------------------------------------------------

test('⛔ rasio dari server dipakai APA ADANYA, hanya titik jadi koma', async () => {
  // Server sudah membulatkan ke satu angka desimal, dan itu satu-satunya angka
  // yang mengurutkan tabel. Klien yang menghitung ulang atau membulatkan lagi
  // dapat menghasilkan urutan berbeda dari yang server kirim — laporan yang
  // barisnya berpindah antar-muat tidak dapat dipercaya.
  const { rasioTampil } = await import(B21);
  assert.equal(rasioTampil('2.4'), '2,4×');
  assert.equal(rasioTampil('1.0'), '1,0×');
  assert.equal(rasioTampil('12.5'), '12,5×');
});

test('rasio cacat tidak merender "NaN"', async () => {
  const { rasioTampil } = await import(B21);
  assert.equal(rasioTampil(''), '—');
  assert.equal(rasioTampil(null), '—');
});

test('⛔ pembanding rasio DESKRIPTIF, bukan penilaian', async () => {
  // "2,4× rata-rata" menyatakan fakta. "Tinggi", "mencurigakan", atau warna
  // merah tanpa teks adalah kesimpulan yang ditarik sistem atas nama manusia.
  const { bandingRata } = await import(B21);
  assert.equal(bandingRata('1.0'), 'sama dengan rata-rata');
  assert.match(bandingRata('2.4'), /di atas rata-rata/);
  assert.match(bandingRata('0.4'), /di bawah rata-rata/);
});

// ---------------------------------------------------------------------------
// Waktu
// ---------------------------------------------------------------------------

test('waktu tampil dalam format Indonesia', async () => {
  const { waktuTampil } = await import(B21);
  assert.equal(waktuTampil('2026-08-10T07:32:00.000Z', 'Asia/Jakarta'), '10 Agu 2026 14:32');
});

test('⛔ zona waktu DIBERIKAN, bukan diambil diam-diam dari perangkat', async () => {
  // Batas yang dinyatakan: endpoint X1 tidak mengembalikan zona outlet, jadi
  // layar menampilkan zona PERANGKAT dan menyebutkannya. Merchant dengan outlet
  // di WIB dan WITA akan melihat keduanya di jam pembacanya sendiri.
  //
  // Parameternya eksplisit supaya batas itu terlihat di tanda tangan fungsi —
  // dan supaya ia dapat diuji sama sekali.
  const { waktuTampil } = await import(B21);
  const wib = waktuTampil('2026-08-10T16:30:00.000Z', 'Asia/Jakarta');
  const wita = waktuTampil('2026-08-10T16:30:00.000Z', 'Asia/Makassar');
  assert.notEqual(wib, wita);
  assert.equal(wib, '10 Agu 2026 23:30');
  assert.equal(wita, '11 Agu 2026 00:30');
});

// ---------------------------------------------------------------------------
// Keadaan layar
// ---------------------------------------------------------------------------

const KOSONG = { from: '2026-08-10', to: '2026-08-10', outletId: null, perAktor: [], peristiwa: [] };

test('keadaan memuat punya pesannya sendiri', async () => {
  const p = await pesanX1({ jenis: 'memuat' }, () => 'Semua outlet');
  assert.notEqual(p, null);
  assert.match(p.judul, /Menghitung/);
});

test('keadaan awal meminta rentang, bukan mengaku kosong', async () => {
  const p = await pesanX1({ jenis: 'awal' }, () => 'Semua outlet');
  assert.match(p.judul, /rentang/i);
});

test('⛔ KOSONG dibedakan dari GAGAL, dan keduanya dari BELUM DIMUAT', async () => {
  // Tiga keadaan yang tampak sama di layar dan berarti hal yang sangat berbeda.
  // "Tidak ada pembatalan" adalah kabar baik; "tidak dapat memuat" adalah
  // laporan yang tidak boleh dipercaya sebagai bukti tidak ada pembatalan.
  const nama = () => 'Kopi Pagi Menteng';

  const kosong = await pesanX1({ jenis: 'siap', hasil: KOSONG }, nama);
  const galat = await pesanX1({ jenis: 'galat', pesan: 'Koneksi putus.' }, nama);

  assert.notEqual(kosong.judul, galat.judul);
  assert.match(kosong.judul, /Tidak ada pembatalan/i);
  assert.ok(kosong.badan.includes('Kopi Pagi Menteng'), 'keadaan kosong tidak menyebut lingkupnya');
  assert.ok(kosong.badan.includes('2026-08-10'), 'keadaan kosong tidak menyebut rentangnya');
  assert.match(galat.badan, /Koneksi putus\./);
});

test('⛔ keadaan kosong TIDAK berbunyi seperti pembebasan', async () => {
  // "Tidak ada pembatalan" pada rentang yang perangkatnya belum tersinkronisasi
  // bukan bukti apa pun. Layar harus menyebut kemungkinan itu — laporan ini
  // dipakai untuk menilai orang.
  const p = await pesanX1({ jenis: 'siap', hasil: KOSONG }, () => 'Semua outlet');
  assert.match(p.badan, /sinkron/i);
});

test('ada data → tidak ada pesan, tabel yang dirender', async () => {
  const hasil = {
    ...KOSONG,
    perAktor: [{ userId: 'u1', name: 'Ani', jumlahTotal: 1, rasio: '1.0' }],
    peristiwa: [{ auditId: 'a1' }],
  };
  assert.equal(await pesanX1({ jenis: 'siap', hasil }, () => 'x'), null);
});

// ---------------------------------------------------------------------------
// ⛔ Bahasa
// ---------------------------------------------------------------------------

test('⛔ tidak ada bahasa menuduh di seluruh layar B-21', async () => {
  // Penjaga yang sama dengan yang mengawal endpointnya, kini di sisi klien.
  // Server yang bersih tidak menolong kalau layarnya menambahkan kata "curiga"
  // sendiri — dan layar inilah yang dibaca dan dicetak orang.
  const MENUDUH =
    /curiga|suspicious|fraud|penipuan|mencurigakan|pelanggar|nakal|abuse|kecurangan|maling/i;

  for (const berkas of ['b21.ts', 'b21-daftar.ts', 'Exception.tsx']) {
    const isi = readFileSync(join(AKAR, 'apps', 'backoffice', 'src', 'pengawasan', berkas), 'utf8');
    // Baris komentar yang MENJELASKAN aturan ini boleh menyebut katanya;
    // yang dilarang adalah teks yang sampai ke layar. Yang dipindai karena itu
    // hanya literal string.
    const literal = [...isi.matchAll(/'([^']*)'|"([^"]*)"|>([^<>{}]+)</g)]
      .map((m) => m[1] ?? m[2] ?? m[3])
      .join('\n');
    assert.doesNotMatch(literal, MENUDUH, `bahasa menuduh di ${berkas}`);
  }
});

test('⛔ judul layar tidak menuduh', async () => {
  const { JUDUL_LAYAR } = await import(B21);
  assert.doesNotMatch(JUDUL_LAYAR, /curiga|pelanggar|nakal|penipuan/i);
  assert.match(JUDUL_LAYAR, /exception/i);
});
