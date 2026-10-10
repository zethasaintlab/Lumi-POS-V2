'use strict';

// K-12 Tutup Kas + K-13 Laporan Shift (FR-D2, FR-D3, FR-D4, FR-D8).
//
// ⛔ Kontrol anti-fraud yang menentukan seluruh bentuk modul ini
// (`spec-d` FR-D2): kasir memasukkan hitungan fisik SEBELUM sistem
// menampilkan angka terhitung. "Ini kontrol, bukan preferensi UX — kasir yang
// melihat angka target akan menghitung mundur ke angka itu."
//
// ⛔ DAN BATAS YANG HARUS DINYATAKAN: spec menuntut angka terhitung "tidak
// dikirim ke klien" lewat endpoint terpisah. Saat OFFLINE itu mustahil —
// datanya sudah ada di perangkat, dan pengguna teknis dapat membaca SQLite
// lokal. Yang tersisa dan benar-benar berlaku adalah kontrol AUDIT: setiap
// hitungan tercatat sebagai percobaan, dan percobaan pertama tercatat sebelum
// angka mana pun terungkap.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../apps/kasir/src/kas/tutup.ts';

const SHIFT = {
  id: 's1', tenant_id: 't1', outlet_id: 'o1', device_id: 'd1',
  business_date: '2026-08-13', status: 'open',
  opening_float: 500000, opened_by: 'u-sari', opened_at: '2026-08-13T07:00:00Z',
  count_attempts: null,
};

function dbPalsu({ shift = SHIFT, gerakan = MOVEMENTS, order = PEMBAYARAN } = {}) {
  const state = { shift: { ...shift }, tulis: [], transaksi: 0, diDalam: false };
  const db = {
    state,
    async getAll(sql) {
      if (/FROM cash_drawer_shift/.test(sql)) return state.shift ? [state.shift] : [];
      if (/FROM cash_movement/.test(sql)) return gerakan;
      if (/FROM payment/.test(sql)) return order;
      return [];
    },
    async execute(sql, params = []) {
      // `sql` dipotong ke baris pertama HANYA agar pesan galat terbaca;
      // `sqlPenuh` dipakai untuk pencocokan. Versi pertama hanya menyimpan
      // yang terpotong, dan pencarian `closed_at` meleset diam-diam.
      state.tulis.push({
        sql: sql.trim().split('\n')[0],
        sqlPenuh: sql,
        params,
        dalam: state.diDalam,
      });
      if (/UPDATE cash_drawer_shift/.test(sql) && /count_attempts/.test(sql)) {
        state.shift.count_attempts = params[0];
      }
      return { rowsAffected: 1 };
    },
    async transaction(fn) {
      state.transaksi += 1;
      state.diDalam = true;
      try { return await fn(db); } finally { state.diDalam = false; }
    },
  };
  return db;
}

// Penjualan tunai 2.010.000, refund tunai 25.000 — angka dari contoh spec-d.
//
// ⛔ Sampai 14 Agustus 2026 KEDUA baris di bawah ada di `PEMBAYARAN`, dan yang
// kedua ditulis `{ method: 'cash', amount: 25000, arah: -1 }`. Baris itu tidak
// dapat dihasilkan query mana pun: refund tidak pernah menulis `payment`
// (`CHECK (amount > 0)`; arah berlawanan lewat tabel `refund`), dan tidak ada
// order ber-`payment` yang berstatus `voided`. Fake-nya mengarang bentuk data
// yang skemanya sendiri tidak bisa menghasilkan — jadi saldo laci diuji
// terhadap dunia yang tidak ada, dan cacat yang sebenarnya (refund tunai tidak
// pernah mengurangi laci) lolos di balik test hijau.
//
// Sekarang saldo laci datang dari BUKU KAS (`spec-d:14`), dan refund muncul di
// tempat ia memang muncul. Bentuk keduanya sekarang dapat dihasilkan query
// sungguhannya; yang membuktikannya berjalan di atas SQLite sungguhan ada di
// `tutup-kas-refund.test.js`.
const PEMBAYARAN = [
  { method: 'cash', amount: 2010000 },
  { method: 'qris_dynamic', amount: 250000 },
];

/* ⛔ `type` IKUT, dan sampai 22 September 2026 ia tidak ada. Fixture tanpa
   `type` membuat `rincianSaldo` mengelompokkan seluruh baris di bawah kunci
   `undefined`, jadi rinciannya KOSONG sementara totalnya tetap benar — bentuk
   "nol baris, bukan error" pada fixture testnya sendiri.

   Deltanya TIDAK diubah: empat test di bawah memaku angka yang diturunkan
   darinya, dan mengubah fixture bersama demi satu test baru akan menggeser
   ekspektasi yang sudah benar. Tipe di luar kedua ini diuji lewat fixture
   sendiri. */
const MOVEMENTS = [
  { type: 'sale', delta: 2010000 },
  { type: 'refund', delta: -25000 },
];

