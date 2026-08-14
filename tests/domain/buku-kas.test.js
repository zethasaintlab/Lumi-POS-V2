'use strict';

// Buku kas — aturan murni di balik `cash_movement` (FR-D5, FR-D6).
//
// Ada di `packages/domain` karena server dan klien sama-sama menulis baris
// ini, dan `spec-d:14` menjadikan jumlahnya sebagai SATU-SATUNYA definisi
// saldo laci. Dua salinan aturan yang bergeser sendiri-sendiri akan membuat
// saldo laci menurut perangkat berbeda dari saldo laci menurut server, untuk
// shift yang sama — dan tidak ada cara memutuskan mana yang benar.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../packages/domain/src/buku-kas.ts';

test('setiap tipe movement punya counterpart_type, dan tidak ada yang kosong (FR-D6)', async () => {
  // `spec-d:220`: "`counterpart_type` NOT NULL dengan default yang benar per
  // tipe movement." Field ini tidak dipakai v1 dan justru karena itu mudah
  // dibiarkan kosong — nilainya baru terbaca saat merchant meminta jurnal
  // akuntansi, dan saat itu data historis sudah terlanjur.
  const { TIPE_MOVEMENT, counterpartUntuk } = await import(MOD);

  assert.deepEqual(
    [...TIPE_MOVEMENT].sort(),
    ['adjustment', 'bank_deposit', 'opening_float', 'paid_in', 'paid_out', 'refund', 'sale'].sort(),
    'daftar tipe tidak sama dengan spec-d:189'
  );

  for (const tipe of TIPE_MOVEMENT) {
    const c = counterpartUntuk(tipe);
    assert.ok(c, `tipe ${tipe} tidak punya counterpart_type`);
    assert.ok(
      ['sales_revenue', 'refund', 'owner_draw', 'expense', 'bank', 'unidentified'].includes(c),
      `counterpart_type ${c} di luar daftar spec-d:191`
    );
  }
});

test('⛔ tipe tak dikenal DITOLAK, tidak dipetakan ke unidentified', async () => {
  // `unidentified` ADA di daftar, jadi memakainya sebagai fallback akan
  // terlihat masuk akal. Tapi ia berarti "uang yang sumbernya belum
  // diidentifikasi" (FR-D6) — bukan "tipe yang tidak dikenal program ini".
  // Menjadikannya fallback membuat salah ketik tersimpan diam-diam sebagai
  // kategori akuntansi yang sah.
  const { counterpartUntuk } = await import(MOD);
  assert.throws(() => counterpartUntuk('penjualan'), /penjualan/);
  assert.throws(() => counterpartUntuk(''), /./);
});

test('arah delta ditentukan tipenya — refund dan paid_out mengurangi laci', async () => {
  const { deltaBertanda } = await import(MOD);

  assert.equal(deltaBertanda('sale', 300000), 300000);
  assert.equal(deltaBertanda('opening_float', 500000), 500000);
  assert.equal(deltaBertanda('paid_in', 50000), 50000);

  assert.equal(deltaBertanda('refund', 300000), -300000);
  assert.equal(deltaBertanda('paid_out', 50000), -50000);
  assert.equal(deltaBertanda('bank_deposit', 1000000), -1000000);
});

test('⛔ nilai negatif ditolak — tanda datang dari TIPE, bukan dari pemanggil', async () => {
  // Kalau pemanggil boleh mengirim tanda sendiri, ada dua sumber kebenaran
  // untuk arah uang dan keduanya bisa bertentangan: `refund` dengan delta
  // positif akan MENAMBAH laci. Nilainya karena itu selalu besaran.
  const { deltaBertanda } = await import(MOD);
  assert.throws(() => deltaBertanda('refund', -300000), /negatif|besaran/i);
  assert.throws(() => deltaBertanda('sale', -1), /negatif|besaran/i);
});

test('adjustment adalah satu-satunya yang boleh dua arah', async () => {
  // `spec-d` FR-D6 memakai `adjustment` untuk koreksi, dan koreksi bisa ke
  // dua arah. Ia karena itu menerima tanda dari pemanggil — dan satu-satunya
  // yang begitu, supaya pengecualiannya terlihat, bukan tersebar.
  const { deltaBertanda } = await import(MOD);
  assert.equal(deltaBertanda('adjustment', 25000), 25000);
  assert.equal(deltaBertanda('adjustment', -25000), -25000);
});

test('saldo laci = saldo awal + SUM(delta) — definisi spec-d:14', async () => {
  const { saldoLaci } = await import(MOD);
  assert.equal(saldoLaci(500000, [300000, -300000]), 500000);
  assert.equal(saldoLaci(500000, []), 500000);
  assert.equal(saldoLaci(0, [100000, 50000, -25000]), 125000);
});

test('⛔ property: saldo laci tidak pernah bergantung pada URUTAN (spec-d:315)', async () => {
  // AC-nya berbunyi "untuk urutan operasi apa pun". Penjumlahan memang
  // komutatif, jadi yang benar-benar dijaga di sini adalah bahwa tidak ada
  // yang kelak menyelundupkan clamp, pembulatan, atau "saldo tidak boleh
  // negatif" ke dalam fungsi ini — ketiganya membuat urutan jadi penting.
  const { saldoLaci } = await import(MOD);

  let acak = 12345;
  const berikut = () => {
    acak = (acak * 1103515245 + 12345) % 2147483648;
    return acak;
  };

  for (let iterasi = 0; iterasi < 500; iterasi += 1) {
    const n = berikut() % 12;
    const deltas = [];
    for (let i = 0; i < n; i += 1) {
      deltas.push((berikut() % 200000) * (berikut() % 2 === 0 ? 1 : -1));
    }
    const awal = berikut() % 1000000;

    const lurus = saldoLaci(awal, deltas);
    const terbalik = saldoLaci(awal, [...deltas].reverse());
    const teracak = saldoLaci(awal, [...deltas].sort(() => (berikut() % 2 === 0 ? 1 : -1)));

    assert.equal(terbalik, lurus, `urutan terbalik mengubah saldo: ${JSON.stringify(deltas)}`);
    assert.equal(teracak, lurus, `urutan acak mengubah saldo: ${JSON.stringify(deltas)}`);
  }
});

test('saldo laci boleh NEGATIF, dan itu bukan galat', async () => {
  // Laci yang minus berarti ada yang salah di dunia nyata — uang keluar lebih
  // banyak daripada yang pernah masuk. Menjepitnya ke nol menyembunyikan
  // persis keadaan yang paling perlu dilihat owner.
  const { saldoLaci } = await import(MOD);
  assert.equal(saldoLaci(0, [-50000]), -50000);
});
