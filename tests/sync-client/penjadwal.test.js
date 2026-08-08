'use strict';

// T6 -- penjadwal relay.
//
// `kirimBatch` sudah ada sejak FR-H1 dan tidak ada satu pun yang memanggilnya.
// Ini yang memanggilnya.
//
// Timer di-INJECT, sejajar `now` yang sudah di-inject di seluruh paket ini.
// Itu yang membuat "berjalan tiap 15 detik" dapat diuji dalam milidetik dan
// tanpa browser; penjadwal yang memanggil `setTimeout` langsung hanya dapat
// diuji dengan menunggu.
//
// Keputusan user 8 Agustus 2026 (PLAN-pondasi-kasir §3.7): interval 15 detik
// saat antrean tidak kosong, berhenti saat kosong, plus dua pemicu segera --
// penulisan lokal baru, dan koneksi yang kembali.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buatDb } = require('./helpers/db');

const PENJADWAL = '../../packages/sync-client/src/penjadwal.ts';
const ENQUEUE = '../../packages/sync-client/src/enqueue.ts';

const T0 = Date.parse('2026-08-08T10:00:00.000Z');

/** Timer palsu: waktu maju hanya kalau test yang memajukannya. */
function buatTimerPalsu(mulai = T0) {
  let sekarang = mulai;
  let urut = 0;
  const antre = new Map();

  return {
    now: () => sekarang,
    setTimer(fn, ms) {
      urut += 1;
      antre.set(urut, { pada: sekarang + ms, fn });
      return urut;
    },
    clearTimer(h) {
      antre.delete(h);
    },
    jumlahTertunda: () => antre.size,
    /** Memajukan waktu dan menjalankan timer yang jatuh tempo. */
    async maju(ms) {
      sekarang += ms;
      for (const [h, t] of [...antre.entries()]) {
        if (t.pada <= sekarang) {
          antre.delete(h);
          await t.fn();
        }
      }
    },
  };
}

async function isi(db, jumlah, mulai = 1) {
  await db.transaction(async (tx) => {
    const { enqueue } = await import(ENQUEUE);
    for (let n = mulai; n < mulai + jumlah; n += 1) {
      await enqueue(tx, {
        id: `obx-${String(n).padStart(4, '0')}`,
        entityType: 'order',
        entityId: `ent-${n}`,
        operation: 'create',
        payload: {},
        idempotencyKey: `key-${n}`,
        createdAt: new Date(T0 + n).toISOString(),
      });
    }
  });
}

test('T6 mulai() memulihkan item `sending` sebelum putaran pertama', async () => {
  const { buatPenjadwal } = await import(PENJADWAL);
  const db = buatDb();
  const timer = buatTimerPalsu();
  try {
    await isi(db, 1);
    // Meniru aplikasi yang mati saat item sedang dikirim.
    await db.execute(`UPDATE outbox_local SET status = 'sending'`);

    const dilihat = [];
    const p = buatPenjadwal({
      db,
      now: timer.now,
      kirim: async (b) => {
        dilihat.push(b.id);
        return { status: 201 };
      },
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    });
    await p.mulai();

    assert.deepEqual(dilihat, ['obx-0001'], 'item `sending` tidak dipulihkan sebelum putaran');
    const [{ status }] = await db.getAll(`SELECT status FROM outbox_local`);
    assert.equal(status, 'sent');
  } finally {
    db.tutup();
  }
});

test('T6 berjalan tiap 15 detik selama antrean tidak kosong', async () => {
  const { buatPenjadwal, INTERVAL_MS } = await import(PENJADWAL);
  const db = buatDb();
  const timer = buatTimerPalsu();
  try {
    assert.equal(INTERVAL_MS, 15_000);
    await isi(db, 3);

    let putaran = 0;
    // Selalu gagal sementara, jadi antrean tidak pernah kosong.
    const p = buatPenjadwal({
      db,
      now: timer.now,
      kirim: async () => {
        putaran += 1;
        return { status: 503 };
      },
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    });

    await p.mulai();
    assert.equal(p.putaranSelesai, 1);

    // 14 detik: belum. Satu detik kemudian: iya. Ambangnya diperiksa dari dua
    // sisi -- penjadwal yang berjalan setiap tick akan lolos kalau hanya sisi
    // "sudah jalan" yang diuji.
    await timer.maju(14_000);
    assert.equal(p.putaranSelesai, 1, 'berjalan sebelum 15 detik');
    await timer.maju(1_000);
    assert.equal(p.putaranSelesai, 2);

    await timer.maju(15_000);
    assert.equal(p.putaranSelesai, 3);
    assert.ok(putaran > 0);
    p.berhenti();
  } finally {
    db.tutup();
  }
});