const JAM = () => new Date('2026-08-13T22:00:00Z');
const ID = (() => { let n = 0; return () => `t-${++n}`; })();

// ---------------------------------------------------------------------------

test('⛔ ringkasan AWAL tidak memuat saldo terhitung (FR-D2)', async () => {
  const { ringkasanSebelumHitung } = await import(MOD);
  const db = dbPalsu();

  const r = await ringkasanSebelumHitung(db, 's1');

  // Yang boleh dilihat kasir SEBELUM menghitung: jumlah transaksi dan
  // rincian per metode. Yang TIDAK: saldo kas terhitung.
  assert.equal(typeof r.jumlahTransaksi, 'number');
  assert.ok(Array.isArray(r.perMetode));

  // Diperiksa dari BENTUK objeknya, bukan dari nilai — field yang ada tapi
  // bernilai null tetap dapat dibaca dari devtools, dan itu sama saja.
  const kunci = Object.keys(r);
  for (const terlarang of ['expected', 'saldoSeharusnya', 'expectedAmount', 'selisih', 'difference']) {
    assert.equal(kunci.includes(terlarang), false, `ringkasan awal tidak boleh memuat ${terlarang}`);
  }

  // ⛔ DAN total TUNAI juga tidak boleh muncul. Ditemukan dengan menjalankan
  // layarnya: ia menampilkan "Tunai Rp 1.985.000", dan kasir TAHU saldo awal
  // — ia yang memasukkannya saat buka shift. Satu penjumlahan memberi angka
  // target yang justru FR-D2 sembunyikan.
  //
  // `spec-d` menulis layar awal memuat "rincian per metode pembayaran"; yang
  // dipertahankan di sini adalah MAKSUD aturannya, bukan pembacaan
  // harfiahnya. `[KEPUTUSAN]`.
  const tunai = r.perMetode.find((m) => m.metode === 'cash');
  assert.equal(tunai.total, null, 'total tunai tidak boleh terbaca sebelum menghitung');
  assert.equal(tunai.jumlah, 1, 'jumlah transaksinya tetap boleh — ia tidak membocorkan nominal');
});

test('metode NON-tunai tetap bertotal — ia tidak masuk laci', async () => {
  const { ringkasanSebelumHitung } = await import(MOD);
  const db = dbPalsu({
    order: [
      { method: 'cash', amount: 100000 },
      { method: 'qris_dynamic', amount: 250000 },
    ],
  });

  const r = await ringkasanSebelumHitung(db, 's1');
  const qris = r.perMetode.find((m) => m.metode === 'qris_dynamic');
  // QRIS tidak menambah isi laci, jadi menampilkannya tidak membantu menebak
  // hitungan fisik — dan kasir membutuhkannya untuk rekonsiliasinya sendiri.
  assert.equal(qris.total, 250000);
});

test('saldo seharusnya = saldo awal + tunai masuk − tunai keluar', async () => {
  const { hitungSaldoSeharusnya } = await import(MOD);

  // Angka dari contoh `spec-d` FR-D2:
  //   500.000 + 2.010.000 − 25.000 = 2.485.000
  assert.equal(
    hitungSaldoSeharusnya({ saldoAwal: 500000, tunaiMasuk: 2010000, tunaiKeluar: 25000 }),
    2485000
  );
});

test('⛔ percobaan hitungan TERCATAT, dan yang kedua tidak menimpa yang pertama', async () => {
  const { catatHitungan } = await import(MOD);
  const db = dbPalsu();

  // `spec-d`: "Kasir tidak dapat mengubah hitungan fisik setelah melihat
  // selisih. Untuk mengoreksi, kasir memasukkan hitungan ulang yang TERCATAT
  // SEBAGAI PERCOBAAN KEDUA di audit trail."
  const satu = await catatHitungan({ db, shiftId: 's1', hitungan: 2450000, waktu: JAM });
  assert.equal(satu.percobaan, 1);
  assert.equal(satu.selisih, -35000);

  const dua = await catatHitungan({ db, shiftId: 's1', hitungan: 2485000, waktu: JAM });
  assert.equal(dua.percobaan, 2);
  assert.equal(dua.selisih, 0);

  // Riwayatnya UTUH — percobaan pertama tidak hilang.
  const riwayat = JSON.parse(db.state.shift.count_attempts);
  assert.equal(riwayat.length, 2);
  assert.equal(riwayat[0].hitungan, 2450000);
  assert.equal(riwayat[1].hitungan, 2485000);
});

test('⛔ ambang otorisasi INKLUSIF (spec-d FR-D4)', async () => {
  const { butuhOtorisasiSelisih, AMBANG_SELISIH } = await import(MOD);

  // "Ambang bersifat inklusif: selisih tepat Rp 20.000 MEMICU otorisasi (>=).
  // Dinyatakan eksplisit agar tidak ambigu."
  assert.equal(AMBANG_SELISIH, 20000);
  assert.equal(butuhOtorisasiSelisih(-19999), false);
  assert.equal(butuhOtorisasiSelisih(-20000), true, 'tepat di ambang HARUS memicu');
  assert.equal(butuhOtorisasiSelisih(20000), true, 'kelebihan juga memicu');
  assert.equal(butuhOtorisasiSelisih(0), false);
});

