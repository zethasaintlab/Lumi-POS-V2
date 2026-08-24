'use strict';

// FR-C3 — keterjangkauan server, diuji tanpa jaringan dan tanpa browser.
//
// ⛔ Yang paling penting diuji: `navigator.onLine === true` TIDAK PERNAH
// menyimpulkan terjangkau. Browser melaporkan keadaan antarmuka, bukan
// keterjangkauan — dan kafe yang Wi-Fi-nya menyala dengan uplink mati,
// captive portal yang belum di-login, serta DNS yang tidak menjawab semuanya
// melaporkan `true`. Ketiganya keadaan nyata di outlet.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../apps/kasir/src/lokal/keterjangkauan.ts';

const BASE = 'http://server.uji';

/** Pendengar palsu yang dapat dipicu test. */
function pendengarPalsu() {
  const peta = new Map();
  return {
    pasang(nama, fn) {
      peta.set(nama, fn);
      return () => peta.delete(nama);
    },
    picu(nama) {
      peta.get(nama)?.();
    },
  };
}

const tunggu = () => new Promise((r) => setImmediate(r));

// ---------------------------------------------------------------------------

test('⛔ navigator.onLine=false → TIDAK menembak sama sekali', async () => {
  // Browser tahu tidak ada antarmuka; menembak hanya membuang empat detik
  // yang kasir habiskan menunggu di depan pelanggan.
  const { periksaJangkauan } = await import(MOD);
  let dipanggil = 0;
  const hasil = await periksaJangkauan({
    baseUrl: BASE,
    daring: () => false,
    fetchFn: async () => {
      dipanggil += 1;
      return { ok: true };
    },
  });
  assert.equal(hasil, false);
  assert.equal(dipanggil, 0, 'tidak boleh ada permintaan');
});

test('⛔ navigator.onLine=true saja TIDAK cukup — fetch yang melempar berarti tidak terjangkau', async () => {
  // Inti modul ini. Wi-Fi menyala, uplink mati: `onLine` true, `fetch`
  // melempar. Kode yang mempercayai `onLine` akan menampilkan QRIS dinamis
  // sebagai aktif di sini.
  const { periksaJangkauan } = await import(MOD);
  const hasil = await periksaJangkauan({
    baseUrl: BASE,
    daring: () => true,
    fetchFn: async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    },
  });
  assert.equal(hasil, false);
});

test('server yang menjawab — apa pun statusnya — dihitung terjangkau', async () => {
  // ⛔ Termasuk 5xx. Yang ditanyakan "apakah permintaan saya SAMPAI", bukan
  // "apakah server sehat": server yang menjawab 503 tetap dapat menerima order
  // pada percobaan berikutnya, sementara lemparan berarti tidak ada apa pun di
  // ujung sana.
  const { periksaJangkauan } = await import(MOD);
  for (const status of [200, 404, 500, 503]) {
    const hasil = await periksaJangkauan({
      baseUrl: BASE,
      daring: () => true,
      fetchFn: async () => ({ status, ok: status < 400 }),
    });
    assert.equal(hasil, true, `status ${status}`);
  }
});

test('⛔ probe yang MENGGANTUNG dibatalkan, tidak menunggu selamanya', async () => {
  // Tanpa batas waktu, jaringan yang menggantung membuat layar menampilkan
  // "memeriksa" selamanya — kasir menunggu jawaban yang tidak akan datang.
  const { periksaJangkauan } = await import(MOD);
  const mulai = Date.now();
  const hasil = await periksaJangkauan({
    baseUrl: BASE,
    daring: () => true,
    batasMs: 30,
    fetchFn: (_url, opts) =>
      new Promise((_selesai, tolak) => {
        opts.signal.addEventListener('abort', () => tolak(new Error('AbortError')));
      }),
  });
  assert.equal(hasil, false);
  assert.ok(Date.now() - mulai < 2000, 'harus menyerah cepat');
});

test('⛔ probe menembak /health milik SERVER KAMI, dan tanpa cache', async () => {
  // Yang harus dijangkau untuk QRIS dinamis adalah server kami — dialah yang
  // memanggil gateway. Probe ke pihak ketiga akan berkata "online" untuk
  // perangkat yang tidak dapat mencapai kami sama sekali.
  //
  // `no-store` sama pentingnya: probe yang dijawab dari cache melaporkan
  // keterjangkauan beberapa menit yang lalu, dan beberapa menit adalah seluruh
  // durasi satu antrean pelanggan.
  const { periksaJangkauan } = await import(MOD);
  let url = null;
  let opsi = null;
  await periksaJangkauan({
    baseUrl: 'http://server.uji/',
    daring: () => true,
    fetchFn: async (u, o) => {
      url = u;
      opsi = o;
      return { ok: true };
    },
  });
  assert.equal(url, 'http://server.uji/health', 'garis miring ganda harus dirapikan');
  assert.equal(opsi.cache, 'no-store');
  assert.equal(opsi.method, 'GET');
});

// --- pemantau ---------------------------------------------------------------

