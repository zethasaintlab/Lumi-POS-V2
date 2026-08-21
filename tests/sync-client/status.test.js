'use strict';

// FR-H2 & FR-H3 -- status antrean yang terlihat kasir.
//
// Seluruh keputusan di sini fungsi murni, dan itu bukan gaya: `spec-h:224`
// menuntut indikator diperbarui < 1 detik, dan satu-satunya cara memenuhi itu
// tanpa menebak adalah memisahkan "apa yang ditampilkan" dari "kapan React
// menggambarnya". Yang pertama diuji di sini; yang kedua di harness browser.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buatDb } = require('./helpers/db');

const STATUS = '../../packages/sync-client/src/status.ts';
const ENQUEUE = '../../packages/sync-client/src/enqueue.ts';

const T0 = Date.parse('2026-08-08T10:00:00.000Z');

async function isi(db, item) {
  const { enqueue } = await import(ENQUEUE);
  await db.transaction(async (tx) => {
    for (const it of item) {
      await enqueue(tx, {
        id: it.id,
        entityType: it.entityType ?? 'order',
        entityId: `ent-${it.id}`,
        operation: 'create',
        payload: it.payload ?? { total: 44400 },
        idempotencyKey: `key-${it.id}`,
        createdAt: it.createdAt,
      });
    }
  });
  for (const it of item) {
    if (it.status && it.status !== 'pending') {
      await db.execute(
        `UPDATE outbox_local SET status = ?, attempts = ?, last_error = ?, last_attempt_at = ? WHERE id = ?`,
        [it.status, it.attempts ?? 0, it.lastError ?? null, it.lastAttemptAt ?? null, it.id]
      );
    }
  }
}

// --- H2-1 ringkasan antrean -------------------------------------------------

test('H2-1 ringkasan: antrean kosong', async () => {
  const { ringkasanAntrean } = await import(STATUS);
  const db = buatDb();
  try {
    const r = await ringkasanAntrean(db);
    assert.deepEqual(r, { menunggu: 0, gagal: 0, tertuaPada: null, terakhirTerkirimPada: null });
  } finally {
    db.tutup();
  }
});

test('H2-1 ringkasan menghitung menunggu, gagal, dan item TERTUA', async () => {
  const { ringkasanAntrean } = await import(STATUS);
  const db = buatDb();
  try {
    await isi(db, [
      { id: 'a', createdAt: new Date(T0 - 7_200_000).toISOString() }, // 2 jam lalu
      { id: 'b', createdAt: new Date(T0 - 60_000).toISOString() },
      { id: 'c', createdAt: new Date(T0 - 30_000).toISOString(), status: 'sending' },
      { id: 'd', createdAt: new Date(T0 - 90_000).toISOString(), status: 'failed', lastError: 'HTTP 422' },
      {
        id: 'e',
        createdAt: new Date(T0 - 300_000).toISOString(),
        status: 'sent',
        lastAttemptAt: new Date(T0 - 120_000).toISOString(),
      },
    ]);

    const r = await ringkasanAntrean(db);
    // `sending` ikut dihitung menunggu: dari sisi kasir ia belum sampai.
    assert.equal(r.menunggu, 3);
    assert.equal(r.gagal, 1);
    assert.equal(r.tertuaPada, new Date(T0 - 7_200_000).toISOString());
    assert.equal(r.terakhirTerkirimPada, new Date(T0 - 120_000).toISOString());
  } finally {
    db.tutup();
  }
});

// Umur tertua adalah metrik kesehatan #1 (spec-h:302). Kalau ia dihitung dari
// SELURUH baris, satu item `sent` dari kemarin membuat antrean sehat terlihat
// berumur satu hari -- dan sebaliknya, item gagal lama bisa menyembunyikan
// item menunggu yang baru.
test('H2-1 tertua dihitung dari yang BELUM terkirim saja', async () => {
  const { ringkasanAntrean } = await import(STATUS);
  const db = buatDb();
  try {
    await isi(db, [
      { id: 'lama-terkirim', createdAt: new Date(T0 - 86_400_000).toISOString(), status: 'sent' },
      { id: 'baru-menunggu', createdAt: new Date(T0 - 60_000).toISOString() },
    ]);
    const r = await ringkasanAntrean(db);
    assert.equal(r.tertuaPada, new Date(T0 - 60_000).toISOString());
  } finally {
    db.tutup();
  }
});

