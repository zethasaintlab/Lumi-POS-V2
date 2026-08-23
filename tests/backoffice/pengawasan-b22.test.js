'use strict';

// B-22 — Audit & Aktivitas (FR-F6, FR-F7), aturan tampilannya.
//
// ⛔ Kenapa aturannya dipisahkan dari komponen, dan kenapa penjaganya lebih
// ketat daripada B-21: `spec-f:372` memberi audit trail retensi LIMA TAHUN,
// lebih panjang daripada retensi transaksi, dengan alasan yang dinyatakan —
// "sengketa muncul berbulan-bulan kemudian". Yang membaca layar ini biasanya
// sedang mencari jawaban atas tuduhan.
//
// Dua hal yang diuji di sini karena keduanya DIAM kalau tidak dinyatakan:
// saringan yang sedang aktif, dan peristiwa yang belum dipancarkan sama
// sekali. Daftar yang tidak menyebut keduanya terbaca sebagai daftar lengkap.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const AKAR = join(__dirname, '..', '..');
const B22 = '../../apps/backoffice/src/pengawasan/b22.ts';
const DOMAIN = '../../packages/domain/src/audit-peristiwa.ts';

// ---------------------------------------------------------------------------
// Label
// ---------------------------------------------------------------------------

test('⛔ SETIAP peristiwa di daftar domain punya label — daftarnya diturunkan', async () => {
  // Pola yang sama dengan `LABEL_ALASAN` di B-21: ini salinan KEDUA, dan
  // salinan kedua bergeser. Peristiwa yang ditambahkan kelak akan tampil
  // sebagai slug mentah ("subscription_plan_upgraded") di layar yang dibaca
  // saat sengketa.
  const { LABEL_PERISTIWA } = await import(B22);
  const { KUNCI_PERISTIWA } = await import(DOMAIN);

  const hilang = KUNCI_PERISTIWA.filter((k) => LABEL_PERISTIWA[k] === undefined);
  assert.deepEqual(hilang, [], `peristiwa tanpa label: ${hilang.join(', ')}`);
});

test('⛔ SETIAP kelompok di domain punya label', async () => {
  const { LABEL_KELOMPOK, labelKelompok } = await import(B22);
  const { KUNCI_PERISTIWA, kelompokPeristiwa } = await import(DOMAIN);
  for (const k of KUNCI_PERISTIWA) {
    const kel = kelompokPeristiwa(k);
    assert.notEqual(LABEL_KELOMPOK[kel], undefined, `kelompok "${kel}" tanpa label`);
  }
  assert.equal(labelKelompok(null), 'Lainnya');
});

test('⛔ nama peristiwa ASING tampil apa adanya, tidak disembunyikan', async () => {
  // Baris lama dapat memuat nama yang sudah tidak dipancarkan siapa pun —
  // `audit_event` tidak pernah di-UPDATE (invariant #2). Sel kosong membuat
  // baris terbaca seperti jejak yang rusak, dan menyaringnya keluar berarti
  // layar audit yang menyembunyikan bagian dari audit.
  const { labelPeristiwa } = await import(B22);
  assert.equal(labelPeristiwa('peristiwa_lama_2025'), 'peristiwa_lama_2025');
  assert.equal(labelPeristiwa(null), 'Peristiwa tanpa nama');
  assert.equal(labelPeristiwa('order.voided'), 'Transaksi dibatalkan');
});

test('pilihan saringan dikelompokkan dan urutannya dimiliki layar', async () => {
  // Daftar saringan yang urutannya berubah saat seseorang menambah baris di
  // domain membuat orang yang memakai layar ini setiap minggu kehilangan
  // hafalannya.
  const { pilihanPeristiwa } = await import(B22);
  const { KUNCI_PERISTIWA } = await import(DOMAIN);
  const pilihan = pilihanPeristiwa();
  assert.equal(pilihan.length, KUNCI_PERISTIWA.length);

  const kelompok = pilihan.map((p) => p.kelompok);
  assert.deepEqual(kelompok, [...kelompok].sort((a, b) => a.localeCompare(b, 'id')));
});