test('pemantau bermula "memeriksa" lalu menetap sesuai hasil probe', async () => {
  const { pantauJangkauan } = await import(MOD);
  const p = pantauJangkauan({
    baseUrl: BASE,
    daring: () => true,
    intervalMs: 10_000,
    fetchFn: async () => ({ ok: true }),
  });
  assert.equal(p.keadaan(), 'memeriksa', 'sebelum jawaban pertama, belum tahu');
  await tunggu();
  assert.equal(p.keadaan(), 'terjangkau');
  p.hentikan();
});

test('⛔ peristiwa `offline` mematikan SEKETIKA, tanpa menunggu probe', async () => {
  // Menunggu probe timeout berarti kasir melihat metode yang aktif selama
  // empat detik setelah Wi-Fi mati — dan empat detik cukup untuk satu ketukan.
  const { pantauJangkauan } = await import(MOD);
  const l = pendengarPalsu();
  const p = pantauJangkauan({
    baseUrl: BASE,
    daring: () => true,
    intervalMs: 10_000,
    fetchFn: async () => ({ ok: true }),
    pasangPendengar: l.pasang,
  });
  await tunggu();
  assert.equal(p.keadaan(), 'terjangkau');

  l.picu('offline');
  assert.equal(p.keadaan(), 'tidak', 'harus seketika, tanpa await');
  p.hentikan();
});

test('⛔ peristiwa `online` TIDAK langsung menyalakan — ia memicu probe', async () => {
  // Antarmuka yang hidup bukan server yang terjangkau. Captive portal
  // memancarkan `online` sebelum penggunanya login.
  const { pantauJangkauan } = await import(MOD);
  const l = pendengarPalsu();
  let jawab = false;
  const p = pantauJangkauan({
    baseUrl: BASE,
    daring: () => true,
    intervalMs: 10_000,
    fetchFn: async () => {
      if (!jawab) throw new Error('uplink mati');
      return { ok: true };
    },
    pasangPendengar: l.pasang,
  });
  await tunggu();
  assert.equal(p.keadaan(), 'tidak');

  // `online` dipancarkan sementara uplink masih mati: keadaannya TIDAK boleh
  // berubah.
  l.picu('online');
  await tunggu();
  assert.equal(p.keadaan(), 'tidak', 'peristiwa online saja tidak membuktikan apa pun');

  jawab = true;
  l.picu('online');
  await tunggu();
  assert.equal(p.keadaan(), 'terjangkau');
  p.hentikan();
});

test('⛔ koneksi pulih tanpa peristiwa apa pun tetap tertangkap probe berkala', async () => {
  // `spec-c:277`: metode aktif kembali TANPA perlu menutup layar. Captive
  // portal yang baru di-login tidak memancarkan `online` sama sekali.
  const { pantauJangkauan } = await import(MOD);
  let jawab = false;
  const p = pantauJangkauan({
    baseUrl: BASE,
    daring: () => true,
    intervalMs: 5,
    fetchFn: async () => {
      if (!jawab) throw new Error('captive portal');
      return { ok: true };
    },
  });
  await tunggu();
  assert.equal(p.keadaan(), 'tidak');

  jawab = true;
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(p.keadaan(), 'terjangkau', 'probe berkala harus menangkapnya');
  p.hentikan();
});

test('pelanggan diberi tahu HANYA saat keadaan BERUBAH', async () => {
  // Pemberitahuan pada setiap probe membuat layar merender ulang tiap 15 detik
  // tanpa satu pun perubahan yang terlihat.
  const { pantauJangkauan } = await import(MOD);
  const terlihat = [];
  const p = pantauJangkauan({
    baseUrl: BASE,
    daring: () => true,
    intervalMs: 5,
    fetchFn: async () => ({ ok: true }),
  });
  p.langgan((k) => terlihat.push(k));
  await new Promise((r) => setTimeout(r, 40));
  p.hentikan();
  assert.deepEqual(terlihat, ['terjangkau'], `terlalu banyak pemberitahuan: ${terlihat}`);
});

test('⛔ hentikan() benar-benar berhenti — tidak ada probe setelahnya', async () => {
  // Pemantau yang terus berjalan setelah layarnya ditutup menembak server
  // selamanya, dari setiap layar yang pernah dibuka.
  const { pantauJangkauan } = await import(MOD);
  let dipanggil = 0;
  const p = pantauJangkauan({
    baseUrl: BASE,
    daring: () => true,
    intervalMs: 5,
    fetchFn: async () => {
      dipanggil += 1;
      return { ok: true };
    },
  });
  await new Promise((r) => setTimeout(r, 30));
  p.hentikan();
  const sesudahHenti = dipanggil;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(dipanggil, sesudahHenti, 'masih menembak setelah dihentikan');
});

test('satu pelanggan yang MELEMPAR tidak menghalangi sisanya', async () => {
  const { pantauJangkauan } = await import(MOD);
  const l = pendengarPalsu();
  const terlihat = [];
  const p = pantauJangkauan({
    baseUrl: BASE,
    daring: () => true,
    intervalMs: 10_000,
    fetchFn: async () => ({ ok: true }),
    pasangPendengar: l.pasang,
  });
  p.langgan(() => {
    throw new Error('pelanggan rusak');
  });
  p.langgan((k) => terlihat.push(k));
  await tunggu();
  l.picu('offline');
  assert.deepEqual(terlihat, ['terjangkau', 'tidak']);
  p.hentikan();
});