// --- H2-2 pemetaan ke SyncIndicator ----------------------------------------

test('H2-2 antrean kosong -> ok', async () => {
  const { keadaanIndikator } = await import(STATUS);
  assert.deepEqual(keadaanIndikator({ menunggu: 0, gagal: 0 }), { state: 'ok', count: 0 });
});

test('H2-2 ada yang menunggu -> queued dengan jumlahnya', async () => {
  const { keadaanIndikator } = await import(STATUS);
  assert.deepEqual(keadaanIndikator({ menunggu: 3, gagal: 0 }), { state: 'queued', count: 3 });
});

// Item gagal tidak akan pernah pergi sendiri; yang mengantre akan. Indikator
// yang menampilkan "3 menunggu" sementara 2 item gagal permanen menyembunyikan
// satu-satunya keadaan yang menuntut tindakan orang.
test('H2-2 failed menang atas queued', async () => {
  const { keadaanIndikator } = await import(STATUS);
  assert.deepEqual(keadaanIndikator({ menunggu: 3, gagal: 2 }), { state: 'failed', count: 2 });
});

// `spec-h:210-217` menetapkan teksnya, dan aturan design system #5 melarang
// status yang hanya warna. Teks diuji PERSIS -- kalau ia boleh melenceng,
// tidak ada gunanya spec menuliskannya.
test('H2-2 teks mengikuti design system persis', async () => {
  const { teksIndikator } = await import(STATUS);
  assert.equal(teksIndikator({ state: 'ok', count: 0 }), 'Tersinkron');
  assert.equal(teksIndikator({ state: 'queued', count: 3 }), 'Offline · 3 menunggu');
  assert.equal(teksIndikator({ state: 'failed', count: 2 }), 'Gagal kirim (2) · Coba lagi');
  assert.equal(teksIndikator({ state: 'offline-only', count: 0 }), 'Hanya di perangkat ini');
});

// --- H2-3 status PER-RECORD ------------------------------------------------
//
// `spec-h:221`: "Status tersedia per-record, bukan hanya global."
// `spec-h:208` menjelaskan kenapa: sync engine yang hanya punya `isOnline`
// tidak memenuhi kebutuhan ini -- dan itu salah satu alasan jalur naik
// dibangun sendiri.

test('H2-3 status per-record dari baris outbox-nya', async () => {
  const { statusRecord } = await import(STATUS);
  assert.equal(statusRecord({ status: 'pending' }), 'queued');
  assert.equal(statusRecord({ status: 'sending' }), 'queued');
  assert.equal(statusRecord({ status: 'failed' }), 'failed');
  assert.equal(statusRecord({ status: 'sent' }), 'ok');
});

// Tidak ada baris outbox berarti tidak ada yang menunggu dikirim -- entah
// sudah dipangkas, entah memang tidak pernah antre.
test('H2-3 record tanpa baris outbox adalah ok, bukan gagal', async () => {
  const { statusRecord } = await import(STATUS);
  assert.equal(statusRecord(null), 'ok');
  assert.equal(statusRecord(undefined), 'ok');
});

test('H2-3 status tak dikenal TIDAK dilaporkan sebagai ok', async () => {
  const { statusRecord } = await import(STATUS);
  // Sejajar aturan gateway di CLAUDE.md: menebak ke arah "beres" berarti
  // memberi tahu kasir bahwa penjualannya aman berdasarkan kata yang tidak
  // dimengerti.
  assert.equal(statusRecord({ status: 'entah' }), 'queued');
});