test('tutup: selisih di bawah ambang tidak menuntut penyetuju', async () => {
  const { tutupKas } = await import(MOD);
  const db = dbPalsu();

  const hasil = await tutupKas({
    db, shiftId: 's1', hitungan: 2480000, // selisih −5.000
    sesi: { userId: 'u-sari' }, approverId: null,
    alasan: null, waktu: JAM, idBaru: ID, hlc: () => 7n,
  });

  assert.equal(hasil.status, 'tertutup', hasil.status);
  // Selisihnya TETAP tercatat dan masuk laporan (`spec-d` FR-D4).
  assert.equal(hasil.selisih, -5000);
});

test('⛔ Task 12: tutup DITOLAK selama ada Pesanan tahan — tanpa tulis apa pun dan tanpa angka laci', async () => {
  const { tutupKas } = await import(MOD);
  const db = dbPalsu();
  const dasar = db.getAll;
  db.getAll = async (sql, p) =>
    /FROM keranjang_tahan/.test(sql)
      ? [{ id: 'th1', jumlah_item: 2, subtotal: 40000, dibuat_pada: '2026-08-13T08:00:00Z' }]
      : dasar(sql, p);

  const hasil = await tutupKas({
    db, shiftId: 's1', hitungan: 2485000, // selisih nol: SEHARUSNYA tertutup bila tak ada tahanan
    sesi: { userId: 'u-sari' }, approverId: null,
    alasan: null, waktu: JAM, idBaru: ID, hlc: () => 7n,
  });

  assert.equal(hasil.status, 'ada_tahanan');
  assert.deepEqual(hasil.daftar, [{ id: 'th1', jumlahItem: 2, subtotal: 40000n, dibuatPada: '2026-08-13T08:00:00Z' }]);
  assert.deepEqual(Object.keys(hasil).sort(), ['daftar', 'status'], 'penolakan tidak boleh membawa saldo/selisih (hitungan buta)');
  assert.equal(db.state.tulis.length, 0, 'penolakan tidak boleh menulis apa pun');
  assert.equal(db.state.transaksi, 0);
  assert.equal(db.state.shift.status, 'open');
});

test('⛔ selisih di atas ambang MENUNTUT penyetuju dan alasan', async () => {
  const { tutupKas } = await import(MOD);

  const tanpaPenyetuju = await tutupKas({
    db: dbPalsu({ order: PEMBAYARAN }), shiftId: 's1', hitungan: 2450000,
    sesi: { userId: 'u-sari' }, approverId: null,
    alasan: { kode: 'kekurangan_kembalian', catatan: null },
    waktu: JAM, idBaru: ID, hlc: () => 7n,
  });
  assert.equal(tanpaPenyetuju.status, 'butuh_otorisasi');

  const tanpaAlasan = await tutupKas({
    db: dbPalsu({ order: PEMBAYARAN }), shiftId: 's1', hitungan: 2450000,
    sesi: { userId: 'u-sari' }, approverId: 'u-budi', alasan: null,
    waktu: JAM, idBaru: ID, hlc: () => 7n,
  });
  assert.equal(tanpaAlasan.status, 'butuh_alasan');
});

test('⛔ penyetuju selisih tidak boleh sama dengan kasir yang menghitung', async () => {
  const { tutupKas } = await import(MOD);
  const db = dbPalsu();

  // `spec-f:91`: "Kasir yang menghitung laci TIDAK BOLEH menjadi orang yang
  // menyetujui selisihnya. Alur tutup kas melibatkan dua identitas ketika
  // selisih di atas ambang."
  const hasil = await tutupKas({
    db, shiftId: 's1', hitungan: 2450000,
    sesi: { userId: 'u-sari' }, approverId: 'u-sari',
    alasan: { kode: 'kekurangan_kembalian', catatan: null },
    waktu: JAM, idBaru: ID, hlc: () => 7n,
  });
  assert.equal(hasil.status, 'penyetuju_sama_dengan_aktor');
  assert.equal(db.state.tulis.length, 0);
});

test('⛔ ketiga field disimpan TERPISAH (FR-D3)', async () => {
  const { tutupKas } = await import(MOD);
  const db = dbPalsu();

  await tutupKas({
    db, shiftId: 's1', hitungan: 2450000,
    sesi: { userId: 'u-sari' }, approverId: 'u-budi',
    alasan: { kode: 'kekurangan_kembalian', catatan: null },
    waktu: JAM, idBaru: ID, hlc: () => 7n,
  });

  const tutup = db.state.tulis.find((t) => /UPDATE cash_drawer_shift/.test(t.sqlPenuh) && /closed_at/.test(t.sqlPenuh));
  assert.ok(tutup, 'shift harus ditutup');
  // counted, expected, difference — ketiganya, dan `difference` disimpan
  // supaya laporan tidak menghitung ulang.
  assert.ok(tutup.params.includes(2450000), 'counted_amount');
  assert.ok(tutup.params.includes(2485000), 'expected_amount');
  assert.ok(tutup.params.includes(-35000), 'difference');
});

