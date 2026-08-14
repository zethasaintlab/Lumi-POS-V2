'use strict';

// Harness Deterministic Simulation Testing untuk sinkronisasi.
//
// Gate F2 (`ARCH` § 14): **0 transaksi hilang atau duplikat di bawah fault
// injection, 10.000 iterasi.**
//
// ## Kenapa harness ini ada SEBELUM kode sinkronisasi ditulis
//
// `ARCH` § 11 menuntut waktu, keacakan, dan I/O di-inject sebagai dependensi
// sebelum lapisan sync ditulis, dan `CLAUDE.md` mencatat retrofitnya mahal.
// Berkas ini adalah tempat tuntutan itu ditegakkan: tidak ada satu pun
// `Date.now()`, `Math.random()`, jaringan, maupun database di seluruh
// simulasi. Setiap kegagalan dapat direproduksi persis dari seed-nya.
//
// ## Kenapa MODE CACAT ikut tinggal permanen di sini
//
// `prototypes/02-dst-sinkronisasi/FINDINGS.md` menemukan hal yang menentukan
// bentuk berkas ini: daftar invariant awal (I1–I5) hanya menangkap **1 dari 5**
// cacat yang disuntikkan. Empat lolos. Harness yang dipakai apa adanya waktu
// itu akan memberi rasa aman palsu.
//
// Karena itu kelima mode cacat tidak dibuang setelah invariant diperbaiki —
// mereka tinggal di sini sebagai bukti permanen bahwa kedelapan invariant
// tidak kosong. Ini disiplin sabotase yang sama yang dipakai di seluruh repo
// ini, hanya saja dijadikan bagian dari suite alih-alih dijalankan tangan.
//
// Satu mode sengaja **LOLOS** (`server_idem_after_tx`), dan itu bukan bug di
// harness: ia diselamatkan ULID client-generated. Membuatnya gagal berarti
// mengarang invariant yang tidak dituntut apa pun.

// `createHlc` dioper masuk, tidak di-require di sini: ia modul TypeScript di
// packages/domain, dan pemuatannya lewat `await import()` adalah urusan berkas
// test. Harness ini sendiri tetap CommonJS polos dan bebas I/O.

// --- deterministik: satu-satunya sumber keacakan dan waktu ---

/**
 * LCG. Bukan generator yang bagus secara statistik, dan itu tidak penting di
 * sini — yang penting ia **deterministik dan portabel**: seed yang sama
 * menghasilkan urutan yang sama di mesin mana pun, sehingga kegagalan dapat
 * direproduksi persis, bukan diarkeologi.
 */
function createRng(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  return {
    next,
    /** Bilangan bulat 0..n-1. */
    int: (n) => Math.floor(next() * n),
    /** true dengan peluang p. */
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
  };
}

/**
 * Jam yang hanya bergerak ketika simulasi menyuruhnya. Tidak ada `Date.now()`
 * di mana pun — dua run dengan seed sama menghasilkan stempel waktu yang sama
 * persis, termasuk di dalam HLC.
 */
function createClock(startMs) {
  let now = startMs;
  let mundur = 0;
  return {
    now: () => now,
    advance: (ms) => { now += ms; },
    /**
     * Jam melompat MUNDUR. Kejadian nyata, bukan skenario karangan: koreksi
     * NTP pada tablet murah tanpa RTC yang andal, atau pengguna yang mengubah
     * tanggal. `spec-h:351` mendaftarkannya sebagai fault yang WAJIB
     * diinjeksikan; sampai FR-H5 dikerjakan, ia tidak pernah diinjeksikan
     * sama sekali.
     */
    mundurkan: (ms) => { now -= ms; mundur += 1; },
    get jumlahMundur() { return mundur; },
  };
}

// --- model server ---