test('H2-3 status per-record dibaca dari database untuk banyak entitas', async () => {
  const { statusRecordBanyak } = await import(STATUS);
  const db = buatDb();
  try {
    await isi(db, [
      { id: 'a', createdAt: new Date(T0).toISOString() },
      { id: 'b', createdAt: new Date(T0).toISOString(), status: 'failed' },
      { id: 'c', createdAt: new Date(T0).toISOString(), status: 'sent' },
    ]);
    const peta = await statusRecordBanyak(db, ['ent-a', 'ent-b', 'ent-c', 'ent-tidak-ada']);
    assert.deepEqual(peta, {
      'ent-a': 'queued',
      'ent-b': 'failed',
      'ent-c': 'ok',
      'ent-tidak-ada': 'ok',
    });
  } finally {
    db.tutup();
  }
});

// Satu order punya LEBIH DARI SATU baris outbox: `payment` dan `order_cancel`
// memakai `entity_id` order yang sama. Order yang pembayarannya gagal
// terkirim tidak boleh terlihat `ok` hanya karena order-nya sendiri sudah
// naik -- uangnya justru bagian yang belum tercatat.
test('H2-3 satu entitas dengan beberapa baris: status TERBURUK yang menang', async () => {
  const { statusRecordBanyak } = await import(STATUS);
  const db = buatDb();
  try {
    await isi(db, [
      { id: 'o1', entityType: 'order', createdAt: new Date(T0).toISOString(), status: 'sent' },
      { id: 'p1', entityType: 'payment', createdAt: new Date(T0 + 1).toISOString(), status: 'failed' },
      { id: 'o2', entityType: 'order', createdAt: new Date(T0).toISOString(), status: 'sent' },
      { id: 'p2', entityType: 'payment', createdAt: new Date(T0 + 1).toISOString() },
    ]);
    // `isi` memberi entity_id `ent-<id>`; disamakan supaya keduanya menunjuk
    // entitas yang sama.
    await db.execute(`UPDATE outbox_local SET entity_id = 'ord-1' WHERE id IN ('o1','p1')`);
    await db.execute(`UPDATE outbox_local SET entity_id = 'ord-2' WHERE id IN ('o2','p2')`);

    const peta = await statusRecordBanyak(db, ['ord-1', 'ord-2']);
    assert.equal(peta['ord-1'], 'failed', 'pembayaran gagal tersembunyi di balik order yang sudah naik');
    assert.equal(peta['ord-2'], 'queued');
  } finally {
    db.tutup();
  }
});

// --- H3-1 pesan gagal yang dapat dipahami ----------------------------------
//
// `spec-h:262`: "Detail item gagal menampilkan alasan yang dapat dipahami,
// bukan stack trace."

test('H3-1 kode error diterjemahkan ke kalimat, bukan ditampilkan mentah', async () => {
  const { pesanGagal } = await import(STATUS);
  assert.match(pesanGagal({ last_error: 'IDEMPOTENCY_KEY_REUSED' }), /dikirim ulang dengan isi berbeda/i);
  assert.match(pesanGagal({ last_error: 'HTTP 401' }), /sesi|masuk lagi/i);
  assert.match(pesanGagal({ last_error: 'HTTP 404' }), /tidak ditemukan/i);
  assert.match(pesanGagal({ last_error: 'jaringan' }), /koneksi/i);
});

test('H3-1 pesan yang tidak dikenal tetap ditampilkan, tidak ditelan', async () => {
  const { pesanGagal } = await import(STATUS);
  // Menyembunyikan yang tidak dimengerti membuat support kehilangan
  // satu-satunya petunjuk yang ada.
  const p = pesanGagal({ last_error: 'ECONNRESET pada handshake TLS' });
  assert.match(p, /ECONNRESET pada handshake TLS/);
});

test('H3-1 tanpa last_error tetap menghasilkan kalimat', async () => {
  const { pesanGagal } = await import(STATUS);
  assert.ok(pesanGagal({ last_error: null }).length > 0);
});

