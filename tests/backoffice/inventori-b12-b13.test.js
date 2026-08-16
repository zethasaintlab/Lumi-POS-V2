'use strict';

// B-12 (Daftar Stok) dan B-13 (Penyesuaian) — aturan layarnya.
//
// ⛔ Yang paling berbahaya di sini bukan tata letak melainkan KONVERSI ×1000.
// Repo ini sudah dua kali menemukan cacat sekelas itu di form: `bacaRupiah`
// yang menghasilkan 10× salah, dan `persenKeRate` yang 100× salah. Keduanya
// lolos review dan tertangkap test.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const B12 = '../../apps/backoffice/src/inventori/b12.ts';

// ---------------------------------------------------------------------------
// ⛔ Kuantitas: layar utuh, API ×1000
// ---------------------------------------------------------------------------

test('bilangan bulat dikalikan seribu', async () => {
  const { bacaKuantitas } = await import(B12);
  assert.equal(bacaKuantitas('10'), '10000');
  assert.equal(bacaKuantitas('1'), '1000');
  assert.equal(bacaKuantitas('250'), '250000');
});

test('⛔ desimal koma Indonesia, TANPA menyentuh float', async () => {
  const { bacaKuantitas } = await import(B12);
  assert.equal(bacaKuantitas('2,5'), '2500');
  assert.equal(bacaKuantitas('0,5'), '500');
  assert.equal(bacaKuantitas('0,25'), '250');
  assert.equal(bacaKuantitas('0,001'), '1');
  assert.equal(bacaKuantitas('1,25'), '1250');
});

test('⛔ presisi utuh di atas 2^53 — inilah yang membedakan string dari float', async () => {
  // ⛔ Test ini ditambahkan SETELAH sabotase membuktikan bahwa 27 test lain
  // TIDAK dapat membedakan implementasi string dari implementasi float.
  //
  // Sebabnya: `Math.round(Number(x) * 1000)` memang eksak untuk setiap nilai
  // berdesimal ≤ 3 yang besarnya masuk akal — pembulatannya menutupi seluruh
  // galat biner. Jadi klaim "harus string" di komentar `b12.ts` adalah hiasan
  // sampai ada satu nilai yang benar-benar memisahkan keduanya.
  //
  // Ini nilainya. `Number('9007199254740,993')` sudah kehilangan digit
  // terakhirnya sebelum dikalikan apa pun.
  const { bacaKuantitas } = await import(B12);
  assert.equal(bacaKuantitas('9007199254740,993'), '9007199254740993');
  assert.equal(bacaKuantitas('12345678901234,567'), '12345678901234567');
});

test('titik diterima sebagai pemisah desimal juga', async () => {
  // Papan ketik numerik ponsel dan sebagian pengguna memakai titik. Menolaknya
  // membuat form terasa rusak untuk maksud yang jelas.
  const { bacaKuantitas } = await import(B12);
  assert.equal(bacaKuantitas('2.5'), '2500');
});

test('⛔ negatif dipertahankan untuk penyesuaian', async () => {
  const { bacaKuantitas } = await import(B12);
  assert.equal(bacaKuantitas('-3'), '-3000');
  assert.equal(bacaKuantitas('-0,5'), '-500');
});

test('⛔ lebih dari tiga desimal DITOLAK, tidak dibulatkan', async () => {
  // ×1000 tidak dapat menyimpannya. Membulatkan diam-diam berarti merchant
  // mengetik satu angka dan sistem menyimpan angka lain.
  const { bacaKuantitas } = await import(B12);
  assert.equal(bacaKuantitas('1,2345'), null);
  assert.equal(bacaKuantitas('0,0001'), null);
});

test('masukan cacat ditolak, bukan jadi nol', async () => {
  const { bacaKuantitas } = await import(B12);
  for (const buruk of ['', '   ', 'sepuluh', '1,2,3', '-', ',5', '1e3', '10 kg']) {
    assert.equal(bacaKuantitas(buruk), null, `"${buruk}" diterima`);
  }
});

test('⛔ nol ditolak — server menolaknya juga', async () => {
  const { bacaKuantitas } = await import(B12);
  assert.equal(bacaKuantitas('0'), null);
  assert.equal(bacaKuantitas('0,000'), null);
});

