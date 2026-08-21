'use strict';

// B-29 — aturan tampilan kenaikan paket. Murni, tanpa DOM.
//
// ⛔ Yang paling penting diuji di sini: harga yang DITAMPILKAN adalah harga
// yang DITAGIH. Angka yang diketik ulang di klien akan menyimpang pada
// perubahan harga berikutnya, dan merchant tidak punya cara mengetahui mana
// dari dua angka itu yang benar — layar yang menjanjikan Rp349.000 lalu
// menagih lain adalah kesalahan yang mahal di satu-satunya layar yang
// memutuskan pembayaran.

const { test } = require('node:test');
const assert = require('node:assert/strict');

async function modul() {
  return await import('../../apps/backoffice/src/langganan/upgrade.ts');
}

async function domain() {
  return await import('../../packages/domain/src/paket.ts');
}

test('⛔ harga per outlet SAMA PERSIS dengan HARGA_PAKET domain', async () => {
  const { susunPilihan } = await modul();
  const { HARGA_PAKET } = await domain();

  for (const p of susunPilihan('free', 1)) {
    assert.equal(
      p.hargaPerOutlet,
      HARGA_PAKET[p.paket],
      `${p.paket}: harga di layar berbeda dari harga yang ditagih server`
    );
  }
});

test('⛔ perkiraan tagihan = harga × jumlah outlet, bigint', async () => {
  const { susunPilihan } = await modul();
  const { HARGA_PAKET } = await domain();

  const pilihan = susunPilihan('free', 3);
  const standard = pilihan.find((p) => p.paket === 'standard');
  assert.equal(standard.perkiraanBulanan, HARGA_PAKET.standard * 3n);
  assert.equal(typeof standard.perkiraanBulanan, 'bigint', 'jalur uang tidak menyentuh float');
});

test('seluruh paket dirender, termasuk yang tidak dapat dibeli', async () => {
  const { susunPilihan } = await modul();
  const { URUTAN_PAKET } = await domain();

  // Menyaring yang tidak dapat dibeli membuat merchant di `pro` melihat
  // daftar berisi satu baris tanpa penjelasan apa pun — dan `enterprise`
  // menjadi tier yang tidak pernah ia tahu ada.
  const pilihan = susunPilihan('pro', 1);
  assert.deepEqual(
    pilihan.map((p) => p.paket),
    [...URUTAN_PAKET],
    'urutannya URUTAN_PAKET, bukan urutan kunci objek'
  );
});

test('⛔ paket yang tidak dapat dibeli membawa ALASAN dari domain', async () => {
  const { susunPilihan } = await modul();
  const { periksaKenaikanPaket } = await domain();

  for (const p of susunPilihan('standard', 1)) {
    if (p.dapatDibeli) {
      assert.equal(p.alasan, null);
      continue;
    }
    if (p.sedangDipakai) continue;
    // Kalimat yang sama persis dengan yang server jawab. Dua penjelasan untuk
    // satu penolakan adalah dua tempat yang akan menyimpang.
    const hasil = periksaKenaikanPaket('standard', p.paket);
    assert.equal(p.alasan, hasil.pesan);
  }
});

test('dari `free`: standard dan pro dapat dibeli, free dan enterprise tidak', async () => {
  const { susunPilihan } = await modul();
  const peta = Object.fromEntries(susunPilihan('free', 1).map((p) => [p.paket, p.dapatDibeli]));
  assert.deepEqual(peta, { free: false, standard: true, pro: true, enterprise: false });
});

test('dari `pro`: tidak ada satu pun yang dapat dibeli sendiri', async () => {
  const { susunPilihan } = await modul();
  assert.deepEqual(
    susunPilihan('pro', 1).filter((p) => p.dapatDibeli),
    []
  );
});

test('⛔ paket yang TIDAK dikenali klien tidak mematikan layar', async () => {
  // Server yang mengirim paket kelima adalah keadaan yang mungkin: klien
  // di-deploy terpisah dari server, dan versi lama akan menerima nilai baru.
  // `periksaKenaikanPaket` MELEMPAR untuk paket asing — dipanggil langsung
  // dari render, lemparan itu mematikan B-29 seluruhnya.
  const { susunPilihan } = await modul();
  const pilihan = susunPilihan('platinum', 2);
  assert.equal(pilihan.length, 4);
  for (const p of pilihan) {
    assert.equal(p.dapatDibeli, false);
    assert.match(p.alasan, /tidak dikenali aplikasi/);
  }
});