// Stack trace tidak boleh lolos ke layar kasir.
test('H3-1 stack trace dipotong, tidak ditampilkan utuh', async () => {
  const { pesanGagal } = await import(STATUS);
  const p = pesanGagal({
    last_error:
      'TypeError: gagal\n    at kirim (http://x/src/http.ts:12:9)\n    at async relay (http://x/src/relay.ts:88:5)',
  });
  assert.ok(!p.includes('\n'), 'pesan memuat baris baru -- itu stack trace');
  assert.ok(!p.includes('    at '), 'pesan memuat bingkai stack');
  assert.match(p, /TypeError: gagal/);
});

// --- H3-2 umur relatif ------------------------------------------------------

test('H3-2 umur relatif dalam bahasa Indonesia', async () => {
  const { umurRelatif } = await import(STATUS);
  const s = (detik) => umurRelatif(new Date(T0 - detik * 1000).toISOString(), T0);
  assert.equal(s(5), 'baru saja');
  assert.equal(s(59), 'baru saja');
  assert.equal(s(60), '1 menit lalu');
  assert.equal(s(3_540), '59 menit lalu');
  assert.equal(s(7_200), '2 jam lalu');
  assert.equal(s(86_400), '1 hari lalu');
  assert.equal(s(259_200), '3 hari lalu');
});

test('H3-2 null berarti belum pernah, bukan nol detik lalu', async () => {
  const { umurRelatif } = await import(STATUS);
  assert.equal(umurRelatif(null, T0), 'belum pernah');
});

// Jam perangkat dapat MUNDUR (spec-h:351). Umur negatif yang ditampilkan apa
// adanya menghasilkan "-3 jam lalu" di layar kasir.
test('H3-2 waktu di masa depan tidak menghasilkan umur negatif', async () => {
  const { umurRelatif } = await import(STATUS);
  assert.equal(umurRelatif(new Date(T0 + 3_600_000).toISOString(), T0), 'baru saja');
});

// --- H3-3 daftar gagal, paginated ------------------------------------------

test('H3-3 daftar gagal: 50 per halaman, urut tertua dulu', async () => {
  const { daftarGagal, PER_HALAMAN } = await import(STATUS);
  const { BATAS_BATCH } = await import('../../packages/sync-client/src/relay.ts');
  const db = buatDb();
  try {
    assert.equal(PER_HALAMAN, BATAS_BATCH, 'satu halaman harus sama dengan satu batch');

    const item = [];
    for (let n = 1; n <= 120; n += 1) {
      item.push({
        id: `f-${String(n).padStart(3, '0')}`,
        createdAt: new Date(T0 + n * 1000).toISOString(),
        status: n <= 110 ? 'failed' : 'pending',
        lastError: 'HTTP 422',
      });
    }
    await isi(db, item);

    const h1 = await daftarGagal(db, 0);
    assert.equal(h1.baris.length, 50);
    assert.equal(h1.total, 110);
    assert.equal(h1.baris[0].id, 'f-001', 'halaman pertama tidak dimulai dari yang tertua');

    const h3 = await daftarGagal(db, 2);
    assert.equal(h3.baris.length, 10);
    assert.equal(h3.baris[0].id, 'f-101');

    const h9 = await daftarGagal(db, 8);
    assert.deepEqual(h9.baris, []);
  } finally {
    db.tutup();
  }
});

test('H3-3 hanya item failed yang masuk daftar gagal', async () => {
  const { daftarGagal } = await import(STATUS);
  const db = buatDb();
  try {
    await isi(db, [
      { id: 'a', createdAt: new Date(T0).toISOString() },
      { id: 'b', createdAt: new Date(T0).toISOString(), status: 'sent' },
      { id: 'c', createdAt: new Date(T0).toISOString(), status: 'failed', lastError: 'HTTP 400' },
    ]);
    const h = await daftarGagal(db, 0);
    assert.equal(h.total, 1);
    assert.equal(h.baris[0].id, 'c');
  } finally {
    db.tutup();
  }
});

// --- H3-5 ukuran penyimpanan ------------------------------------------------
//
// `spec-h:264` dan AC keempat FR-H7 menuntut penggunaan storage ditampilkan.

