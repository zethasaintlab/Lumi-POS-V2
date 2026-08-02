'use strict';

// T0a -- Hybrid Logical Clock (keputusan Q3 di PLAN-ordering-fondasi.md).
//
// `order.hlc`, `order_line.hlc`, dan `payment.hlc` semuanya `bigint NOT NULL`
// sejak F0. Nilainya harus datang dari suatu tempat sebelum satu baris
// penjualan pun bisa ditulis.
//
// CLAUDE.md: "Lapisan sync ditulis dengan waktu, keacakan, dan I/O di-inject
// sebagai dependensi -- prasyarat DST, dan retrofitnya mahal." Karena itu
// clock adalah parameter, bukan Date.now() yang dipanggil di dalam. Tanpa itu,
// harness DST di F2 (10.000 iterasi fault injection) mustahil dibangun: tidak
// ada cara memutar waktu maju-mundur secara deterministik.
//
// Nilai dikemas jadi satu bigint: (physical_ms << 16) | counter.
// - physical_ms epoch saat ini ~1.78e12, butuh 41 bit
// - counter 16 bit = 65536 event per milidetik
// - total 57 bit, muat di bigint PostgreSQL (64 bit)
//
// 57 bit MELEBIHI Number.MAX_SAFE_INTEGER (2^53), jadi seluruh aritmetikanya
// WAJIB BigInt. Memakai Number di sini akan kehilangan presisi diam-diam --
// kelas bug yang sama persis dengan memakai float untuk uang.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const COUNTER_BITS = 16n;
const COUNTER_MASK = (1n << COUNTER_BITS) - 1n;

function physical(packed) {
  return Number(packed >> COUNTER_BITS);
}

function counter(packed) {
  return Number(packed & COUNTER_MASK);
}

// Clock palsu: satu-satunya sumber waktu. Kalau implementasi memanggil
// Date.now() di dalam, test "clock palsu mengendalikan hasil" akan gagal.
function fakeClock(startMs) {
  let t = startMs;
  return {
    now: () => t,
    set: (ms) => { t = ms; },
    advance: (ms) => { t += ms; },
  };
}

test('tick: physical mengikuti clock yang di-inject, bukan Date.now()', async () => {
  const { createHlc } = await import('../../packages/domain/src/hlc.ts');
  const clock = fakeClock(1_000_000_000_000);
  const hlc = createHlc(clock);
  assert.equal(physical(hlc.tick()), 1_000_000_000_000);
  clock.set(1_700_000_000_000);
  assert.equal(physical(hlc.tick()), 1_700_000_000_000);
});

test('tick: dua panggilan pada milidetik yang sama menaikkan counter, nilainya naik', async () => {
  const { createHlc } = await import('../../packages/domain/src/hlc.ts');
  const hlc = createHlc(fakeClock(1_700_000_000_000));
  const a = hlc.tick();
  const b = hlc.tick();
  const c = hlc.tick();
  assert.equal(counter(a), 0);
  assert.equal(counter(b), 1);
  assert.equal(counter(c), 2);
  assert.ok(b > a && c > b, 'nilai HLC harus naik walau milidetiknya sama');
});

test('tick: counter direset saat milidetik maju', async () => {
  const { createHlc } = await import('../../packages/domain/src/hlc.ts');
  const clock = fakeClock(1_700_000_000_000);
  const hlc = createHlc(clock);
  hlc.tick();
  hlc.tick();
  clock.advance(1);
  const next = hlc.tick();
  assert.equal(counter(next), 0);
  assert.equal(physical(next), 1_700_000_000_001);
});

// INI alasan HLC ada. Jam perangkat kasir BISA mundur -- NTP menyesuaikan,
// user mengubah jam, baterai RTC habis. Kalau HLC ikut mundur, urutan kausal
// transaksi rusak dan sync tidak bisa memutuskan mana yang lebih baru.
test('tick: clock mundur TIDAK membuat HLC mundur', async () => {
  const { createHlc } = await import('../../packages/domain/src/hlc.ts');
  const clock = fakeClock(1_700_000_000_000);
  const hlc = createHlc(clock);
  const before = hlc.tick();

  clock.set(1_600_000_000_000); // jam mundur 100 detik
  const after = hlc.tick();

  assert.ok(after > before, `HLC mundur: ${before} -> ${after}`);
  assert.equal(physical(after), 1_700_000_000_000, 'physical bertahan di nilai tertinggi yang pernah dilihat');
  assert.equal(counter(after), 1, 'counter yang naik, bukan physical yang mundur');
});