// Antrean kosong berarti tidak ada apa pun untuk dikirim. Penjadwal yang tetap
// berdetak setiap 15 detik selamanya membangunkan database di perangkat yang
// sedang tidak dipakai, sepanjang jam buka.
test('T6 berhenti menjadwalkan saat antrean kosong, jalan lagi saat dipicu', async () => {
  const { buatPenjadwal } = await import(PENJADWAL);
  const db = buatDb();
  const timer = buatTimerPalsu();
  try {
    await isi(db, 2);
    const p = buatPenjadwal({
      db,
      now: timer.now,
      kirim: async () => ({ status: 201 }),
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    });

    await p.mulai();
    assert.equal(p.putaranSelesai, 1);
    assert.equal(timer.jumlahTertunda(), 0, 'masih menjadwalkan padahal antrean kosong');
    assert.equal(p.menganggur, true);

    // Penjualan baru masuk antrean -> pemicu kedua (§3.7).
    await isi(db, 1, 100);
    await p.picu('tulis-lokal');
    assert.equal(p.putaranSelesai, 2);
    assert.equal(p.alasanTerakhir, 'tulis-lokal');
    p.berhenti();
  } finally {
    db.tutup();
  }
});

// Pemicu `online` menjalankan putaran SEGERA -- tanpa menunggu tick 15 detik
// berikutnya. Yang TIDAK dilakukannya: membatalkan backoff milik item.
//
// Item yang baru saja gagal tetap menunggu jatah backoff-nya sendiri meski
// koneksi sudah kembali. Itu perilaku yang sekarang, dan ia mengikuti
// spec-h:62 apa adanya. Apakah kembalinya koneksi seharusnya MERESET backoff
// adalah pertanyaan produk -- pada item yang sudah 20 kali gagal, artinya
// menunggu 60 detik lagi setelah Wi-Fi hidup. Diangkat, tidak diputuskan
// sendiri.
test('T6 koneksi kembali memicu putaran segera; backoff item tetap dihormati', async () => {
  const { buatPenjadwal } = await import(PENJADWAL);
  const db = buatDb();
  const timer = buatTimerPalsu();
  try {
    await isi(db, 1);
    let boleh = false;
    const p = buatPenjadwal({
      db,
      now: timer.now,
      kirim: async () => (boleh ? { status: 201 } : { status: null, pesan: 'offline' }),
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    });

    await p.mulai(); // gagal -> item masuk backoff 2 detik
    assert.equal(p.putaranSelesai, 1);

    boleh = true;
    await p.picu('online');
    assert.equal(p.putaranSelesai, 2, 'pemicu online tidak menjalankan putaran');
    assert.equal(p.alasanTerakhir, 'online');

    const [belum] = await db.getAll(`SELECT status FROM outbox_local`);
    assert.equal(belum.status, 'pending', 'backoff item dilanggar oleh pemicu online');

    // Anak tangga pertama spec-h:62 adalah 2 detik, tapi putaran berikutnya
    // baru datang pada tick 15 detik. Konsekuensinya: dengan tick tetap,
    // ketiga anak tangga di bawah 15 detik (2/4/8) efektif menjadi 15 detik.
    // Arahnya selalu LEBIH LAMBAT, tidak pernah lebih agresif, jadi ia tidak
    // melanggar maksud spec -- tapi ia nyata dan diangkat, bukan disembunyikan.
    await timer.maju(2_000);
    const [masihMenunggu] = await db.getAll(`SELECT status FROM outbox_local`);
    assert.equal(masihMenunggu.status, 'pending');

    await timer.maju(13_000);
    const [sesudah] = await db.getAll(`SELECT status FROM outbox_local`);
    assert.equal(sesudah.status, 'sent');
  } finally {
    db.tutup();
  }
});