test('⛔ pembacaan dan penampilan saling membalik', async () => {
  // Property, bukan contoh. Nilai yang diketik lalu ditampilkan ulang harus
  // kembali ke bentuk yang sama — kalau tidak, mengedit baris yang sudah ada
  // diam-diam mengubah angkanya.
  const { bacaKuantitas, kuantitasTampil } = await import(B12);
  for (const teks of ['10', '2,5', '0,5', '0,25', '250', '-3', '-0,5', '0,001']) {
    const milli = bacaKuantitas(teks);
    assert.notEqual(milli, null, `"${teks}" tidak terbaca`);
    assert.equal(kuantitasTampil(BigInt(milli)), teks, `bolak-balik gagal untuk "${teks}"`);
  }
});

test('⛔ kuantitasTampil SEPAKAT dengan server', async () => {
  const { kuantitasTampil } = await import(B12);
  const { saldoTampil } = await import(
    '../../apps/server/src/modules/reporting/handlers/stok.ts'
  );
  for (const n of [1000n, 2500n, 500n, 12000n, -4000n, 1n, 0n]) {
    assert.equal(kuantitasTampil(n), saldoTampil(n), `berbeda untuk ${n}`);
  }
});

// ---------------------------------------------------------------------------
// Validasi formulir B-13
// ---------------------------------------------------------------------------

const ISIAN = {
  outletId: 'o1',
  variationId: 'v1',
  tipe: 'receipt',
  kuantitas: '10',
  catatan: '',
  alasan: '',
};

test('formulir lengkap untuk barang masuk lolos', async () => {
  const { periksaIsian } = await import(B12);
  assert.deepEqual(periksaIsian(ISIAN), {});
});

test('⛔ barang masuk MENOLAK angka negatif di klien', async () => {
  // Server menolaknya juga, tapi menyerahkannya ke server berarti merchant
  // mengisi form, menekan simpan, dan baru tahu setelah perjalanan bolak-balik.
  const { periksaIsian } = await import(B12);
  const galat = periksaIsian({ ...ISIAN, kuantitas: '-5' });
  assert.ok(galat.kuantitas, 'negatif diterima untuk barang masuk');
  assert.match(galat.kuantitas, /penyesuaian/i, 'pesan tidak menunjukkan jalan keluarnya');
});

test('penyesuaian menerima negatif', async () => {
  const { periksaIsian } = await import(B12);
  const galat = periksaIsian({
    ...ISIAN, tipe: 'adjustment', kuantitas: '-5', alasan: 'rusak', catatan: 'Tumpah',
  });
  assert.deepEqual(galat, {});
});

test('⛔ penyesuaian WAJIB beralasan (AC FR-E2)', async () => {
  const { periksaIsian } = await import(B12);
  const galat = periksaIsian({ ...ISIAN, tipe: 'adjustment', kuantitas: '-5' });
  assert.ok(galat.alasan, 'penyesuaian tanpa alasan lolos');
});

test('barang masuk tidak menuntut alasan', async () => {
  const { periksaIsian } = await import(B12);
  assert.equal(periksaIsian({ ...ISIAN, alasan: '' }).alasan, undefined);
});

test('produk dan outlet wajib dipilih', async () => {
  const { periksaIsian } = await import(B12);
  assert.ok(periksaIsian({ ...ISIAN, variationId: '' }).variationId);
  assert.ok(periksaIsian({ ...ISIAN, outletId: '' }).outletId);
});

test('kuantitas cacat memberi pesan sendiri', async () => {
  const { periksaIsian } = await import(B12);
  assert.ok(periksaIsian({ ...ISIAN, kuantitas: 'sepuluh' }).kuantitas);
  assert.ok(periksaIsian({ ...ISIAN, kuantitas: '0' }).kuantitas);
});

test('⛔ badan permintaan membawa kuantitas ×1000 sebagai STRING', async () => {
  const { susunBadan } = await import(B12);
  const badan = susunBadan({ ...ISIAN, kuantitas: '2,5' });
  assert.equal(badan.delta, '2500');
  assert.equal(typeof badan.delta, 'string');
  assert.equal(badan.type, 'receipt');
});

