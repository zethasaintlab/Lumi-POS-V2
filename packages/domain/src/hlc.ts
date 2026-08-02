/**
 * Hybrid Logical Clock.
 *
 * Menjawab satu pertanyaan yang tidak bisa dijawab jam dinding: dari dua
 * transaksi yang dibuat di dua perangkat offline, mana yang terjadi lebih
 * dulu secara kausal? Jam perangkat kasir tidak dapat dipercaya -- NTP
 * menyesuaikan, user mengubahnya, baterai RTC habis -- jadi urutan tidak
 * boleh bergantung padanya sendirian.
 *
 * HLC menggabungkan waktu fisik (supaya nilainya masih berarti bagi manusia
 * dan mendekati waktu nyata) dengan counter logis (supaya urutannya tidak
 * pernah mundur, apa pun yang terjadi pada jam).
 *
 * ## Kenapa clock di-inject
 *
 * `CLAUDE.md`: "Lapisan sync ditulis dengan waktu, keacakan, dan I/O
 * di-inject sebagai dependensi -- prasyarat DST, dan retrofitnya mahal."
 *
 * Harness DST di F2 harus menjalankan 10.000 iterasi fault injection dengan
 * waktu yang diputar maju-mundur secara deterministik. Itu mustahil kalau
 * `Date.now()` dipanggil di dalam modul ini. Jadi `Clock` adalah parameter,
 * dan modul ini tidak pernah menyentuh waktu nyata.
 *
 * ## Pengemasan
 *
 * `(physical_ms << 16) | counter` -- 41 bit waktu + 16 bit counter = 57 bit,
 * muat di `bigint` PostgreSQL (64 bit) yang dipakai kolom `order.hlc`,
 * `order_line.hlc`, dan `payment.hlc` sejak F0.
 *
 * 57 bit MELEBIHI `Number.MAX_SAFE_INTEGER` (2^53), jadi seluruh aritmetika
 * di sini memakai `BigInt`. Memakai `number` akan kehilangan presisi
 * diam-diam -- kelas kesalahan yang sama dengan memakai float untuk uang.
 */

const COUNTER_BITS = 16n;
const COUNTER_MASK = (1n << COUNTER_BITS) - 1n;
const MAX_COUNTER = COUNTER_MASK;

export interface Clock {
  /** Milidetik sejak epoch. Satu-satunya sumber waktu modul ini. */
  now(): number;
}

export interface Hlc {
  /** Event lokal: penjualan disimpan, baris ditambahkan, pembayaran dicatat. */
  tick(): bigint;
  /** Event masuk dari perangkat lain -- menarik clock lokal naik bila perlu. */
  update(remote: bigint): bigint;
  /** Nilai terakhir tanpa memajukan apa pun. */
  current(): bigint;
}

function pack(physical: bigint, counter: bigint): bigint {
  return (physical << COUNTER_BITS) | counter;
}

function unpackPhysical(packed: bigint): bigint {
  return packed >> COUNTER_BITS;
}

function unpackCounter(packed: bigint): bigint {
  return packed & COUNTER_MASK;
}

function assertCounterFits(counter: bigint): void {
  if (counter > MAX_COUNTER) {
    // Membungkus akan membuat HLC MUNDUR, dan itu merusak urutan kausal
    // tanpa gejala apa pun sampai dua perangkat tidak sepakat soal mana
    // transaksi yang lebih baru. Lebih baik gagal keras di sini.
    throw new Error(
      `HLC counter meluap: lebih dari ${MAX_COUNTER} event dalam satu milidetik. ` +
      'Membungkus counter akan membuat HLC mundur dan merusak urutan kausal.'
    );
  }
}

export function createHlc(clock: Clock, initial?: bigint): Hlc {
  let last = initial ?? 0n;

  function advance(candidatePhysical: bigint, candidateCounter: bigint): bigint {
    assertCounterFits(candidateCounter);
    last = pack(candidatePhysical, candidateCounter);
    return last;
  }

  return {
    tick(): bigint {
      const wall = BigInt(clock.now());
      const lastPhysical = unpackPhysical(last);
      // max(): jam yang mundur tidak menurunkan physical. Yang naik counter,
      // bukan waktu yang dipaksa maju -- supaya nilainya tetap mendekati
      // waktu nyata begitu jam kembali normal.
      if (wall > lastPhysical) {
        return advance(wall, 0n);
      }
      return advance(lastPhysical, unpackCounter(last) + 1n);
    },

    update(remote: bigint): bigint {
      const wall = BigInt(clock.now());
      const lastPhysical = unpackPhysical(last);
      const remotePhysical = unpackPhysical(remote);
      const nextPhysical = wall > lastPhysical
        ? (wall > remotePhysical ? wall : remotePhysical)
        : (lastPhysical > remotePhysical ? lastPhysical : remotePhysical);

      // Counter hanya relevan bagi sisi yang physical-nya sama dengan hasil;
      // sisi yang tertinggal counter-nya tidak berarti apa-apa lagi.
      const lastCounter = nextPhysical === lastPhysical ? unpackCounter(last) : -1n;
      const remoteCounter = nextPhysical === remotePhysical ? unpackCounter(remote) : -1n;
      const highest = lastCounter > remoteCounter ? lastCounter : remoteCounter;

      // highest === -1n berarti physical maju melewati kedua sisi -- counter
      // mulai dari 0. Selain itu selalu +1, supaya hasil merge KETAT lebih
      // besar dari remote maupun lokal (dua event berbeda tidak boleh
      // berbagi HLC yang sama).
      return advance(nextPhysical, highest + 1n);
    },

    current(): bigint {
      return last;
    },
  };
}
