'use strict';

// FR-C10 — struktur struk (`spec-c:371`).
//
// AC pertamanya: "Struk contoh di atas dapat direproduksi persis dari data
// test." Berkas ini mengambil AC itu harfiah — contoh di spec dibangun ulang,
// lalu dirender ke 32 DAN 48 karakter (AC keempat).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const DOK = '../../apps/kasir/src/cetak/dokumen.ts';
const ESCPOS = '../../apps/kasir/src/cetak/escpos.ts';

const ESC = String.fromCharCode(0x1b);
const GS = String.fromCharCode(0x1d);

const bersih = (bytes) =>
  Buffer.from(bytes)
    .toString('latin1')
    .replace(new RegExp(ESC + 'p[\\s\\S]{3}', 'g'), '')
    .replace(new RegExp(ESC + '@', 'g'), '')
    .replace(new RegExp(ESC + '[aE][\\s\\S]', 'g'), '')
    .replace(new RegExp(GS + 'V[\\s\\S]', 'g'), '');

const PROFIL = (charsPerLine) => ({
  id: 'p',
  nama: `Generic ${charsPerLine}`,
  paperWidthMm: charsPerLine === 32 ? 58 : 80,
  charsPerLine,
  codepage: 'cp437',
  hasCutter: true,
  initCommand: '1B 40',
  cutCommand: '1D 56 00',
  drawerCommand: '1B 70 00 19 FA',
  imageSupport: false,
});

/** Contoh `spec-c:376-399`, angka demi angka. */
const CONTOH = {
  namaMerchant: 'LUMI KOPI',
  alamatOutlet: 'Jl. Dago No. 1',
  receiptNumber: 'K1-20260726-0007',
  waktu: '26 Jul 2026  14:32',
  namaKasir: 'Sari',
  channel: 'takeaway',
  baris: [
    {
      itemName: 'Kopi Susu',
      variationName: 'Regular',
      quantityMilli: 2000,
      lineTotal: 50000,
      modifier: [{ nama: 'Extra Shot', harga: 10000 }],
    },
    { itemName: 'Croissant', variationName: 'Regular', quantityMilli: 1000, lineTotal: 30000 },
  ],
  subtotal: 90000,
  diskon: 9000,
  serviceCharge: 4050,
  pajak: [{ nama: 'PBJT 10%', jumlah: 8505 }],
  pembulatan: 45,
  total: 93600,
  pembayaran: [{ nama: 'Tunai', jumlah: 100000 }],
  kembalian: 6400,
};

async function cetak(data, charsPerLine = 32) {
  const { bangunDokumenStruk } = await import(DOK);
  const { renderEscPos } = await import(ESCPOS);
  return bersih(renderEscPos(bangunDokumenStruk(data), PROFIL(charsPerLine)));
}

// ---------------------------------------------------------------------------

test('⛔ contoh spec-c:376 direproduksi baris demi baris', async () => {
  const out = await cetak(CONTOH);
  const punya = (frag) => assert.ok(out.includes(frag), `tidak ada: ${JSON.stringify(frag)}\n${out}`);

  punya('LUMI KOPI');
  punya('Jl. Dago No. 1');
  punya('K1-20260726-0007');
  punya('26 Jul 2026  14:32');
  punya('Kasir: Sari');
  punya('Takeaway');
  punya('2x Kopi Susu');
  punya('Extra Shot');
  punya('1x Croissant');
  punya('Subtotal');
  punya('PBJT 10%');
  punya('Pembulatan');
  punya('TOTAL');
  punya('Tunai');
  punya('Kembali');
});

test('⛔ angkanya persis seperti di spec, dengan titik ribuan', async () => {
  const out = await cetak(CONTOH);
  for (const n of ['50.000', '10.000', '30.000', '90.000', '9.000', '4.050', '8.505', '93.600', '100.000', '6.400']) {
    assert.ok(out.includes(n), `angka ${n} tidak muncul`);
  }
  // Pembulatan 45 — tanpa titik, dan tetap tercetak meski kecil.
  assert.ok(/\+ 45\b/.test(out), 'baris pembulatan hilang');
});

test('⛔ SUM baris yang tercetak = total yang tercetak (AC FR-C10 kedua)', async () => {
  // "Tidak ada selisih pembulatan tersembunyi." Diperiksa dari ANGKA YANG
  // TERCETAK, bukan dari data masukan — struk yang aritmetikanya tidak
  // tertutup adalah struk yang tidak dapat diverifikasi auditor pajak,
  // dan itu persis yang FR-C10 tuntut.
  const out = await cetak(CONTOH);
  const angka = (label) => {
    const line = out.split('\n').find((l) => l.startsWith(label));
    assert.ok(line, `baris "${label}" tidak ada`);
    const m = line.match(/([\d.]+)\s*$/);
    return Number(m[1].replace(/\./g, ''));
  };

  const subtotal = angka('Subtotal');
  const diskon = angka('Diskon');
  const service = angka('Service');
  const pajak = angka('PBJT 10%');
  const pembulatan = angka('Pembulatan');
  const total = angka('TOTAL');

  assert.equal(
    subtotal - diskon + service + pajak + pembulatan,
    total,
    `${subtotal} − ${diskon} + ${service} + ${pajak} + ${pembulatan} ≠ ${total}`
  );
});

