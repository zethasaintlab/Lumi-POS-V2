'use strict';

// ⛔ PENJAGA: kuota tidak pernah menyentuh jalur kasir.
//
// `research/09` § 6: *"tidak ada kuota yang boleh menghentikan penjualan.
// Semua penegakan terjadi pada operasi administratif (membuat outlet,
// menambah produk), tidak pernah pada alur kasir."*
//
// Definition of Done `CLAUDE.md`: *"Perilaku saat kuota terlampaui
// didefinisikan — dan tidak menghentikan penjualan."*
//
// Kenapa ini penjaga statis dan bukan test perilaku: test perilaku hanya
// dapat membuktikan bahwa kuota tidak menolak penjualan PADA KEADAAN YANG
// DIUJINYA. Merchant yang melewati kuota produk lalu menjual barang yang
// sudah ada di katalognya adalah keadaan yang tidak akan terpikir dituliskan
// sampai ia terjadi di outlet sungguhan — pada jam sibuk, tanpa internet.
//
// Yang dijaga adalah bentuk kodenya: modul jalur penjualan tidak boleh
// memanggil fungsi kuota sama sekali.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readdirSync, readFileSync, statSync } = require('node:fs');
const { join } = require('node:path');

const AKAR = join(__dirname, '..', '..');
const MODUL_SERVER = join(AKAR, 'apps', 'server', 'src', 'modules');

/**
 * Modul yang melayani kasir. `ordering` menulis penjualan dan pembatalan,
 * `payment` menerima uang, `cash` membuka dan menutup shift, `inventory`
 * menggerakkan stok saat penjualan.
 */
const MODUL_JALUR_KASIR = ['ordering', 'payment', 'cash', 'inventory'];

/** Nama-nama yang berarti "kuota sedang ditegakkan di sini". */
const POLA_KUOTA = /\b(assertKuota|periksaKuota|batasKuota|KUOTA_PAKET|max_(outlets|devices|users|products))\b/;

function berkasTs(dir) {
  const hasil = [];
  for (const nama of readdirSync(dir)) {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) hasil.push(...berkasTs(p));
    else if (nama.endsWith('.ts')) hasil.push(p);
  }
  return hasil;
}

test('⛔ modul jalur kasir tidak menyentuh kuota sama sekali', () => {
  const pelanggaran = [];

  for (const modul of MODUL_JALUR_KASIR) {
    for (const berkas of berkasTs(join(MODUL_SERVER, modul))) {
      const isi = readFileSync(berkas, 'utf8');
      isi.split(/\r?\n/).forEach((baris, i) => {
        // Komentar boleh menyebut kuota — melarangnya berarti melarang
        // menuliskan ALASAN aturan ini di tempat ia paling perlu dibaca.
        const tanpaKomentar = baris.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
        if (POLA_KUOTA.test(tanpaKomentar)) {
          pelanggaran.push(`${berkas.slice(AKAR.length + 1)}:${i + 1} — ${baris.trim()}`);
        }
      });
    }
  }

  assert.deepEqual(
    pelanggaran,
    [],
    '⛔ Kuota muncul di jalur kasir. `research/09` § 6: tidak ada kuota yang ' +
      'boleh menghentikan penjualan.\n' +
      pelanggaran.join('\n')
  );
});

test('penjaga ini benar-benar memeriksa berkas, bukan direktori kosong', () => {
  // Penjaga yang direktorinya salah ketik akan hijau selamanya sambil tidak
  // menjaga apa pun. Ditemukan sebagai kelas cacat berulang di F3: test yang
  // memeriksa keadaan yang tidak dapat terjadi.
  for (const modul of MODUL_JALUR_KASIR) {
    const berkas = berkasTs(join(MODUL_SERVER, modul));
    assert.ok(berkas.length > 0, `modul ${modul} tidak punya berkas .ts — direktorinya salah?`);
  }
});

test('⛔ pola penjaga BENAR-BENAR cocok dengan bentuk pemanggilan sungguhan', () => {
  // Penjaga yang polanya tidak pernah cocok adalah penjaga yang hijau karena
  // hampa. Diuji terhadap baris yang benar-benar ada di kode penegakan.
  const contoh = [
    "        await assertKuota(client, tenantId, 'produk', await hitungProduk(client), 1);",
    "  const hasil = periksaKuota({ dimensi, terpakai, batas: kolom[dimensi], tambahan });",
    "    'SELECT max_outlets, max_devices, max_users, max_products FROM tenant WHERE id = $1',",
  ];
  for (const baris of contoh) {
    assert.ok(POLA_KUOTA.test(baris), `pola tidak cocok: ${baris.trim()}`);
  }

  // Dan ia TIDAK boleh cocok dengan kode penjualan biasa.
  for (const baris of [
    '        const total = computeOrderTotals(lines, { roundingIncrement });',
    "        await client.query('INSERT INTO payment (id, tenant_id) VALUES ($1, $2)', [id, t]);",
  ]) {
    assert.ok(!POLA_KUOTA.test(baris), `pola terlalu lebar: ${baris.trim()}`);
  }
});
