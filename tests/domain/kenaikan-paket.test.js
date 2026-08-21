'use strict';

// F5 — aturan kenaikan paket. Murni, tanpa I/O.
//
// ⛔ Test terpenting di berkas ini adalah yang TERAKHIR, dan ia bukan tentang
// `periksaKenaikanPaket` sama sekali: ia membuktikan bahwa pembatasan "hanya
// naik" adalah yang membuat jalur pembayaran aman. Kalau kuota TIDAK naik
// monoton, merchant dapat membayar lalu kenaikannya ditolak karena
// pemakaiannya tidak muat di paket yang baru dibelinya — dan uangnya sudah
// berpindah.

const { test } = require('node:test');
const assert = require('node:assert/strict');

async function domain() {
  return await import('../../packages/domain/src/paket.ts');
}

test('kenaikan yang sah diterima', async () => {
  const { periksaKenaikanPaket } = await domain();
  assert.deepEqual(periksaKenaikanPaket('free', 'standard'), { ok: true });
  assert.deepEqual(periksaKenaikanPaket('free', 'pro'), { ok: true });
  assert.deepEqual(periksaKenaikanPaket('standard', 'pro'), { ok: true });
});

test('⛔ penurunan ditolak — ia belum dibangun, dan diam-diam menerimanya berarti membiarkan kuota dilanggar', async () => {
  const { periksaKenaikanPaket } = await domain();
  const hasil = periksaKenaikanPaket('pro', 'standard');
  assert.equal(hasil.ok, false);
  assert.equal(hasil.kode, 'PLAN_NOT_AN_UPGRADE');
  assert.match(hasil.pesan, /pro/);
  assert.match(hasil.pesan, /standard/);
});

test('paket yang sama bukan kenaikan', async () => {
  const { periksaKenaikanPaket } = await domain();
  assert.equal(periksaKenaikanPaket('standard', 'standard').kode, 'PLAN_NOT_AN_UPGRADE');
});

test('⛔ enterprise tidak dapat dibeli sendiri — harganya negosiasi', async () => {
  const { periksaKenaikanPaket } = await domain();
  // Dari `free` ini JUGA kenaikan tingkat; yang menolaknya adalah harga yang
  // `null`, bukan urutannya. Kalau penolakan harga dihapus, test ini merah
  // sementara test urutan tetap hijau.
  const hasil = periksaKenaikanPaket('free', 'enterprise');
  assert.equal(hasil.ok, false);
  assert.equal(hasil.kode, 'PLAN_NOT_SELF_SERVE');
});

test('⛔ free tidak dapat "dibeli" — tidak ada yang dapat ditagih', async () => {
  const { periksaKenaikanPaket } = await domain();
  const hasil = periksaKenaikanPaket('free', 'free');
  assert.equal(hasil.ok, false);
  // Bukan PLAN_NOT_AN_UPGRADE: sebab yang benar adalah harganya nol, dan
  // urutan diperiksa SESUDAHNYA. Merchant yang menerima "bukan kenaikan"
  // untuk paket gratis akan mencari tombol yang tidak ada.
  assert.equal(hasil.kode, 'PLAN_NOT_BILLABLE');
});

test('paket tak dikenal MELEMPAR, tidak diam-diam lolos', async () => {
  const { periksaKenaikanPaket } = await domain();
  assert.throws(() => periksaKenaikanPaket('free', 'platinum'), /tidak dikenal/);
  assert.throws(() => periksaKenaikanPaket('platinum', 'pro'), /tidak dikenal/);
});

test('⛔ URUTAN_PAKET memuat PERSIS kunci KUOTA_PAKET', async () => {
  // Daftar kedua di berkas yang sama adalah daftar yang akan menyimpang.
  // Paket kelima yang ditambahkan tanpa tingkat akan merah di sini, bukan
  // diam-diam dianggap tingkat -1 dan lolos setiap perbandingan.
  const { URUTAN_PAKET, KUOTA_PAKET, HARGA_PAKET } = await domain();
  assert.deepEqual([...URUTAN_PAKET].sort(), Object.keys(KUOTA_PAKET).sort());
  assert.deepEqual([...URUTAN_PAKET].sort(), Object.keys(HARGA_PAKET).sort());
});

test('⛔ SETIAP kenaikan yang diizinkan selalu memuat pemakaian yang muat di paket asal', async () => {
  // Inilah yang membuat merchant tidak pernah membayar lalu ditolak.
  //
  // Diperiksa sebagai PROPERTY atas seluruh pasangan (asal, tujuan) yang
  // `periksaKenaikanPaket` izinkan, dengan pemakaian yang tepat berada DI
  // BATAS paket asal — nilai paling ekstrem yang masih sah, dan satu-satunya
  // yang dapat melanggar batas tujuan bila kuota tidak naik monoton.
  const { URUTAN_PAKET, KUOTA_PAKET, periksaKenaikanPaket, periksaPerpindahanPaket } = await domain();
  const { DIMENSI_KUOTA } = await import('../../packages/domain/src/kuota.ts');

  const BATAS = {
    outlet: (k) => k.maxOutlets,
    device: (k) => k.maxDevices,
    pengguna: (k) => k.maxUsers,
    produk: (k) => k.maxProducts,
  };

  let pasangan = 0;
  for (const asal of URUTAN_PAKET) {
    for (const tujuan of URUTAN_PAKET) {
      if (!periksaKenaikanPaket(asal, tujuan).ok) continue;
      pasangan += 1;

      const pemakaian = {};
      for (const d of DIMENSI_KUOTA) {
        const batas = BATAS[d](KUOTA_PAKET[asal]);
        // `null` = tanpa batas. Angka besar dipakai sebagai wakil "banyak";
        // ia tetap harus muat di tujuan, karena tujuan yang lebih tinggi juga
        // tanpa batas pada dimensi itu.
        pemakaian[d] = batas === null ? 1_000_000 : batas;
      }

      assert.deepEqual(
        periksaPerpindahanPaket(pemakaian, tujuan),
        { ok: true },
        `${asal} → ${tujuan} menolak pemakaian yang muat di ${asal}: ` +
          'kuota tidak naik monoton, dan merchant yang membayar akan ditolak'
      );
    }
  }

  // Penjaga atas penjaganya: kalau `periksaKenaikanPaket` kelak menolak
  // segalanya, loop di atas menjadi hampa dan tetap hijau.
  assert.equal(pasangan, 3, 'free→standard, free→pro, standard→pro');
});