test('H3-5 ukuran diformat gaya Indonesia, satuan SI', async () => {
  const { formatUkuran } = await import(STATUS);
  assert.equal(formatUkuran(0), '0 MB');
  assert.equal(formatUkuran(312_000_000), '312 MB');
  assert.equal(formatUkuran(2_000_000_000), '2,0 GB');
  assert.equal(formatUkuran(1_500_000_000), '1,5 GB');
  // Di bawah satu MB tetap "0 MB", bukan "0,0004 MB" -- layar kasir tidak
  // menampilkan presisi yang tidak berarti bagi siapa pun.
  assert.equal(formatUkuran(4_096), '0 MB');
});

test('H3-5 ukuran yang tidak diketahui tidak dikarang jadi nol', async () => {
  const { formatUkuran } = await import(STATUS);
  assert.equal(formatUkuran(null), 'tidak diketahui');
  assert.equal(formatUkuran(undefined), 'tidak diketahui');
});

// --- H3-4 ekspor darurat ----------------------------------------------------
//
// `spec-h:256`: "jaring pengaman terakhir dan harus selalu tersedia."
// `spec-h:263`: "menghasilkan file yang dapat dibaca manusia."

test('H3-4 ekspor memuat SELURUH antrean yang belum terkirim', async () => {
  const { buatEksporDarurat } = await import(STATUS);
  const db = buatDb();
  try {
    await isi(db, [
      { id: 'a', createdAt: new Date(T0 - 1000).toISOString(), payload: { total: 44400 } },
      { id: 'b', createdAt: new Date(T0).toISOString(), status: 'failed', lastError: 'HTTP 422' },
      { id: 'c', createdAt: new Date(T0).toISOString(), status: 'sent' },
    ]);

    const teks = await buatEksporDarurat(db, { deviceCode: 'K1', sekarang: T0 });

    assert.match(teks, /a/);
    assert.match(teks, /b/);
    // Yang sudah terkirim tidak perlu diselamatkan -- server sudah punya.
    assert.ok(!teks.includes('ent-c'), 'item yang sudah terkirim ikut diekspor');
    assert.match(teks, /K1/);
    assert.match(teks, /2 item/);
  } finally {
    db.tutup();
  }
});

test('H3-4 ekspor dapat dibaca manusia: payload di-format, bukan satu baris JSON', async () => {
  const { buatEksporDarurat } = await import(STATUS);
  const db = buatDb();
  try {
    await isi(db, [{ id: 'a', createdAt: new Date(T0).toISOString(), payload: { total: 44400, kasir: 'Sari' } }]);
    const teks = await buatEksporDarurat(db, { deviceCode: 'K1', sekarang: T0 });

    assert.match(teks, /"total": 44400/, 'payload tidak di-format');
    assert.match(teks, /Menunggu terkirim|Gagal terkirim/);
    // Berkas ini dibaca orang support saat perangkat rusak. Judul kolomnya
    // harus bahasa Indonesia, sejajar seluruh antarmuka.
    assert.match(teks, /Dibuat|Perangkat/);
  } finally {
    db.tutup();
  }
});

test('H3-4 antrean kosong tetap menghasilkan berkas yang menjelaskan', async () => {
  const { buatEksporDarurat } = await import(STATUS);
  const db = buatDb();
  try {
    const teks = await buatEksporDarurat(db, { deviceCode: 'K1', sekarang: T0 });
    assert.match(teks, /0 item|tidak ada/i);
    assert.ok(teks.length > 40, 'berkas kosong tidak menjelaskan apa pun');
  } finally {
    db.tutup();
  }
});

// ---------------------------------------------------------------------------
// Alat koreksi F6 — ekspor pemulihan (JSON, dapat diputar ulang)
// ---------------------------------------------------------------------------