test('alasan dan catatan hanya ikut bila terisi', async () => {
  const { susunBadan } = await import(B12);
  const polos = susunBadan(ISIAN);
  assert.equal(polos.reasonCode, undefined);
  assert.equal(polos.note, undefined);

  const lengkap = susunBadan({ ...ISIAN, tipe: 'adjustment', alasan: 'rusak', catatan: 'Tumpah' });
  assert.equal(lengkap.reasonCode, 'rusak');
  assert.equal(lengkap.note, 'Tumpah');
});

// ---------------------------------------------------------------------------
// B-12 daftar
// ---------------------------------------------------------------------------

const BARIS = (ubah) => ({
  variationId: 'v1', itemId: 'i1', itemName: 'Kopi Susu', variationName: 'Reguler',
  outletId: 'o1', trackStock: true, archived: false,
  saldoMilli: '5000', saldo: '5', jumlahMovement: 2, movementTerakhir: null,
  ...ubah,
});

test('penyaring nama bekerja tanpa peka huruf besar-kecil', async () => {
  const { saringStok } = await import(B12);
  const daftar = [BARIS({}), BARIS({ variationId: 'v2', itemName: 'Teh Tarik' })];
  assert.equal(saringStok(daftar, { cari: 'kopi' }).length, 1);
  assert.equal(saringStok(daftar, { cari: 'TEH' }).length, 1);
  assert.equal(saringStok(daftar, { cari: '' }).length, 2);
});

test('pencarian juga mencocokkan nama varian', async () => {
  const { saringStok } = await import(B12);
  const daftar = [BARIS({}), BARIS({ variationId: 'v2', variationName: 'Large' })];
  assert.equal(saringStok(daftar, { cari: 'large' }).length, 1);
});

test('⛔ produk terarsip disembunyikan kecuali diminta', async () => {
  // Katalog tidak pernah dihapus, hanya diarsipkan (invariant #2). Tanpa
  // penyaring ini, daftar stok terus menampilkan barang yang sudah tidak
  // dijual — dan angkanya tidak akan pernah berubah lagi.
  const { saringStok } = await import(B12);
  const daftar = [BARIS({}), BARIS({ variationId: 'v2', archived: true })];
  assert.equal(saringStok(daftar, { cari: '' }).length, 1);
  assert.equal(saringStok(daftar, { cari: '', tampilArsip: true }).length, 2);
});

test('⛔ nada baris DIBEDAKAN, dan selalu berpasangan dengan teks', async () => {
  // Aturan design system #5: status tidak pernah warna saja.
  const { nadaStok, labelStok } = await import(B12);
  assert.notEqual(nadaStok('-4000'), nadaStok('5000'));
  assert.match(labelStok('-4000'), /minus|negatif|kurang/i);
  assert.equal(labelStok('5000'), '');
});

test('⛔ saldo nol BUKAN keadaan negatif', async () => {
  // Nol berarti habis, bukan salah. Menandainya seperti negatif membuat
  // merchant mencari masalah yang tidak ada.
  const { nadaStok, labelStok } = await import(B12);
  assert.equal(nadaStok('0'), nadaStok('5000'));
  assert.equal(labelStok('0'), '');
});

test('ringkasan menghitung berapa yang minus', async () => {
  const { ringkasStok } = await import(B12);
  const daftar = [BARIS({}), BARIS({ variationId: 'v2', saldoMilli: '-1000' }), BARIS({ variationId: 'v3', saldoMilli: '-2000' })];
  const r = ringkasStok(daftar);
  assert.equal(r.jumlah, 3);
  assert.equal(r.negatif, 2);
});

test('⛔ KOSONG dibedakan dari GAGAL dan dari BELUM DIMUAT', async () => {
  const { pesanKeadaan } = await import(B12);
  const kosong = pesanKeadaan({ jenis: 'siap', items: [] }, '');
  const galat = pesanKeadaan({ jenis: 'galat', pesan: 'Koneksi putus.' }, '');
  const muat = pesanKeadaan({ jenis: 'memuat' }, '');

  assert.notEqual(kosong.judul, galat.judul);
  assert.notEqual(kosong.judul, muat.judul);
  assert.match(galat.badan, /Koneksi putus\./);
});

test('⛔ kosong KARENA PENCARIAN berbeda dari kosong karena tidak ada data', async () => {
  // "Belum ada stok" untuk pencarian yang tidak cocok membuat merchant mengira
  // katalognya kosong, lalu memasukkan ulang barang yang sudah ada.
  const { pesanKeadaan } = await import(B12);
  const tanpaData = pesanKeadaan({ jenis: 'siap', items: [] }, '');
  const takCocok = pesanKeadaan({ jenis: 'siap', items: [] }, 'kopi');
  assert.notEqual(tanpaData.judul, takCocok.judul);
  assert.ok(takCocok.badan.includes('kopi'), 'pesan tidak menyebut kata yang dicari');
});