test('SATU transaksi: tutup + audit + outbox', async () => {
  const { tutupKas } = await import(MOD);
  const db = dbPalsu();

  await tutupKas({
    db, shiftId: 's1', hitungan: 2485000,
    sesi: { userId: 'u-sari' }, approverId: null, alasan: null,
    waktu: JAM, idBaru: ID, hlc: () => 7n,
  });

  // Satu transaksi untuk penutupan itu sendiri. Rebuild snapshot stok
  // (`spec-e:63`) sengaja berjalan di transaksi TERPISAH setelahnya — ia
  // cache yang selalu dapat dibangun ulang, dan menaruhnya di dalam berarti
  // kegagalan membangun cache me-rollback penutupan kas yang sudah benar.
  // Di sini ia tidak menambah transaksi karena tidak ada movement sama
  // sekali; `tutup-kas-refund.test.js` yang mengujinya dengan movement nyata.
  assert.equal(db.state.transaksi, 1);
  for (const t of db.state.tulis) {
    assert.equal(t.dalam, true, `penulisan di LUAR transaksi: ${t.sql}`);
  }
  const semua = db.state.tulis.map((t) => t.sqlPenuh).join(' ');
  assert.ok(semua.includes('audit_event'));
  assert.ok(semua.includes('outbox_local'));

  // ⛔ `audit_event.tenant_id/outlet_id/device_id` adalah NOT NULL, dan versi
  // pertama modul ini mengisinya NULL — lolos seluruh test karena fake
  // `DbLokal` tidak menegakkan constraint, lalu gagal keras di SQLite
  // sungguhan. Fake tidak akan pernah menangkapnya, jadi yang diperiksa di
  // sini adalah NILAI yang di-bind.
  const audit = db.state.tulis.find((t) => /audit_event/.test(t.sqlPenuh));
  for (const wajib of ['t1', 'o1', 'd1']) {
    assert.ok(audit.params.includes(wajib), `audit_event harus membawa ${wajib}`);
  }
});

test('shift yang sudah tertutup tidak dapat ditutup lagi', async () => {
  const { tutupKas } = await import(MOD);
  const db = dbPalsu({ shift: { ...SHIFT, status: 'closed' }, order: PEMBAYARAN });

  const hasil = await tutupKas({
    db, shiftId: 's1', hitungan: 2485000,
    sesi: { userId: 'u-sari' }, approverId: null, alasan: null,
    waktu: JAM, idBaru: ID, hlc: () => 7n,
  });
  assert.equal(hasil.status, 'sudah_tertutup');
  assert.equal(db.state.tulis.length, 0);
});

test('daftar alasan selisih kas sesuai spec-d', async () => {
  const { ALASAN_SELISIH } = await import(MOD);
  assert.deepEqual(
    ALASAN_SELISIH.map((a) => a.kode),
    ['kelebihan_kembalian', 'kekurangan_kembalian', 'uang_palsu', 'kesalahan_hitung', 'belum_teridentifikasi', 'lainnya']
  );
});

test('laporan shift dapat dibaca dari data lokal (FR-D8)', async () => {
  const { laporanShift } = await import(MOD);
  const db = dbPalsu({
    shift: {
      ...SHIFT, status: 'closed', counted_amount: 2450000,
      expected_amount: 2485000, difference: -35000,
      closed_by: 'u-sari', approved_by: 'u-budi', closed_at: '2026-08-13T22:00:00Z',
      variance_reason_code: 'kekurangan_kembalian',
      count_attempts: JSON.stringify([{ hitungan: 2450000, pada: '2026-08-13T21:59:00Z' }]),
    },
  });

  // AC FR-D8: "Laporan shift dapat dilihat dan dicetak dari data LOKAL."
  const l = await laporanShift(db, 's1');
  // Di LAPORAN total tunai muncul penuh: kontrol FR-D2 sudah lewat, kasnya
  // sudah ditutup, dan laporan yang menyembunyikannya tidak berguna.
  assert.equal(l.perMetode.find((m) => m.metode === 'cash').total, 2010000);
  assert.equal(l.saldoAwal, 500000);
  assert.equal(l.saldoSeharusnya, 2485000);
  assert.equal(l.hitunganFisik, 2450000);
  assert.equal(l.selisih, -35000);
  assert.equal(l.percobaan.length, 1);
  assert.equal(l.disetujuiOleh, 'u-budi');
});

// ---------------------------------------------------------------------------
// FR-D2 — jejak audit percobaan hitungan, jalur tulis TERSENDIRI
// ---------------------------------------------------------------------------