// ---------------------------------------------------------------------------
// ⛔ Yang tidak terlihat harus disebutkan
// ---------------------------------------------------------------------------

test('⛔ saringan yang aktif DISEBUTKAN, dan tanpa saringan tidak berbunyi apa pun', async () => {
  const { ringkasSaringan } = await import(B22);
  const kosong = { outlet: null, jenis: null, aktor: null, objek: null };
  assert.equal(ringkasSaringan(kosong), null);

  const disaring = ringkasSaringan({ ...kosong, jenis: 'order.voided', outlet: 'Menteng' });
  assert.match(disaring, /disaring/i);
  assert.ok(disaring.includes('Menteng'));
  // Jenis disebut dengan LABEL-nya, bukan slug — layar ini dibaca orang yang
  // tidak pernah melihat kode kami.
  assert.ok(disaring.includes('Transaksi dibatalkan'), disaring);
  assert.match(disaring, /tidak ditampilkan/i);
});

test('⛔ peristiwa yang BELUM DIPANCARKAN disebutkan, dari daftar server', async () => {
  // FR-F6 AC pertama menuntut setiap event pada `spec-f:288` menghasilkan
  // record; sebagian belum. Manajer yang tidak menemukan perubahan harga di
  // sini akan menyimpulkan tidak ada yang mengubah harga.
  const { pesanBelumDipancarkan } = await import(B22);
  assert.equal(pesanBelumDipancarkan([]), null);

  const p = pesanBelumDipancarkan(['price_changed', 'shift_opened']);
  assert.ok(p.includes('price_changed') || p.includes('Harga'), p);
  // ⛔ Kalimat penutupnya yang menentukan: ketiadaan baris BUKAN bukti.
  assert.match(p, /bukan bukti/i);
});

test('⛔ daftar peristiwa yang belum ada TIDAK disalin ke klien', async () => {
  // Salinan yang lupa dipangkas menyatakan lubang yang sudah tidak ada, dan
  // pernyataan itu membuat trail yang benar terlihat tidak dapat dipercaya.
  const isi = readFileSync(join(AKAR, 'apps', 'backoffice', 'src', 'pengawasan', 'b22.ts'), 'utf8');
  assert.doesNotMatch(isi, /PERISTIWA_BELUM_DIPANCARKAN/);
  assert.doesNotMatch(isi, /'shift_opened'|'price_changed'|'stock_adjusted'/);
});

// ---------------------------------------------------------------------------
// Identitas kedua
// ---------------------------------------------------------------------------

test('⛔ penyetuju KOSONG berbunyi "tidak menuntut persetujuan", bukan sel hampa', async () => {
  // Sel kosong bermakna di kolom ini, dan maknanya bukan "datanya hilang":
  // void berjalan tanpa penyetuju sejak keputusan 1 Agustus 2026. Dibiarkan
  // hampa, ia terbaca sebagai jejak yang tidak lengkap — pada layar yang
  // dibaca justru untuk memutuskan apakah jejaknya lengkap.
  const { penyetujuTampil } = await import(B22);
  assert.match(penyetujuTampil(null), /tidak menuntut persetujuan/i);
  assert.match(penyetujuTampil(''), /tidak menuntut persetujuan/i);
  assert.equal(penyetujuTampil('Rina Manajer'), 'Rina Manajer');
});

test('objek dipendekkan tapi tidak pernah hilang', async () => {
  const { objekTampil } = await import(B22);
  assert.equal(objekTampil(null, null), '—');
  assert.match(objekTampil('order', '01J8ZC9Q4K7X0000000000'), /^order 01J8ZC9Q…$/);
  assert.equal(objekTampil(null, 'abc'), 'abc');
});

// ---------------------------------------------------------------------------
// Keadaan layar
// ---------------------------------------------------------------------------

