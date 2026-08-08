'use strict';

// T9 -- acceptance criteria kelima FR-H1 (spec-h:71):
//
//   "Test: 1.000 item dalam antrean, jaringan putus-nyambung acak -> semua
//    terkirim TEPAT SEKALI"
//
// Tiga mode kegagalan disuntikkan, dan yang ketiga adalah alasan idempotency
// ada sama sekali:
//
//   1. permintaan tidak pernah sampai        -> server bersih, klien lihat null
//   2. server menjawab 5xx                   -> server bersih, klien lihat 503
//   3. server MEMPROSES lalu responsnya hilang -> server BERUBAH, klien lihat null
//
// Mode ketiga yang membedakan antrean yang benar dari yang menghasilkan
// penjualan ganda. `CLAUDE.md` menuntut idempotensi diuji "dengan retry
// berulang DAN respons yang hilang"; tanpa mode ini, test ini hanya menguji
// retry.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buatDb } = require('./helpers/db');

const RELAY = '../../packages/sync-client/src/relay.ts';
const ENQUEUE = '../../packages/sync-client/src/enqueue.ts';

const JUMLAH_ITEM = 1000;
const T0 = Date.parse('2026-08-08T10:00:00.000Z');

// RNG yang di-seed -- sama dengan tests/dst/harness.js. Kegagalan harus dapat
// diputar ulang persis; property test yang tidak deterministik melaporkan
// "kadang merah" dan tidak dapat di-debug.
function buatRng(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  return { next, chance: (p) => next() < p };
}

/**
 * Model server: idempotency key adalah satu-satunya penjaga duplikasi.
 *
 * Sengaja BUKAN server sungguhan -- yang diuji di sini protokol antreannya.
 * `tests/dst-server` yang menembak Fastify+PostgreSQL sungguhan.
 */
function buatServer() {
  const menurutKey = new Map();
  const penciptaanBaru = [];
  return {
    menurutKey,
    penciptaanBaru,
    terima(baris) {
      if (menurutKey.has(baris.idempotency_key)) {
        // Replay: server mengenali key dan mengembalikan respons asli.
        return { status: 200 };
      }
      menurutKey.set(baris.idempotency_key, baris.entity_id);
      penciptaanBaru.push(baris.entity_id);
      return { status: 201 };
    },
  };
}

test('T9 1.000 item, jaringan putus-nyambung + respons hilang -> tepat sekali', async () => {
  const { enqueue } = await import(ENQUEUE);
  const { kirimBatch, pulihkanSetelahMati } = await import(RELAY);

  const rng = buatRng(20260808);
  const server = buatServer();
  const db = buatDb();

  try {
    // Antrean dengan dependensi nyata: tiap 10 item, satu shift diikuti
    // sembilan order yang bergantung padanya. Tanpa ini, property test tidak
    // menyentuh jalur dependensi sama sekali.
    await db.transaction(async (tx) => {
      for (let n = 1; n <= JUMLAH_ITEM; n += 1) {
        const adalahShift = n % 10 === 1;
        const idShift = `obx-${String(n - ((n - 1) % 10)).padStart(4, '0')}`;
        await enqueue(tx, {
          id: `obx-${String(n).padStart(4, '0')}`,
          entityType: adalahShift ? 'shift' : 'order',
          entityId: `ent-${n}`,
          operation: 'create',
          payload: { n },
          idempotencyKey: `key-${n}`,
          createdAt: new Date(T0 + n).toISOString(),
          dependsOn: adalahShift ? null : idShift,
        });
      }
    });

    let sekarang = T0 + JUMLAH_ITEM + 1;
    const kirim = async (baris) => {
      // 1. tidak pernah sampai
      if (rng.chance(0.25)) return { status: null, pesan: 'jaringan putus' };
      // 2. server menolak sementara
      if (rng.chance(0.15)) return { status: 503, pesan: 'server sibuk' };

      const jawaban = server.terima(baris);

      // 3. SAMPAI dan diproses, tapi responsnya hilang di jalan pulang.
      if (rng.chance(0.2)) return { status: null, pesan: 'respons hilang' };
      return jawaban;
    };

    // Aplikasi juga mati sesekali di tengah pengiriman.
    let putaran = 0;
    while (putaran < 4000) {
      putaran += 1;
      if (rng.chance(0.02)) await pulihkanSetelahMati(db);

      const hasil = await kirimBatch({ db, now: () => sekarang, kirim });
      sekarang += 61_000; // melewati anak tangga terpanjang

      const [{ n: tersisa }] = await db.getAll(
        `SELECT count(*) AS n FROM outbox_local WHERE status IN ('pending','sending')`
      );
      if (tersisa === 0) break;
      assert.ok(
        hasil.terkirim + hasil.gagalSementara + hasil.gagalPermanen + hasil.ditunda > 0,
        `putaran ${putaran} tidak melakukan apa pun sementara ${tersisa} item masih menunggu -- antrean macet`
      );
    }

    const status = await db.getAll(
      `SELECT status, count(*) AS n FROM outbox_local GROUP BY status ORDER BY status`
    );
    const ringkas = Object.fromEntries(status.map((r) => [r.status, r.n]));

    assert.deepEqual(ringkas, { sent: JUMLAH_ITEM }, `masih ada yang belum terkirim: ${JSON.stringify(ringkas)}`);

    // TEPAT SEKALI. Bukan "setidaknya sekali".
    assert.equal(
      server.penciptaanBaru.length,
      JUMLAH_ITEM,
      'server membuat entitas lebih dari sekali -- penjualan ganda'
    );
    assert.equal(new Set(server.penciptaanBaru).size, JUMLAH_ITEM);
  } finally {
    db.tutup();
  }
});