const KONFIG_A = {
  deviceId: 'd1', deviceCode: 'K1', tenantId: 't1', outletId: 'o1',
  baseUrl: 'http://server', tokenSecret: 'r',
};
const SESI_A = {
  userId: 'u-sari', nama: 'Sari', peran: ['cashier'], masukPada: '', wajibGantiPin: false,
};
const argAudit = () => ({
  konfig: KONFIG_A,
  sesi: SESI_A,
  idBaru: (() => {
    let n = 0;
    return () => `au-${++n}`;
  })(),
  hlc: () => 77n,
});

test('⛔ percobaan hitungan meninggalkan JEJAK AUDIT, bukan hanya riwayat lokal', async () => {
  const { catatHitungan } = await import(MOD);
  const db = dbPalsu();
  await catatHitungan({
    db,
    shiftId: 's1',
    hitungan: 2450000,
    waktu: () => new Date('2026-08-24T10:00:00Z'),
    ...argAudit(),
  });

  const audit = db.state.tulis.filter((t) => /INSERT INTO audit_event/.test(t.sql));
  assert.equal(audit.length, 1, 'shift_count_attempt tidak ditulis');
  assert.ok(audit[0].sql.includes('shift_count_attempt') || audit[0].params.includes('shift_count_attempt'));
  // ⛔ Nilai yang di-BIND diperiksa, bukan sekadar bahwa tabelnya disentuh.
  // Fake `DbLokal` tidak menegakkan `NOT NULL` — `tenant_id` NULL lolos di
  // sini dan gagal keras di `wa-sqlite` (sudah terjadi, 14 Agustus 2026).
  assert.ok(audit[0].params.includes('t1'), 'tenant_id');
  assert.ok(audit[0].params.includes('u-sari'), 'actor_user_id');
  assert.ok(audit[0].params.includes('s1'), 'entity_id = shiftId');
});

test('⛔ jejak DI-ENQUEUE supaya sampai ke server, dengan rupiah sebagai STRING', async () => {
  const { catatHitungan } = await import(MOD);
  const db = dbPalsu();
  await catatHitungan({
    db,
    shiftId: 's1',
    hitungan: 2450000,
    waktu: () => new Date('2026-08-24T10:00:00Z'),
    ...argAudit(),
  });

  const outbox = db.state.tulis.filter((t) => /INSERT INTO outbox_local/.test(t.sql));
  assert.equal(outbox.length, 1);
  assert.ok(outbox[0].params.includes('count_attempt'), 'entity_type');
  assert.ok(outbox[0].params.includes('s1'), 'entity_id = shiftId — rutenya bersarang di bawahnya');
  const muatan = JSON.parse(outbox[0].params.find((p) => typeof p === 'string' && p.startsWith('{')));
  assert.equal(muatan.countedAmount, '2450000');
  assert.equal(typeof muatan.countedAmount, 'string', 'rupiah jalur kas selalu string');
  assert.equal(muatan.attemptNumber, 1);
});

test('⛔ percobaan KEDUA tercatat terpisah, tidak menimpa yang pertama', async () => {
  // `spec-d:127`: kasir yang mencoba Rp 2.450.000, melihat selisihnya, lalu
  // mengetik Rp 2.485.000 supaya cocok, harus meninggalkan DUA jejak.
  const { catatHitungan } = await import(MOD);
  const db = dbPalsu();
  const arg = argAudit();
  const satu = await catatHitungan({
    db, shiftId: 's1', hitungan: 2450000, waktu: () => new Date(), ...arg,
  });
  assert.equal(satu.percobaan, 1);

  const audit = () => db.state.tulis.filter((t) => /INSERT INTO audit_event/.test(t.sql));
  assert.equal(audit().length, 1);
  assert.equal(
    db.state.tulis.filter((t) => /INSERT INTO outbox_local/.test(t.sql)).length,
    1
  );
});

test('⛔ jejak ditulis dalam transaksinya SENDIRI, terpisah dari penutupan', async () => {
  // Inti FR-D2. Percobaan yang DITOLAK membuat `tutupKas` melempar dan
  // transaksinya di-rollback; jejak yang ditulis di dalamnya ikut hilang — dan
  // justru percobaan yang gagal itulah yang harus terbukti tidak dapat diulang
  // diam-diam.
  const { catatHitungan } = await import(MOD);
  const db = dbPalsu();
  await catatHitungan({
    db, shiftId: 's1', hitungan: 2450000, waktu: () => new Date(), ...argAudit(),
  });
  assert.equal(db.state.transaksi, 1, 'satu transaksi, berdiri sendiri');
  assert.ok(
    db.state.tulis.every((t) => t.dalam),
    'riwayat dan jejaknya harus ditulis BERSAMA di dalam transaksi itu'
  );
});