// Dua putaran yang tumpang tindih mengirim item yang sama dua kali dalam
// penerbangan. Idempotency key melindungi servernya, tapi perangkat membakar
// dua kali percobaan dan dua kali kuota jaringan untuk satu item.
test('T6 putaran tidak pernah tumpang tindih; pemicu saat sibuk dijalankan sesudahnya', async () => {
  const { buatPenjadwal } = await import(PENJADWAL);
  const db = buatDb();
  const timer = buatTimerPalsu();
  try {
    await isi(db, 1);

    let sedangJalan = 0;
    let maksBersamaan = 0;
    let lepas;
    const tertahan = new Promise((r) => {
      lepas = r;
    });

    const p = buatPenjadwal({
      db,
      now: timer.now,
      kirim: async () => {
        sedangJalan += 1;
        maksBersamaan = Math.max(maksBersamaan, sedangJalan);
        await tertahan;
        sedangJalan -= 1;
        return { status: 201 };
      },
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    });

    const berjalan = p.mulai();
    const dipicu = p.picu('tulis-lokal'); // datang saat putaran pertama belum selesai
    lepas();
    await Promise.all([berjalan, dipicu]);

    assert.equal(maksBersamaan, 1, 'dua putaran berjalan bersamaan');
    assert.equal(p.putaranSelesai, 2, 'pemicu saat sibuk hilang begitu saja');
    p.berhenti();
  } finally {
    db.tutup();
  }
});

// Kegagalan DATABASE tidak boleh mematikan penjadwal diam-diam. Perangkat yang
// penjadwalnya mati terlihat persis sama dengan perangkat yang antreannya
// kosong -- sampai merchant menutup shift dan angkanya tidak cocok.
//
// Perhatikan bahwa pengirim yang MELEMPAR bukan kasus ini: `kirimBatch` sudah
// memperlakukannya sebagai respons yang hilang, dan itu benar -- permintaannya
// mungkin sudah sampai. Yang lolos sampai ke sini hanya kegagalan di sisi
// database, dan itulah yang disuntikkan.
test('T6 galat database tidak menghentikan penjadwal', async () => {
  const { buatPenjadwal } = await import(PENJADWAL);
  const db = buatDb();
  const timer = buatTimerPalsu();
  try {
    await isi(db, 1);
    const galat = [];
    let meledak = true;

    const dbRapuh = {
      ...db,
      execute: async (sql, params) => {
        if (meledak && sql.includes(`status = 'sending'`)) throw new Error('database terkunci');
        return db.execute(sql, params);
      },
    };

    const p = buatPenjadwal({
      db: dbRapuh,
      now: timer.now,
      kirim: async () => ({ status: 201 }),
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
      onGalat: (e) => galat.push(e.message),
    });

    await p.mulai();
    assert.deepEqual(galat, ['database terkunci']);
    assert.ok(timer.jumlahTertunda() > 0, 'penjadwal berhenti setelah galat');

    meledak = false;
    await timer.maju(15_000);
    const [{ status }] = await db.getAll(`SELECT status FROM outbox_local`);
    assert.equal(status, 'sent', 'penjadwal tidak pulih setelah galat database');
    p.berhenti();
  } finally {
    db.tutup();
  }
});

test('T6 berhenti() membatalkan timer dan menolak pemicu berikutnya', async () => {
  const { buatPenjadwal } = await import(PENJADWAL);
  const db = buatDb();
  const timer = buatTimerPalsu();
  try {
    await isi(db, 1);
    const p = buatPenjadwal({
      db,
      now: timer.now,
      kirim: async () => ({ status: 503 }),
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    });

    await p.mulai();
    assert.ok(timer.jumlahTertunda() > 0);
    p.berhenti();
    assert.equal(timer.jumlahTertunda(), 0);

    const sebelum = p.putaranSelesai;
    await p.picu('online');
    assert.equal(p.putaranSelesai, sebelum, 'masih berjalan setelah berhenti()');
  } finally {
    db.tutup();
  }
});