/**
 * Model server yang menirukan semantik `modules/sync` dan invariant #2.
 *
 * Ia sengaja BUKAN server sungguhan: 10.000 iterasi terhadap PostgreSQL akan
 * memakan waktu berjam-jam, dan yang diuji di sini adalah PROTOKOL, bukan
 * SQL-nya. Aturan yang ditiru dipilih karena masing-masing pernah menjadi
 * sumber cacat nyata:
 *
 *   - key sama + body sama  → kembalikan respons asli, JANGAN proses ulang
 *   - key sama + body beda  → 422
 *   - id order sudah ada    → 409 (jaring pengaman KEDUA, di luar idempotency)
 *   - record tidak pernah berubah setelah tulis pertama
 */
function createServer(options = {}) {
  const orders = new Map();
  const idempotencyKeys = new Map();
  // Snapshot saat tulis PERTAMA. I7 membandingkan ke sini, bukan ke nilai
  // sekarang -- mutasi yang menimpa dirinya sendiri tidak akan terlihat kalau
  // yang dibandingkan adalah record dengan dirinya sendiri.
  const snapshots = new Map();
  // Berapa key yang pernah dipakai untuk satu order. I8 membacanya.
  const keysPerOrder = new Map();
  // HLC tertinggi yang pernah dilihat server. Ia yang dikembalikan ke
  // perangkat, dan I9 berdiri di atasnya.
  let hlcTertinggi = 0n;

  function catatKey(orderId, key) {
    const set = keysPerOrder.get(orderId) ?? new Set();
    set.add(key);
    keysPerOrder.set(orderId, set);
  }

  return {
    orders,
    idempotencyKeys,
    snapshots,
    keysPerOrder,
    get hlcTertinggi() { return hlcTertinggi; },

    /**
     * @param {{key: string, hash: string, order: object}} req
     */
    terima(req) {
      const { key, hash, order } = req;

      const sudahAda = idempotencyKeys.get(key);
      if (sudahAda !== undefined) {
        if (sudahAda.hash !== hash) {
          return { status: 422, body: null };
        }
        return { status: sudahAda.status, body: sudahAda.body, cache: true };
      }

      // MODE CACAT `server_idem_after_tx`: key ditulis SETELAH order, bukan
      // sebelum. Dua request bersamaan sama-sama lolos pemeriksaan di atas.
      // Yang menyelamatkannya adalah PK order yang di-generate KLIEN -- dan
      // itulah yang dibuktikan mode ini (KEP-16: dua mekanisme, bukan satu).
      const tulisKeyLebihDulu = options.mode !== 'server_idem_after_tx';
      if (tulisKeyLebihDulu) {
        idempotencyKeys.set(key, { hash, status: 201, body: { id: order.id } });
      }
      catatKey(order.id, key);

      if (orders.has(order.id)) {
        if (!tulisKeyLebihDulu) {
          idempotencyKeys.set(key, { hash, status: 409, body: { id: order.id } });
        }
        return { status: 409, body: { id: order.id } };
      }

      if (order.kind === 'void') {
        const asli = orders.get(order.voidsOrderId);
        if (asli !== undefined) {
          if (options.mode === 'void_as_update') {
            // MODE CACAT: void MENGUBAH record asli alih-alih menambah baris.
            // I1-I5 tidak melihatnya sama sekali -- tidak ada yang hilang,
            // tidak ada yang ganda. Hanya I7 yang menangkapnya.
            asli.status = 'voided';
            asli.total = 0n;
          }
        }
      }

      orders.set(order.id, { ...order });
      if (!snapshots.has(order.id)) {
        snapshots.set(order.id, JSON.stringify({ ...order, total: order.total.toString() }));
      }
      // Server menyerap HLC setiap record yang masuk, lalu mengembalikannya.
      // `spec-h:157`: "Perangkat memperbarui HLC-nya setiap kali menerima HLC
      // yang lebih besar dari server." Tanpa server yang MENGEMBALIKAN
      // sesuatu, kalimat itu tidak dapat dipenuhi siapa pun.
      const masuk = BigInt(order.hlc);
      if (masuk > hlcTertinggi) hlcTertinggi = masuk;

      if (!tulisKeyLebihDulu) {
        idempotencyKeys.set(key, { hash, status: 201, body: { id: order.id } });
      }
      return { status: 201, body: { id: order.id }, hlcServer: hlcTertinggi };
    },
  };
}

