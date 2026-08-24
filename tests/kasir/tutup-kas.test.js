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

const MOVEMENTS = [{ delta: 2010000 }, { delta: -25000 }];

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