// Bukti bahwa suntikan kegagalannya BEKERJA. Tanpa test ini, T9 yang hijau
// tidak dapat dibedakan dari T9 yang tidak pernah menemui kegagalan sama
// sekali -- persis pelajaran "jangkar sabotase" di CLAUDE.md.
test('T9b suntikan kegagalan benar-benar terjadi (kalau tidak, T9 hampa)', async () => {
  const { enqueue } = await import(ENQUEUE);
  const { kirimBatch } = await import(RELAY);

  const rng = buatRng(20260808);
  const server = buatServer();
  const db = buatDb();
  let gagalJaringan = 0;
  let responsHilangSetelahDiproses = 0;

  try {
    await db.transaction(async (tx) => {
      for (let n = 1; n <= 100; n += 1) {
        await enqueue(tx, {
          id: `obx-${n}`,
          entityType: 'order',
          entityId: `ent-${n}`,
          operation: 'create',
          payload: {},
          idempotencyKey: `key-${n}`,
          createdAt: new Date(T0 + n).toISOString(),
        });
      }
    });

    let sekarang = T0 + 1000;
    for (let putaran = 0; putaran < 200; putaran += 1) {
      await kirimBatch({
        db,
        now: () => sekarang,
        kirim: async (baris) => {
          if (rng.chance(0.25)) {
            gagalJaringan += 1;
            return { status: null, pesan: 'jaringan putus' };
          }
          const jawaban = server.terima(baris);
          if (rng.chance(0.3)) {
            responsHilangSetelahDiproses += 1;
            return { status: null, pesan: 'respons hilang' };
          }
          return jawaban;
        },
      });
      sekarang += 61_000;
      const [{ n }] = await db.getAll(
        `SELECT count(*) AS n FROM outbox_local WHERE status = 'pending'`
      );
      if (n === 0) break;
    }

    assert.ok(gagalJaringan > 10, `kegagalan jaringan hanya ${gagalJaringan} kali -- terlalu sedikit`);
    assert.ok(
      responsHilangSetelahDiproses > 10,
      `respons hilang setelah diproses hanya ${responsHilangSetelahDiproses} kali -- jalur paling penting nyaris tidak diuji`
    );
    assert.equal(server.penciptaanBaru.length, 100, 'tetap tepat sekali meski responsnya hilang');
  } finally {
    db.tutup();
  }
});