// --- model perangkat ---

/**
 * Perangkat kasir dengan antrean upload persisten.
 *
 * Yang ditiru dan kenapa:
 *
 *   - **Idempotency key di-generate saat item DIBUAT**, bukan saat dikirim.
 *     Key yang lahir saat pengiriman berarti tiap retry adalah request baru
 *     bagi server (`regen_idem_on_retry`).
 *   - **Nomor struk dari counter LOKAL.** Meminta ke server berarti perangkat
 *     berhenti berjualan saat offline (`seq_from_server`) -- tidak melanggar
 *     satu pun invariant konservasi, tapi menghancurkan produknya.
 *   - **Outbox persisten.** Antrean di memori hilang saat perangkat mati
 *     (`outbox_in_memory`).
 */
function createDevice(kode, hlc, options = {}) {
  // Jam perangkat ini sendiri, terpisah dari perangkat lain. Sampai FR-H5
  // dikerjakan, seluruh perangkat di harness ini berbagi SATU jam -- jadi
  // tidak ada skew, tidak ada jam mundur, dan HLC-nya dihitung lalu diabaikan.
  const jam = options.jam ?? { now: () => 0, jumlahMundur: 0 };
  // HLC tertinggi milik server yang pernah SAMPAI ke perangkat ini. Sisi kiri
  // I9: apa pun yang dibuat setelah ini harus mengurutkan sesudahnya.
  let hlcServerTerlihat = 0n;

  /**
   * HLC untuk record baru.
   *
   * MODE CACAT `hlc_dari_jam`: nilainya diambil mentah dari jam dinding, tanpa
   * counter logis. Itu persis yang dilakukan orang yang mengira "HLC" hanyalah
   * timestamp -- dan ia bekerja sempurna sampai jam perangkat mundur.
   */
  function hlcBaru() {
    if (options.mode === 'hlc_dari_jam') {
      return (BigInt(jam.now()) << 16n).toString();
    }
    return hlc.tick().toString();
  }
  // Counter per TANGGAL BISNIS, bukan satu counter global.
  //
  // Nomor struk berbentuk `K1-20260726-0007` (CLAUDE.md § Konvensi data):
  // prefiks device + tanggal + urutan. Urutannya mulai dari 1 lagi setiap
  // tanggal bisnis baru. Satu counter global membuat urutan dua tanggal saling
  // memakan nomor, dan I4 melihatnya sebagai deret berlubang -- yang memang
  // benar, karena itu bukan penomoran yang dijanjikan konvensi.
  const counters = new Map();
  let outbox = [];
  let idSeq = 0;
  const dibuat = [];
  let gagalKarenaOffline = 0;

  return {
    kode,
    get outbox() { return outbox; },
    dibuat,
    get gagalKarenaOffline() { return gagalKarenaOffline; },
    get offsetJamMs() { return options.offsetJamMs ?? 0; },
    get jumlahJamMundur() { return jam.jumlahMundur ?? 0; },
    get hlcServerTerlihat() { return hlcServerTerlihat; },

    /**
     * Menyerap HLC yang dikembalikan server (`spec-h:157`).
     *
     * MODE CACAT `abaikan_hlc_server`: perangkat MELIHAT nilainya -- ia ada di
     * respons -- tapi tidak menggabungkannya. Dua perangkat yang jamnya
     * berbeda karena itu tidak pernah bertemu, dan transaksi yang jelas
     * terjadi SESUDAH sesuatu yang sudah dilihat perangkat dapat membawa HLC
     * yang lebih kecil. I1-I8 tidak melihat apa pun: tidak ada yang hilang,
     * tidak ada yang ganda, uangnya cocok.
     */
    terimaHlcServer(nilai) {
      if (nilai === undefined || nilai === null) return;
      const hlcServer = BigInt(nilai);
      if (hlcServer > hlcServerTerlihat) hlcServerTerlihat = hlcServer;
      if (options.mode === 'abaikan_hlc_server') return;
      if (options.mode === 'hlc_dari_jam') return;
      hlc.update(hlcServer);
    },

    /**
     * Menjual. Harus SELALU berhasil, terhubung atau tidak — itu janji utama
     * produk ini, dan I6 yang menjaganya.
     */
    jual({ terhubung, total, tanggalBisnis }) {
      if (options.mode === 'seq_from_server' && !terhubung) {
        // MODE CACAT: nomor struk diminta ke server, jadi perangkat offline
        // tidak dapat menjual sama sekali.
        gagalKarenaOffline += 1;
        return null;
      }
      const counter = (counters.get(tanggalBisnis) ?? 0) + 1;
      counters.set(tanggalBisnis, counter);
      idSeq += 1;
      const order = {
        id: `${kode}-order-${idSeq}`,
        kind: 'sale',
        device: kode,
        receiptNumber: `${kode}-${tanggalBisnis}-${String(counter).padStart(4, '0')}`,
        sequence: counter,
        businessDate: tanggalBisnis,
        total,
        status: 'open',
        hlc: hlcBaru(),
        // Sisi kiri I9, dibekukan pada saat record DIBUAT.
        hlcTerlihat: hlcServerTerlihat.toString(),
      };
      dibuat.push(order);
      outbox.push({
        // Key lahir DI SINI, bersama itemnya.
        key: `${kode}-key-${idSeq}`,
        order,
        percobaan: 0,
      });
      return order;
    },

    /** Membatalkan lewat record BARU, tidak pernah mengubah yang lama. */
    batalkan(order, tanggalBisnis) {
      const counter = (counters.get(tanggalBisnis) ?? 0) + 1;
      counters.set(tanggalBisnis, counter);
      idSeq += 1;
      const pembatal = {
        id: `${kode}-void-${idSeq}`,
        kind: 'void',
        device: kode,
        receiptNumber: `${kode}-${tanggalBisnis}-${String(counter).padStart(4, '0')}`,
        sequence: counter,
        businessDate: tanggalBisnis,
        voidsOrderId: order.id,
        total: -order.total,
        status: 'voided',
        hlc: hlcBaru(),
        // Sisi kiri I9, dibekukan pada saat record DIBUAT.
        hlcTerlihat: hlcServerTerlihat.toString(),
      };
      dibuat.push(pembatal);
      outbox.push({ key: `${kode}-key-${idSeq}`, order: pembatal, percobaan: 0 });
      return pembatal;
    },

    /** Perangkat mati dan menyala lagi. */
    mati() {
      if (options.mode === 'outbox_in_memory') {
        // MODE CACAT: antrean tidak persisten, jadi apa pun yang belum
        // terkirim lenyap. I1 dan I5 menangkapnya.
        outbox = [];
      }
    },

    ambilUntukKirim() {
      return outbox[0] ?? null;
    },

    tandaiTerkirim(item) {
      outbox = outbox.filter((o) => o !== item);
    },

    /** Key yang dipakai saat mengirim ulang. */
    keyUntuk(item) {
      if (options.mode === 'regen_idem_on_retry') {
        // MODE CACAT: key baru tiap percobaan. ULID PK tetap mencegah
        // duplikasi, jadi I1-I5 bersih -- hanya I8 yang melihatnya.
        item.percobaan += 1;
        return `${item.key}-retry-${item.percobaan}`;
      }
      return item.key;
    },
  };
}