test('ada isi → tidak ada pesan', async () => {
  const { pesanKeadaan } = await import(B12);
  assert.equal(pesanKeadaan({ jenis: 'siap', items: [BARIS({})] }, ''), null);
});

// ---------------------------------------------------------------------------
// ⛔ Peringatan stok menipis
// ---------------------------------------------------------------------------

test('⛔ SABOTASE: barang di atas ambang TIDAK boleh muncul di peringatan', async () => {
  // Skenario yang diminta. Peringatan yang memuat barang aman membuat
  // seluruh daftarnya tidak dapat dipercaya — merchant berhenti membacanya,
  // dan yang benar-benar habis ikut terabaikan.
  const { saringMenipis } = await import(B12);
  const daftar = [
    BARIS({ variationId: 'aman', saldoMilli: '50000' }),   // 50 satuan
    BARIS({ variationId: 'batas', saldoMilli: '6000' }),    // 6 — di atas ambang 5
    BARIS({ variationId: 'menipis', saldoMilli: '5000' }),  // 5 — tepat di ambang
    BARIS({ variationId: 'habis', saldoMilli: '0' }),
    BARIS({ variationId: 'minus', saldoMilli: '-2000' }),
  ];
  const hasil = saringMenipis(daftar, 5).map((b) => b.variationId);

  assert.ok(!hasil.includes('aman'), 'barang bersaldo aman muncul di peringatan');
  assert.ok(!hasil.includes('batas'), 'barang di ATAS ambang muncul di peringatan');
  assert.deepEqual(hasil.sort(), ['habis', 'menipis', 'minus']);
});

test('⛔ ambang INKLUSIF — tepat di ambang sudah dianggap menipis', async () => {
  const { tingkatStok } = await import(B12);
  assert.equal(tingkatStok('5000', 5), 'menipis');
  assert.equal(tingkatStok('5001', 5), 'aman');
});

test('⛔ habis (nol) DIBEDAKAN dari minus', async () => {
  // Nol berarti barangnya memang tidak ada — wajar. Minus berarti terjual
  // melebihi yang tercatat masuk: mustahil secara fisik.
  const { tingkatStok, LABEL_TINGKAT } = await import(B12);
  assert.equal(tingkatStok('0', 5), 'habis');
  assert.equal(tingkatStok('-1', 5), 'minus');
  assert.notEqual(LABEL_TINGKAT.habis, LABEL_TINGKAT.minus);
});

test('⛔ varian yang stoknya TIDAK DILACAK dikecualikan', async () => {
  // Produk jasa tidak punya stok untuk menipis.
  const { saringMenipis } = await import(B12);
  const daftar = [
    BARIS({ variationId: 'jasa', saldoMilli: '0', trackStock: false }),
    BARIS({ variationId: 'barang', saldoMilli: '0', trackStock: true }),
  ];
  assert.deepEqual(saringMenipis(daftar, 5).map((b) => b.variationId), ['barang']);
});

test('varian terarsip tidak ikut diperingatkan', async () => {
  const { saringMenipis } = await import(B12);
  const daftar = [BARIS({ variationId: 'arsip', saldoMilli: '0', archived: true })];
  assert.deepEqual(saringMenipis(daftar, 5), []);
});

test('⛔ ambang dibandingkan TANPA float', async () => {
  // ×1000 dan ambang utuh: 0,001 satuan di bawah ambang tetap menipis, dan
  // nilai besar tidak kehilangan presisi.
  const { tingkatStok } = await import(B12);
  assert.equal(tingkatStok('4999', 5), 'menipis');
  assert.equal(tingkatStok('9007199254740993', 5), 'aman');
});

test('ambang bawaan ditandai sebagai asumsi, bukan aturan', async () => {
  const { AMBANG_MENIPIS_BAWAAN } = await import(B12);
  assert.equal(typeof AMBANG_MENIPIS_BAWAAN, 'number');
  assert.equal(AMBANG_MENIPIS_BAWAAN, 5);
});