test('⛔ tercetak benar pada 32 DAN 48 karakter (AC FR-C10 keempat)', async () => {
  for (const lebar of [32, 48]) {
    const out = await cetak(CONTOH, lebar);
    for (const line of out.split('\n')) {
      assert.ok(line.length <= lebar, `baris ${line.length} > ${lebar}: ${JSON.stringify(line)}`);
    }
    // Dan angkanya tetap rata kanan pada kedua lebar.
    const total = out.split('\n').find((l) => l.startsWith('TOTAL'));
    assert.equal(total.length, lebar);
    assert.ok(total.endsWith('93.600'));
  }
});

test('⛔ baris bernilai NOL tidak dicetak (spec-c:405)', async () => {
  const out = await cetak({
    ...CONTOH,
    diskon: 0,
    serviceCharge: 0,
    pembulatan: 0,
    kembalian: 0,
  });
  assert.equal(out.includes('Diskon'), false);
  assert.equal(out.includes('Service'), false);
  assert.equal(out.includes('Pembulatan'), false);
  assert.equal(out.includes('Kembali'), false);
});

test('⛔ pajak 0% TETAP dicetak — ia keputusan merchant, bukan ketiadaan', async () => {
  // `spec-c:405`: "kecuali pajak 0% yang eksplisit dikonfigurasi". Auditor
  // perlu melihat bahwa merchant memang menetapkan 0%, bukan bahwa tidak ada
  // pajak yang cocok.
  const out = await cetak({ ...CONTOH, pajak: [{ nama: 'PBJT 0%', jumlah: 0 }] });
  assert.ok(out.includes('PBJT 0%'), 'pajak 0% ikut hilang');
});

test('⛔ nama pajak dari konfigurasi, tidak pernah string generik', async () => {
  const out = await cetak({ ...CONTOH, pajak: [{ nama: 'PPN 11%', jumlah: 9900 }] });
  assert.ok(out.includes('PPN 11%'));
  assert.equal(/^Pajak\s/m.test(out), false, 'muncul label generik "Pajak"');
});

test('⛔ struk CETAK ULANG ditandai (FR-B11)', async () => {
  // Struk kedua yang tidak dapat dibedakan dari yang pertama adalah alat
  // penipuan: pelanggan yang sama dapat menagih dua kali, dan tidak ada yang
  // dapat membuktikan mana yang asli.
  const pertama = await cetak(CONTOH);
  const ulang = await cetak({ ...CONTOH, cetakUlang: true });
  assert.equal(pertama.includes('CETAK ULANG'), false);
  assert.ok(ulang.includes('** CETAK ULANG **'));
});

test('⛔ MURNI — dokumen yang sama menghasilkan byte yang sama (FR-B11)', async () => {
  // Cetak ulang harus identik dengan cetakan pertama. Pembangun yang menyentuh
  // jam membuat itu mustahil dibuktikan.
  const { bangunDokumenStruk } = await import(DOK);
  assert.deepEqual(bangunDokumenStruk(CONTOH), bangunDokumenStruk(CONTOH));
});

test('kuantitas pecahan tercetak apa adanya, bukan dibulatkan', async () => {
  // Kuantitas adalah INTEGER ×1000 — `0,5 kg` disimpan `500`. Membulatkannya
  // ke satuan membuat struk timbangan salah.
  const out = await cetak({
    ...CONTOH,
    baris: [{ itemName: 'Gula Aren', variationName: 'kg', quantityMilli: 500, lineTotal: 12500 }],
  });
  assert.ok(out.includes('0,5x Gula Aren'), `dapat: ${out.split('\n').find((l) => l.includes('Gula'))}`);
});

test('modifier BERHARGA NOL tidak mencetak angka', async () => {
  const out = await cetak({
    ...CONTOH,
    baris: [
      {
        itemName: 'Kopi Susu',
        variationName: 'Regular',
        quantityMilli: 1000,
        lineTotal: 25000,
        modifier: [{ nama: 'Tanpa Gula', harga: 0 }],
      },
    ],
  });
  const line = out.split('\n').find((l) => l.includes('Tanpa Gula'));
  assert.equal(/\d/.test(line), false, `modifier gratis mencetak angka: ${JSON.stringify(line)}`);
});