// --- invariant ---

/**
 * Kedelapan invariant dari `FINDINGS.md` § "Delapan invariant final".
 *
 * I1–I5 adalah daftar awal; **I6, I7, dan I8 lahir karena I1–I5 meloloskan
 * empat dari lima cacat.** Urutannya dipertahankan supaya nama di sini cocok
 * dengan nama di FINDINGS dan di `sim.py`.
 */
function periksaInvariant(server, devices) {
  const pelanggaran = [];

  const semuaDibuat = devices.flatMap((d) => d.dibuat);
  const terkirim = semuaDibuat.filter((o) => server.orders.has(o.id));

  // I1 -- konservasi: setiap order yang perangkat anggap terkirim ada di
  // server. Antrean yang masih tertinggal BUKAN pelanggaran; ia hanya belum
  // sampai.
  for (const d of devices) {
    const tertinggal = new Set(d.outbox.map((o) => o.order.id));
    for (const order of d.dibuat) {
      if (!tertinggal.has(order.id) && !server.orders.has(order.id)) {
        pelanggaran.push(`I1 konservasi: ${order.id} hilang`);
      }
    }
  }

  // I2 -- tanpa duplikasi: satu nomor struk = satu order server.
  const perStruk = new Map();
  for (const o of server.orders.values()) {
    perStruk.set(o.receiptNumber, (perStruk.get(o.receiptNumber) ?? 0) + 1);
  }
  for (const [struk, jumlah] of perStruk) {
    if (jumlah > 1) {
      pelanggaran.push(`I2 duplikasi: struk ${struk} muncul ${jumlah}x`);
    }
  }

  // I3 -- konvergensi: himpunan server adalah bagian dari gabungan perangkat.
  // Server tidak boleh mengarang order yang tidak pernah dibuat siapa pun.
  const idPerangkat = new Set(semuaDibuat.map((o) => o.id));
  for (const id of server.orders.keys()) {
    if (!idPerangkat.has(id)) {
      pelanggaran.push(`I3 konvergensi: ${id} tidak berasal dari perangkat mana pun`);
    }
  }

  // I4 -- monotonisitas: nomor struk rapat per device+tanggal, tanpa lubang.
  for (const d of devices) {
    const perTanggal = new Map();
    for (const o of d.dibuat) {
      const arr = perTanggal.get(o.businessDate) ?? [];
      arr.push(o.sequence);
      perTanggal.set(o.businessDate, arr);
    }
    for (const [tanggal, urutan] of perTanggal) {
      urutan.sort((a, b) => a - b);
      for (let i = 0; i < urutan.length; i += 1) {
        if (urutan[i] !== i + 1) {
          pelanggaran.push(`I4 monotonisitas: ${d.kode}/${tanggal} berlubang di ${urutan[i]}`);
          break;
        }
      }
    }
  }

  // I5 -- konservasi uang: total di server = total order yang sampai.
  let uangPerangkat = 0n;
  for (const o of terkirim) {
    uangPerangkat += o.total;
  }
  let uangServer = 0n;
  for (const o of server.orders.values()) {
    uangServer += o.total;
  }
  if (uangPerangkat !== uangServer) {
    pelanggaran.push(`I5 uang: perangkat ${uangPerangkat} != server ${uangServer}`);
  }

  // I6 -- kemampuan jual offline. Ditambahkan karena `seq_from_server`
  // meloloskan I1-I5 sepenuhnya: perangkatnya sekadar tidak berjualan, dan
  // tidak ada yang hilang karena tidak ada yang pernah ada.
  for (const d of devices) {
    if (d.gagalKarenaOffline > 0) {
      pelanggaran.push(`I6 offline: ${d.kode} gagal menjual ${d.gagalKarenaOffline}x karena tidak terhubung`);
    }
  }

  // I7 -- immutabilitas. Dibandingkan ke SNAPSHOT saat tulis pertama, bukan
  // ke nilai sekarang: `void_as_update` mengubah record di tempat, dan
  // membandingkan record dengan dirinya sendiri tidak akan pernah melihatnya.
  for (const [id, o] of server.orders) {
    const awal = server.snapshots.get(id);
    const sekarang = JSON.stringify({ ...o, total: o.total.toString() });
    if (awal !== sekarang) {
      pelanggaran.push(`I7 immutabilitas: ${id} berubah setelah tulis pertama`);
    }
  }

  // I8 -- higienis idempotency. Ditambahkan karena `regen_idem_on_retry`
  // meloloskan I1-I5: ULID PK mencegah duplikasinya, tapi tabel idempotency
  // membengkak dan deteksi 422 rusak.
  for (const [id, keys] of server.keysPerOrder) {
    if (keys.size > 1) {
      pelanggaran.push(`I8 idempotency: ${id} punya ${keys.size} key`);
    }
  }

  // I9 -- URUTAN KAUSAL. `spec-h:336` menandainya "belum divalidasi
  // prototipe", dan sampai FR-H5 dikerjakan memang tidak ada yang membacanya:
  // seluruh perangkat berbagi satu jam, jadi tidak ada yang bisa salah.
  //
  // Bentuknya: apa pun yang perangkat BUAT setelah ia MELIHAT keadaan server
  // harus mengurutkan SESUDAH keadaan itu. Ini definisi happens-before yang
  // paling langsung yang dapat diperiksa tanpa melacak seluruh graf kausal --
  // dan ia cukup, karena satu-satunya jalan informasi masuk ke perangkat
  // adalah respons server.
  for (const d of devices) {
    for (const order of d.dibuat) {
      const terlihat = BigInt(order.hlcTerlihat ?? '0');
      if (terlihat === 0n) continue;
      if (BigInt(order.hlc) <= terlihat) {
        pelanggaran.push(
          `I9 urutan kausal: ${order.id} ber-HLC ${order.hlc} dibuat setelah perangkat ` +
            `melihat HLC server ${terlihat}`
        );
      }
    }
  }

  // I10 -- MONOTONISITAS HLC PER PERANGKAT. `spec-h:171`: "Urutan transaksi
  // berdasarkan HLC benar meskipun jam perangkat mundur."
  //
  // Satu perangkat tidak pernah boleh menghasilkan HLC yang tidak naik, apa
  // pun yang terjadi pada jam dindingnya. Ini yang membedakan HLC dari
  // timestamp, dan yang membuat `hlc_dari_jam` gagal.
  for (const d of devices) {
    let sebelumnya = null;
    for (const order of d.dibuat) {
      const kini = BigInt(order.hlc);
      if (sebelumnya !== null && kini <= sebelumnya) {
        pelanggaran.push(
          `I10 monotonisitas: ${d.kode} menghasilkan HLC ${kini} setelah ${sebelumnya}`
        );
      }
      sebelumnya = kini;
    }
  }

  return pelanggaran;
}