test('tick: monotonik ketat sepanjang 1000 panggilan dengan clock kacau', async () => {
  const { createHlc } = await import('../../packages/domain/src/hlc.ts');
  const clock = fakeClock(1_700_000_000_000);
  const hlc = createHlc(clock);
  // Urutan deterministik (bukan Math.random) supaya kegagalan bisa diulang.
  const jitter = [0, 1, -5, 2, -1, 0, 7, -3, 0, 1];
  let prev = hlc.tick();
  for (let i = 0; i < 1000; i++) {
    clock.advance(jitter[i % jitter.length]);
    const next = hlc.tick();
    assert.ok(next > prev, `tidak monotonik di iterasi ${i}: ${prev} -> ${next}`);
    prev = next;
  }
});

test('update: HLC remote yang lebih tinggi menarik clock lokal naik', async () => {
  const { createHlc } = await import('../../packages/domain/src/hlc.ts');
  const hlc = createHlc(fakeClock(1_700_000_000_000));
  const remote = (1_700_000_005_000n << COUNTER_BITS) | 3n;

  const merged = hlc.update(remote);
  assert.ok(merged > remote, 'hasil merge harus melampaui remote, bukan menyamainya');
  assert.equal(physical(merged), 1_700_000_005_000);

  // Event lokal berikutnya tetap di atas hasil merge.
  assert.ok(hlc.tick() > merged);
});

test('update: HLC remote yang lebih rendah tidak menurunkan clock lokal', async () => {
  const { createHlc } = await import('../../packages/domain/src/hlc.ts');
  const hlc = createHlc(fakeClock(1_700_000_000_000));
  const local = hlc.tick();
  const remote = (1_600_000_000_000n << COUNTER_BITS) | 9n;

  const merged = hlc.update(remote);
  assert.ok(merged > local, `merge harus tetap naik: ${local} -> ${merged}`);
  assert.equal(physical(merged), 1_700_000_000_000);
});

test('update: physical sama pada kedua sisi memakai counter tertinggi lalu menaikkannya', async () => {
  const { createHlc } = await import('../../packages/domain/src/hlc.ts');
  const hlc = createHlc(fakeClock(1_700_000_000_000));
  hlc.tick(); // counter lokal 0
  const remote = (1_700_000_000_000n << COUNTER_BITS) | 41n;

  const merged = hlc.update(remote);
  assert.equal(physical(merged), 1_700_000_000_000);
  assert.equal(counter(merged), 42, 'max(counter lokal, counter remote) + 1');
});

test('nilai selalu bigint, tidak pernah number -- 57 bit melampaui MAX_SAFE_INTEGER', async () => {
  const { createHlc } = await import('../../packages/domain/src/hlc.ts');
  const hlc = createHlc(fakeClock(1_700_000_000_000));
  const v = hlc.tick();
  assert.equal(typeof v, 'bigint');
  assert.ok(v > BigInt(Number.MAX_SAFE_INTEGER), 'nilai memang di atas 2^53 -- Number akan kehilangan presisi');
});

test('counter meluap ditolak, tidak dibiarkan membungkus diam-diam', async () => {
  const { createHlc } = await import('../../packages/domain/src/hlc.ts');
  const hlc = createHlc(fakeClock(1_700_000_000_000));
  // 65536 tick pada milidetik yang sama menghabiskan ruang counter 16 bit.
  // Membungkus akan membuat HLC MUNDUR -- diam-diam merusak urutan kausal.
  // Lebih baik meledak keras.
  assert.throws(
    () => { for (let i = 0; i < 70000; i++) hlc.tick(); },
    /counter/i,
    'overflow counter harus melempar, bukan membungkus'
  );
});