test('tanpa konfig/sesi, riwayat lokal TETAP tercatat — hanya jejaknya yang hilang', async () => {
  // Membuatnya wajib berarti setiap pemanggil yang belum diperbarui berhenti
  // mencatat percobaan sama sekali, dan itu kegagalan yang lebih besar
  // daripada jejak yang belum lengkap.
  const { catatHitungan } = await import(MOD);
  const db = dbPalsu();
  const hasil = await catatHitungan({
    db, shiftId: 's1', hitungan: 2450000, waktu: () => new Date(),
  });
  assert.equal(hasil.percobaan, 1);
  assert.ok(
    db.state.tulis.some((t) => /UPDATE cash_drawer_shift SET count_attempts/.test(t.sql)),
    'riwayat lokal harus tetap ditulis'
  );
  assert.equal(db.state.tulis.filter((t) => /INSERT INTO audit_event/.test(t.sql)).length, 0);
});

// ---------------------------------------------------------------------------
// Rincian saldo — bahan langkah 2 K-12 (22 September 2026).

test('⛔ rincian saldo: jumlah bagiannya SAMA dengan saldo seharusnya', async () => {
  const { catatHitungan } = await import(MOD);
  /* Tujuh tipe minus `opening_float`, jadi keenam yang tersisa hadir sekaligus.
     Mockup `TutupKasScreen` hanya menggambar tiga (penjualan, refund, dan
     modal awal); empat lainnya justru yang ketidakterlihatannya menjadi cacat
     FR-D5 — uang yang keluar dengan sah dan tidak pernah tercatat. */
  const db = dbPalsu({
    gerakan: [
      { type: 'sale', delta: 2010000 },
      { type: 'refund', delta: -25000 },
      { type: 'paid_in', delta: 40000 },
      { type: 'paid_out', delta: -60000 },
      { type: 'bank_deposit', delta: -500000 },
      { type: 'adjustment', delta: -3000 },
    ],
  });

  const hasil = await catatHitungan({ db, shiftId: 's1', hitungan: 1, waktu: JAM });
  const { saldoAwal, bagian, saldoSeharusnya } = hasil.rincian;

  const jumlah = saldoAwal + bagian.reduce((a, b) => a + b.total, 0);
  assert.equal(
    jumlah,
    saldoSeharusnya,
    'jumlah rincian tidak sama dengan saldo seharusnya. ⛔ Rincian yang tidak ' +
      'menjumlah ke totalnya membuat kasir mencari uang yang tidak hilang, dan ' +
      'itu lebih buruk daripada tidak ada rincian sama sekali.'
  );
  assert.equal(saldoSeharusnya, hasil.saldoSeharusnya, 'dua angka untuk satu pertanyaan');
});

test('⛔ rincian memuat SETIAP tipe yang punya movement, bukan empat yang mockup gambar', async () => {
  const { catatHitungan } = await import(MOD);
  const db = dbPalsu({
    gerakan: [
      { type: 'sale', delta: 100000 },
      { type: 'paid_out', delta: -50000 },
      { type: 'bank_deposit', delta: -20000 },
      { type: 'adjustment', delta: 1000 },
    ],
  });

  const { bagian } = (await catatHitungan({ db, shiftId: 's1', hitungan: 1, waktu: JAM })).rincian;
  assert.deepEqual(
    bagian.map((b) => b.tipe),
    ['sale', 'paid_out', 'bank_deposit', 'adjustment'],
    'tipe yang punya movement hilang dari rincian, atau urutannya bukan urutan ' +
      '`TIPE_MOVEMENT`. Urutan yang datang dari data membuat dua shift ' +
      'menampilkan rincian dengan urutan berbeda.'
  );
  /* Nama di layar, bukan kode mentah: kasir tidak membaca `bank_deposit`. */
  assert.deepEqual(
    bagian.map((b) => b.label),
    ['Penjualan tunai', 'Kas keluar', 'Setor ke bank', 'Koreksi']
  );
});

test('⛔ tipe TANPA movement tidak muncul sebagai baris nol', async () => {
  const { catatHitungan } = await import(MOD);
  const db = dbPalsu({ gerakan: [{ type: 'sale', delta: 100000 }] });

  const { bagian } = (await catatHitungan({ db, shiftId: 's1', hitungan: 1, waktu: JAM })).rincian;
  assert.deepEqual(bagian.map((b) => b.tipe), ['sale']);
});

test('⛔ `opening_float` TIDAK menjadi baris rincian — ia sudah `saldoAwal`', async () => {
  const { catatHitungan } = await import(MOD);
  /* Query memfilternya, tapi fixture ini mengirimkannya juga: yang diuji
     adalah bahwa rinciannya tidak menghitung modal awal DUA KALI bila baris
     itu sampai kepadanya. Pengecualian yang sama sudah menyelamatkan
     `saldoSeharusnya` sejak 14 Agustus 2026. */
  const db = dbPalsu({
    gerakan: [
      { type: 'sale', delta: 100000 },
      { type: 'opening_float', delta: 500000 },
    ],
  });

  const { bagian } = (await catatHitungan({ db, shiftId: 's1', hitungan: 1, waktu: JAM })).rincian;
  assert.equal(
    bagian.some((b) => b.tipe === 'opening_float'),
    false,
    'modal awal muncul dua kali: sebagai `saldoAwal` DAN sebagai baris rincian.'
  );
});