// --- simulasi ---

const TANGGAL = ['20260807', '20260808'];

/**
 * Satu iterasi penuh: beberapa perangkat berjualan, jaringan buruk, perangkat
 * mati di tengah, lalu semuanya diberi kesempatan menyelesaikan antrean.
 *
 * Kegagalan jaringan yang dimodelkan diambil dari `stress.py` prototipe:
 * request hilang, respons hilang (klien tidak tahu server sudah menulis), dan
 * request ganda. Yang ketiga adalah yang paling sering dilupakan orang, dan
 * satu-satunya alasan idempotency ada.
 */
function jalankanSatuIterasi({ seed, mode, createHlc, jumlahDevice = 3, langkah = 40 }) {
  const rng = createRng(seed);
  // Waktu mulai TETAP, hanya digeser seed. Tidak ada Date.now() di mana pun --
  // dua run dengan seed sama menghasilkan stempel yang sama persis, termasuk
  // di dalam HLC.
  const clock = createClock(1_754_000_000_000 + seed);

  const server = createServer({ mode });
  const devices = [];
  const jamPerangkat = [];
  for (let i = 0; i < jumlahDevice; i += 1) {
    // Setiap perangkat punya JAMNYA SENDIRI, saling geser.
    //
    // Sampai FR-H5 dikerjakan, ketiganya berbagi satu jam -- jadi HLC tidak
    // pernah diuji terhadap apa pun yang membuatnya ada. Rentang skew-nya
    // dipilih mengelilingi ambang 5 menit di `spec-h:173`: ada yang di bawah
    // ambang, ada yang jauh di atas.
    const offsetJamMs = (i - 1) * (30_000 + rng.int(600_000));
    const jam = createClock(clock.now() + offsetJamMs);
    jamPerangkat.push(jam);
    devices.push(
      createDevice(`K${i + 1}`, createHlc({ now: jam.now }), { mode, jam, offsetJamMs })
    );
  }

  for (let langkahKe = 0; langkahKe < langkah; langkahKe += 1) {
    const maju = 1 + rng.int(500);
    clock.advance(maju);
    for (const jam of jamPerangkat) jam.advance(maju);

    // Jam MUNDUR di tengah jalan: koreksi NTP, atau pengguna mengubah
    // tanggal (`spec-h:351`). Sesekali mundurnya besar sekali -- `spec-h:378`
    // menyebut perangkat yang jamnya maju setahun sebagai kasus yang harus
    // ditangani, dan arah sebaliknya sama mungkinnya.
    if (rng.chance(0.08)) {
      const korban = rng.int(jamPerangkat.length);
      jamPerangkat[korban].mundurkan(rng.chance(0.1) ? 86_400_000 : 1_000 + rng.int(600_000));
    }

    const d = rng.pick(devices);
    const terhubung = rng.chance(0.6);
    const tanggal = rng.pick(TANGGAL);

    if (rng.chance(0.55)) {
      d.jual({ terhubung, total: BigInt(1000 * (1 + rng.int(50))), tanggalBisnis: tanggal });
    } else if (rng.chance(0.15) && d.dibuat.length > 0) {
      const sasaran = rng.pick(d.dibuat.filter((o) => o.kind === 'sale'));
      if (sasaran) {
        d.batalkan(sasaran, tanggal);
      }
    }

    // Perangkat mati sesekali -- di sinilah outbox non-persisten kehilangan
    // antreannya.
    if (rng.chance(0.05)) {
      d.mati();
    }

    if (terhubung) {
      kirimSatu(d, server, rng);
    }
  }

  // Fase penyelesaian: jaringan pulih, semua antrean dikuras. Tanpa fase ini
  // I1 akan selalu punya alasan sah untuk gagal, dan invariantnya jadi tidak
  // berarti apa-apa.
  for (let putaran = 0; putaran < 200; putaran += 1) {
    let masihAda = false;
    for (const d of devices) {
      if (d.outbox.length > 0) {
        masihAda = true;
        kirimSatu(d, server, rng, { andal: true });
      }
    }
    if (!masihAda) break;
  }

  return { pelanggaran: periksaInvariant(server, devices), server, devices };
}