test('⛔ perkiraanTagihan mengembalikan null alih-alih MELEMPAR', async () => {
  const { perkiraanTagihan } = await modul();

  // Ketiganya melempar di `hitungTagihanBulanan`, dan ketiganya dapat sampai
  // ke render: enterprise ada di daftar paket, dan tenant tanpa outlet aktif
  // adalah keadaan yang `GET /tenants/usage` dapat kembalikan.
  assert.equal(perkiraanTagihan('enterprise', 1), null);
  assert.equal(perkiraanTagihan('standard', 0), null);
  assert.equal(perkiraanTagihan('platinum', 1), null);

  // …dan yang sah tetap dihitung.
  assert.equal(typeof perkiraanTagihan('standard', 1), 'bigint');
});

test('format rupiah mengikuti CLAUDE.md: titik ribuan, tanpa desimal', async () => {
  const { rupiah } = await modul();
  assert.equal(rupiah(0n), 'Rp 0');
  assert.equal(rupiah(1_000n), 'Rp 1.000');
  assert.equal(rupiah(349_000n), 'Rp 349.000');
  assert.equal(rupiah(1_847_000n), 'Rp 1.847.000');
  assert.equal(rupiah(-8_000n), '− Rp 8.000', 'minus memakai U+2212, bukan tanda hubung');
});

test('⛔ `expired` dibedakan dari `failed`', async () => {
  const { labelStatusTagihan, toneStatusTagihan } = await modul();

  // Yang pertama menuntut merchant meminta QR baru; yang kedua menuntut ia
  // memeriksa pembayarannya. Menyamakan keduanya membuat satu dari dua
  // tindakan itu tidak pernah terpikir.
  assert.notEqual(labelStatusTagihan('expired'), labelStatusTagihan('failed'));
  assert.equal(labelStatusTagihan('pending_confirmation'), 'Menunggu pembayaran');
  assert.equal(labelStatusTagihan('confirmed'), 'Lunas');

  // Status tak dikenal ditampilkan APA ADANYA, bukan dijatuhkan ke salah satu.
  assert.equal(labelStatusTagihan('sesuatu'), 'sesuatu');
  assert.equal(toneStatusTagihan('sesuatu'), 'neutral');
});

test('tagihanTerbuka menemukan yang pending, mengabaikan sisanya', async () => {
  const { tagihanTerbuka } = await modul();

  assert.equal(tagihanTerbuka(null), null);
  assert.equal(tagihanTerbuka({ plan: 'free', status: 'active', invoices: [] }), null);

  const riwayat = {
    plan: 'free',
    status: 'active',
    invoices: [
      { id: 'b', status: 'pending_confirmation' },
      { id: 'a', status: 'confirmed' },
    ],
  };
  assert.equal(tagihanTerbuka(riwayat).id, 'b');

  const tertutup = {
    plan: 'standard',
    status: 'active',
    invoices: [
      { id: 'c', status: 'expired' },
      { id: 'a', status: 'confirmed' },
    ],
  };
  assert.equal(tagihanTerbuka(tertutup), null);
});

// ===========================================================================
// FR-C12 — label kategori merchant
// ===========================================================================

test('⛔ setiap kategori di domain punya label, dan labelnya menyebut singkatannya', async () => {
  const { labelKategoriMerchant, LABEL_KATEGORI } = await modul();
  const { KATEGORI_MERCHANT } = await import('../../packages/domain/src/mdr.ts');

  // Daftar label diturunkan dari domain, bukan sebaliknya: kategori yang
  // ditambahkan kelak akan muncul sebagai kodenya sendiri di layar — jelek,
  // tapi bukan layar yang mati. Yang tidak boleh terjadi adalah label yang
  // tertinggal untuk kategori yang sudah dihapus.
  assert.deepEqual(
    Object.keys(LABEL_KATEGORI).sort(),
    [...KATEGORI_MERCHANT].sort(),
    'daftar label menyimpang dari daftar kategori domain'
  );

  for (const k of KATEGORI_MERCHANT) {
    const label = labelKategoriMerchant(k);
    // ⛔ Singkatan penyelenggara ikut di dalam kurung. Merchant mencocokkan
    // kategorinya dengan surat pendaftaran QRIS, dan di sana tertulis "UMI",
    // bukan "usaha mikro".
    assert.ok(
      label.includes(k.toUpperCase()),
      `label "${label}" tidak menyebut singkatan ${k.toUpperCase()}`
    );
  }
});

test('kategori yang belum diatur tidak dirender sebagai "undefined"', async () => {
  const { labelKategoriMerchant } = await modul();
  // Server versi N-1 tidak mengirim field ini sama sekali.
  assert.equal(labelKategoriMerchant(undefined), 'Belum diatur');
  // Nilai asing dirender apa adanya — jelek, tapi jujur, dan bukan layar mati.
  assert.equal(labelKategoriMerchant('koperasi'), 'koperasi');
});