test('⛔ ekspor pemulihan membawa idempotency key ASLI', async () => {
  // Ini yang membuat pemulihan aman dijalankan DUA KALI — sifat yang harus
  // dimiliki alat yang dipakai orang panik. Key yang di-generate ulang saat
  // pemulihan akan menghasilkan penjualan GANDA pada setiap item yang
  // sebenarnya sudah sampai.
  const { buatEksporPemulihan } = await import(STATUS);
  const db = buatDb();
  try {
    await isi(db, [
      { id: 'o1', entityType: 'order', createdAt: '2026-08-08T09:00:00.000Z', status: 'failed' },
      { id: 'o2', entityType: 'payment', createdAt: '2026-08-08T09:01:00.000Z' },
    ]);

    const hasil = await buatEksporPemulihan(db, { deviceCode: 'K1', sekarang: T0 });
    assert.equal(hasil.versi, 1);
    assert.equal(hasil.deviceCode, 'K1');
    assert.deepEqual(
      hasil.item.map((i) => i.idempotencyKey),
      ['key-o1', 'key-o2'],
      'key yang sama dengan yang dipakai relay — bukan yang baru'
    );
    assert.deepEqual(hasil.item.map((i) => i.entityType), ['order', 'payment']);
  } finally {
    db.tutup();
  }
});

test('⛔ payload disimpan sebagai STRING, byte demi byte', async () => {
  // Server menghitung hash request dari BODY untuk mendeteksi "key sama, body
  // berbeda" (`IDEMPOTENCY_KEY_REUSED`). Apa pun yang mengubah byte body
  // mengubah retry yang sah menjadi 422 permanen — dan berkas pemulihan yang
  // mengubah byte-nya adalah berkas yang SETIAP itemnya ditolak, di hari yang
  // paling buruk untuk menemukannya.
  const { buatEksporPemulihan } = await import(STATUS);
  const db = buatDb();
  try {
    await isi(db, [{ id: 'o1', createdAt: '2026-08-08T09:00:00.000Z', payload: { total: 44400 } }]);

    const [tersimpan] = await db.getAll('SELECT payload FROM outbox_local WHERE id = ?', ['o1']);
    const hasil = await buatEksporPemulihan(db, { deviceCode: 'K1', sekarang: T0 });

    assert.equal(typeof hasil.item[0].payload, 'string');
    assert.equal(hasil.item[0].payload, tersimpan.payload, 'byte body tidak boleh berubah');
  } finally {
    db.tutup();
  }
});

test('yang sudah `sent` tidak ikut — server sudah punya', async () => {
  const { buatEksporPemulihan } = await import(STATUS);
  const db = buatDb();
  try {
    await isi(db, [
      { id: 'o1', createdAt: '2026-08-08T09:00:00.000Z', status: 'sent' },
      { id: 'o2', createdAt: '2026-08-08T09:01:00.000Z', status: 'failed' },
      { id: 'o3', createdAt: '2026-08-08T09:02:00.000Z' },
    ]);
    const hasil = await buatEksporPemulihan(db, { deviceCode: 'K1', sekarang: T0 });
    assert.deepEqual(hasil.item.map((i) => i.id), ['o2', 'o3']);
  } finally {
    db.tutup();
  }
});

test('⛔ setiap jenis yang punya rute relay juga punya rute di alat pemulihan', async () => {
  // Alat pemulihan memeriksa jenis SEBELUM mengirim satu permintaan pun —
  // berhenti di tengah adalah keadaan yang paling sulit dijelaskan kepada
  // merchant: sebagian penjualannya masuk, sebagian tidak, dan tidak ada yang
  // tahu batasnya di mana. Penjaga ini memastikan daftarnya tidak menyimpang
  // dari `RUTE_DIDUKUNG`.
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const { RUTE_DIDUKUNG } = await import('../../packages/sync-client/src/http.ts');
  const alat = readFileSync(join(__dirname, '..', '..', 'tools', 'pulihkan-antrean.mjs'), 'utf8');

  const hilang = RUTE_DIDUKUNG.filter((jenis) => !new RegExp(`^\\s*${jenis}:`, 'm').test(alat));
  assert.deepEqual(hilang, [], `tools/pulihkan-antrean.mjs tidak punya rute untuk: ${hilang.join(', ')}`);
});