function kirimSatu(device, server, rng, opts = {}) {
  const item = device.ambilUntukKirim();
  if (item === null) return;

  const andal = opts.andal === true;
  // Request hilang: server tidak pernah melihatnya.
  if (!andal && rng.chance(0.3)) {
    return;
  }

  const key = device.keyUntuk(item);
  const hash = `${item.order.id}:${item.order.total}`;
  const res = server.terima({ key, hash, order: item.order });

  // Duplikat: request yang sama sampai dua kali.
  if (!andal && rng.chance(0.15)) {
    server.terima({ key, hash, order: item.order });
  }

  // Respons hilang: server SUDAH menulis, klien tidak tahu. Itemnya tetap di
  // antrean dan akan dikirim ulang -- keadaan yang membuat idempotency ada.
  if (!andal && rng.chance(0.25)) {
    return;
  }

  // HLC server diserap SEBELUM item ditandai terkirim -- urutannya tidak
  // penting bagi antrean, tapi ia menegaskan bahwa yang perangkat "lihat"
  // adalah respons, bukan pengetahuan gaib tentang isi server.
  device.terimaHlcServer(res.hlcServer);

  if (res.status === 201 || res.status === 409 || res.cache === true) {
    device.tandaiTerkirim(item);
  }
}

module.exports = {
  createRng,
  createClock,
  createServer,
  createDevice,
  periksaInvariant,
  jalankanSatuIterasi,
};