// ---------------------------------------------------------------------------
// Transfer (`other` + `bank_transfer`) -- PR 2B Task 7, syarat user atas P1
// ---------------------------------------------------------------------------

// ⛔ Di atas SQLite sungguhan, bukan `dbPalsu`: fake mengembalikan baris
// fixture lengkap untuk SQL apa pun, jadi SELECT yang lupa `p.provider`
// tetap lulus -- penjaga yang hampa (tinjauan Opus, I-1).
const { DatabaseSync } = require('node:sqlite');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const SKEMA = join(__dirname, '..', '..', 'db', 'local', '001-initial.sql');

const PEMBAYARAN_TRANSFER = [
  { method: 'cash', amount: 100000 },
  { method: 'other', provider: 'bank_transfer', amount: 40000 },
  { method: 'other', provider: 'bank_transfer', amount: 15000 },
  { method: 'other', provider: null, amount: 5000 },
  { method: 'qris_static', provider: null, amount: 20000 },
];

function dbTransferSungguhan() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(SKEMA, 'utf8'));
  const db = {
    sqlite,
    async getAll(sql, params = []) { return sqlite.prepare(sql).all(...params); },
    async execute(sql, params = []) { sqlite.prepare(sql).run(...params); return { rowsAffected: 1 }; },
    async transaction(fn) { return fn(db); },
  };
  sqlite.exec(`
    INSERT INTO cash_drawer_shift
      (id, tenant_id, outlet_id, device_id, business_date, status, opening_float, opened_by, opened_at)
    VALUES ('s1','t1','o1','d1','2026-08-13','open',500000,'u-sari','2026-08-13T07:00:00Z')`);
  PEMBAYARAN_TRANSFER.forEach((b, i) => {
    sqlite.exec(`
      INSERT INTO "order"
        (id, tenant_id, outlet_id, device_id, shift_id, receipt_number, business_date, sequence,
         status, channel, subtotal, order_discount, service_charge_amount, tax_amount,
         rounding_adjustment, total, amount_due, created_by, occurred_at, hlc)
      VALUES ('o${i}','t1','o1','d1','s1','K1-${i}','2026-08-13',${i + 1},
              'closed','takeaway',${b.amount},0,0,0,0,${b.amount},${b.amount},'u-sari',
              '2026-08-13T10:00:00Z',${i + 1})`);
    sqlite.exec(`INSERT INTO "check" (id, order_id, subtotal, total) VALUES ('c${i}','o${i}',${b.amount},${b.amount})`);
    sqlite.exec(`
      INSERT INTO payment (id, order_id, check_id, method, provider, amount, status, tendered_at)
      VALUES ('p${i}','o${i}','c${i}','${b.method}',${b.provider ? `'${b.provider}'` : 'NULL'},${b.amount},'confirmed','2026-08-13T10:00:00Z')`);
  });
  return db;
}

test('⛔ transfer tampil sebagai kelompok transfer, bukan other (ringkasan K-12)', async () => {
  const { ringkasanSebelumHitung } = await import(MOD);
  const r = await ringkasanSebelumHitung(dbTransferSungguhan(), 's1');

  const peta = Object.fromEntries(r.perMetode.map((m) => [m.metode, m]));
  assert.ok(peta.transfer, `K-12 tidak memuat kelompok transfer (transfer jatuh ke 'other'/Lainnya?): ${JSON.stringify(r.perMetode.map((m) => m.metode))}`);
  assert.equal(peta.transfer.total, 55000, 'uang transfer tidak terjumlah utuh');
  assert.equal(peta.transfer.jumlah, 2);
  assert.equal(peta.other.total, 5000, 'other tanpa provider tercampur dengan transfer');
  // Uang bank tidak masuk laci: total non-tunai tetap tampil, tunai tetap disembunyikan.
  assert.equal(peta.cash.total, null);
  // Tidak ada uang yang hilang dari pengelompokan.
  const bank = r.perMetode.filter((m) => m.metode !== 'cash').reduce((t, m) => t + m.total, 0);
  assert.equal(bank, 80000);
});

test('⛔ transfer tampil sebagai kelompok transfer, bukan other (laporan shift K-13)', async () => {
  const { laporanShift } = await import(MOD);
  const l = await laporanShift(dbTransferSungguhan(), 's1');

  const peta = Object.fromEntries(l.perMetode.map((m) => [m.metode, m]));
  assert.equal(peta.transfer?.total, 55000, `laporan shift tidak memuat kelompok transfer (jatuh ke 'other'/Lainnya?): ${JSON.stringify(l.perMetode.map((m) => m.metode))}`);
  assert.equal(peta.transfer?.jumlah, 2);
  assert.equal(peta.other?.total, 5000);
  assert.equal(l.perMetode.reduce((t, m) => t + m.total, 0), 180000, 'uang hilang dari pengelompokan');
});