const KOSONG = {
  from: '2026-08-10',
  to: '2026-08-12',
  outletId: null,
  eventType: null,
  actorUserId: null,
  entityId: null,
  batas: 50,
  kursorBerikut: null,
  belumDipancarkan: [],
  peristiwa: [],
};

test('⛔ KOSONG, GAGAL, dan BELUM DIMUAT berbeda', async () => {
  // "Tidak ada aktivitas" yang sebenarnya berarti "gagal memuat" adalah
  // pembebasan yang tidak pernah diucapkan siapa pun.
  const { pesanKeadaanAudit } = await import(B22);
  const nama = () => 'Kopi Pagi Menteng';

  const kosong = pesanKeadaanAudit({ jenis: 'siap', hasil: KOSONG }, nama);
  const galat = pesanKeadaanAudit({ jenis: 'galat', pesan: 'Koneksi putus.' }, nama);
  const awal = pesanKeadaanAudit({ jenis: 'awal' }, nama);

  assert.equal(new Set([kosong.judul, galat.judul, awal.judul]).size, 3);
  assert.match(galat.badan, /Koneksi putus\./);
  assert.ok(kosong.badan.includes('Kopi Pagi Menteng'));
  assert.ok(kosong.badan.includes('2026-08-10') && kosong.badan.includes('2026-08-12'));
});

test('⛔ keadaan kosong menyebut sinkronisasi DAN saringan yang aktif', async () => {
  // Dua alasan berbeda kenapa daftar audit dapat kosong tanpa berarti apa pun,
  // dan keduanya harus disebut. Yang pertama membuat kegagalan jaringan
  // terbaca sebagai pembebasan; yang kedua membuat saringan terbaca sebagai
  // keseluruhan.
  const { pesanKeadaanAudit } = await import(B22);
  const p = pesanKeadaanAudit(
    { jenis: 'siap', hasil: { ...KOSONG, eventType: 'order.voided' } },
    () => 'Semua outlet'
  );
  assert.match(p.badan, /sinkron/i);
  assert.match(p.badan, /disaring/i);
  assert.ok(p.badan.includes('Transaksi dibatalkan'), p.badan);
});

test('ada baris → tidak ada pesan, tabel yang dirender', async () => {
  const { pesanKeadaanAudit } = await import(B22);
  const hasil = { ...KOSONG, peristiwa: [{ id: 'a1' }] };
  assert.equal(pesanKeadaanAudit({ jenis: 'siap', hasil }, () => 'x'), null);
});

// ---------------------------------------------------------------------------
// ⛔ Bahasa
// ---------------------------------------------------------------------------

test('⛔ tidak ada bahasa menuduh di seluruh layar B-22', async () => {
  // Penjaga yang sama dengan B-21. Layar ini menamai orang, dan ia dibaca saat
  // sengketa — kata yang menyimpulkan di sini menjadi bagian dari sengketanya.
  const MENUDUH =
    /curiga|suspicious|fraud|penipuan|mencurigakan|pelanggar|nakal|abuse|kecurangan|maling/i;

  for (const berkas of ['b22.ts', 'Audit.tsx']) {
    const isi = readFileSync(join(AKAR, 'apps', 'backoffice', 'src', 'pengawasan', berkas), 'utf8');
    const literal = [...isi.matchAll(/'([^']*)'|"([^"]*)"|>([^<>{}]+)</g)]
      .map((m) => m[1] ?? m[2] ?? m[3])
      .join('\n');
    assert.doesNotMatch(literal, MENUDUH, `bahasa menuduh di ${berkas}`);
  }
});

test('⛔ setiap label peristiwa menyatakan APA YANG TERJADI, bukan kesimpulannya', async () => {
  const { LABEL_PERISTIWA } = await import(B22);
  const VONIS = /wajar|tidak wajar|bermasalah|melanggar|gagal patuh|dilarang/i;
  for (const [kunci, label] of Object.entries(LABEL_PERISTIWA)) {
    assert.doesNotMatch(label, VONIS, `${kunci} dilabeli kesimpulan`);
    assert.ok(label.length > 0, `${kunci} berlabel kosong`);
  }
});