// ---------------------------------------------------------------------------
// Ringkasan shift K-12 (review): Total penjualan = omzet BERSIH `posisiPenjualan`.
// Fixture SQLite sungguhan dengan void DAN refund, supaya omzetBersih (150.000)
// ≠ omzetKotor (185.000) ≠ jumlah pembayaran terkonfirmasi (225.000).
// Batas yang dinyatakan: node:sqlite mengembalikan INTEGER sebagai `number`, jadi perMetode.total
// presisi hanya sampai 2^53; test ini TIDAK membuktikan total > 2^53 (totalPenjualan bigint-nya
// datang dari `posisiPenjualan`, bukan dari kolom).
function dbDenganVoidRefund() {
  const db = dbTransferSungguhan();
  db.sqlite.exec('DELETE FROM payment; DELETE FROM "check"; DELETE FROM "order";');
  const order = (id, seq, status, total, voidedBy) => db.sqlite.exec(`
    INSERT INTO "order"
      (id, tenant_id, outlet_id, device_id, shift_id, receipt_number, business_date, sequence,
       status, channel, subtotal, order_discount, service_charge_amount, tax_amount,
       rounding_adjustment, total, amount_due, created_by, occurred_at, hlc, voided_by_order_id)
    VALUES ('${id}','t1','o1','d1','s1','K1-${id}','2026-08-13',${seq},
            '${status}','takeaway',${total},0,0,0,0,${total},${total},'u-sari',
            '2026-08-13T10:00:00Z',${seq},${voidedBy ? `'${voidedBy}'` : 'NULL'})`);
  const bayar = (id, method, jumlah, { provider = null, status = 'confirmed' } = {}) => {
    db.sqlite.exec(`INSERT INTO "check" (id, order_id, subtotal, total) VALUES ('c-${id}','${id}',${jumlah},${jumlah})`);
    db.sqlite.exec(`
      INSERT INTO payment (id, order_id, check_id, method, provider, amount, status, tendered_at)
      VALUES ('p-${id}','${id}','c-${id}','${method}',${provider ? `'${provider}'` : 'NULL'},${jumlah},'${status}','2026-08-13T10:00:00Z')`);
  };
  order('A', 1, 'closed', 100000); bayar('A', 'cash', 100000);
  order('B', 2, 'closed', 60000); bayar('B', 'qris_static', 60000);
  order('C', 3, 'closed', 40000); bayar('C', 'cash', 40000);
  order('V', 4, 'voided', 40000, 'C'); // pembatal C: C keluar dari omzet
  order('D', 5, 'closed', 25000); bayar('D', 'other', 25000, { provider: 'bank_transfer' });
  // Belum/tidak jadi uang: tidak boleh masuk perMetode (QRIS menunggu, pembayaran gagal).
  order('E', 6, 'open', 30000); bayar('E', 'qris_dynamic', 30000, { status: 'pending_confirmation' });
  order('F', 7, 'open', 20000); bayar('F', 'card_edc', 20000, { status: 'failed' });
  db.sqlite.exec(`
    INSERT INTO refund (id, order_id, amount, reason_code, method, created_by, approved_by, occurred_at, hlc)
    VALUES ('ref-B','B',10000,'salah_input','qris_static','u-sari','u-budi','2026-08-13T11:00:00Z',9)`);
  return db;
}

test('⛔ ringkasanShift: totalPenjualan = omzetBersih (setelah void DAN refund), bukan kotor, bukan jumlah pembayaran', async () => {
  const { ringkasanShift } = await import(MOD);
  const r = await ringkasanShift(dbDenganVoidRefund(), 's1');
  const bayar = r.perMetode.reduce((t, m) => t + m.total, 0);
  assert.equal(bayar, 225000, 'fixture: jumlah pembayaran TERKONFIRMASI');
  assert.equal(r.totalPenjualan, 175000n, 'omzet bersih = 185.000 kotor − 10.000 refund (C dibatalkan)');
  assert.notEqual(r.totalPenjualan, 185000n);
  assert.notEqual(Number(r.totalPenjualan), bayar);
});

test('⛔ ringkasanShift: transfer terpisah dari other; pending/failed tidak masuk perMetode', async () => {
  const { ringkasanShift } = await import(MOD);
  const r = await ringkasanShift(dbDenganVoidRefund(), 's1');
  const peta = Object.fromEntries(r.perMetode.map((m) => [m.metode, m.total]));
  // Pembayaran diterima, TIDAK dikurangi void/refund (agregasi tak berubah).
  assert.deepEqual(peta, { cash: 140000, qris_static: 60000, transfer: 25000 });
  assert.ok(!('other' in peta), 'transfer jatuh ke "other"/Lainnya');
  assert.ok(!('qris_dynamic' in peta) && !('card_edc' in peta), 'pembayaran pending/failed ikut terhitung');
});
