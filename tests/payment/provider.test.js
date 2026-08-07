'use strict';

// G1-G2 (docs/superpowers/plans/PLAN-void-refund-gateway.md §5.7) -- port
// PaymentProvider, fake in-memory, dan adapter Midtrans.
//
// ## Kenapa port-nya WAJIB, bukan pilihan gaya
//
// ARCH:197 sudah mendefinisikannya, tapi ada alasan yang lebih memaksa:
// .github/workflows/test.yml mengisi MIDTRANS_SERVER_KEY dan
// MIDTRANS_CLIENT_KEY dengan STRING KOSONG. Test yang memanggil API Midtrans
// sungguhan akan gagal di CI, lambat, dan bergantung pada layanan pihak ketiga
// yang bisa down.
//
// Konsekuensinya mutlak: tidak ada satu pun test di repo ini yang boleh
// menyentuh jaringan. Adapter Midtrans diuji dengan `fetch` yang di-INJECT,
// bukan fetch global.
//
// ## Rahasia
//
// Kunci di file ini adalah karangan ('SB-Mid-server-PALSU...'), bukan kunci
// sungguhan. Dan dua test di bawah ada khusus untuk memastikan kunci --
// karangan maupun sungguhan -- tidak pernah bocor ke pesan error.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const PROVIDER = '../../apps/server/src/modules/payment/providers/index.ts';

// Kunci KARANGAN. Bentuknya menyerupai kunci Midtrans sandbox supaya test
// redaksi di bawah menguji hal yang sama bentuknya dengan yang sungguhan.
const KUNCI_PALSU = 'SB-Mid-server-PALSU0123456789abcdef';

// --- G1: pemilihan provider lewat environment variable ---

// Invariant #5: perbedaan lingkungan HANYA lewat environment variable, tidak
// pernah `if (isProduction)` di kode aplikasi.
test('tanpa PAYMENT_PROVIDER, yang dipakai adalah fake', async () => {
  const { selectPaymentProvider } = await import(PROVIDER);
  assert.equal(selectPaymentProvider({}).name, 'fake');
});

test('PAYMENT_PROVIDER=fake memilih fake', async () => {
  const { selectPaymentProvider } = await import(PROVIDER);
  assert.equal(selectPaymentProvider({ PAYMENT_PROVIDER: 'fake' }).name, 'fake');
});

test('PAYMENT_PROVIDER=midtrans dengan kunci terisi memilih midtrans', async () => {
  const { selectPaymentProvider } = await import(PROVIDER);
  const p = selectPaymentProvider({ PAYMENT_PROVIDER: 'midtrans', MIDTRANS_SERVER_KEY: KUNCI_PALSU });
  assert.equal(p.name, 'midtrans');
});

// Gagal saat BOOT, bukan saat pelanggan pertama membayar. CI mengisi kunci
// dengan string kosong, jadi keadaan ini bukan hipotetis -- dan kegagalan di
// tengah pembayaran adalah bentuk kegagalan yang jauh lebih mahal.
test('PAYMENT_PROVIDER=midtrans tanpa kunci gagal saat boot, bukan saat membayar', async () => {
  const { selectPaymentProvider } = await import(PROVIDER);
  for (const env of [
    { PAYMENT_PROVIDER: 'midtrans' },
    { PAYMENT_PROVIDER: 'midtrans', MIDTRANS_SERVER_KEY: '' },
    { PAYMENT_PROVIDER: 'midtrans', MIDTRANS_SERVER_KEY: '   ' },
  ]) {
    assert.throws(() => selectPaymentProvider(env), /MIDTRANS_SERVER_KEY/);
  }
});

// Default tertutup, pola yang sama dengan isTransitionAllowed: nilai yang
// tidak dikenal ditolak, bukan diam-diam jatuh ke salah satu provider.
test('PAYMENT_PROVIDER tak dikenal ditolak, bukan ditebak', async () => {
  const { selectPaymentProvider } = await import(PROVIDER);
  for (const nilai of ['Midtrans', 'xendit', 'FAKE', 'real']) {
    assert.throws(() => selectPaymentProvider({ PAYMENT_PROVIDER: nilai }), /PAYMENT_PROVIDER/);
  }
});

// --- G1: fake ---

function permintaan(over = {}) {
  return {
    orderId: 'order-1',
    paymentId: 'payment-1',
    amount: 20000n,
    idempotencyKey: 'key-1',
    ...over,
  };
}

test('fake.initiate mengembalikan referensi, qrString, dan kedaluwarsa', async () => {
  const { createFakeProvider } = await import(PROVIDER);
  const p = createFakeProvider();
  const hasil = await p.initiate(permintaan());
  assert.equal(typeof hasil.providerReference, 'string');
  assert.ok(hasil.providerReference.length > 0);
  assert.ok(hasil.qrString.length > 0);
  assert.ok(hasil.expiresAt instanceof Date);
});

// INI yang membuat G6 dapat dibuktikan: tanpa penghitung, "retry tidak
// membuat transaksi gateway baru" hanya bisa diperiksa lewat efeknya di
// database, dan efek itu bisa saja sama walau gateway dipanggil dua kali.
test('fake menghitung panggilan initiate', async () => {
  const { createFakeProvider } = await import(PROVIDER);
  const p = createFakeProvider();
  assert.equal(p.initiateCalls(), 0);
  await p.initiate(permintaan({ idempotencyKey: 'a' }));
  await p.initiate(permintaan({ idempotencyKey: 'b' }));
  assert.equal(p.initiateCalls(), 2);
});

// Gateway sungguhan berperilaku begini: idempotency key yang sama
// mengembalikan transaksi yang SAMA, tidak membuat yang baru. Fake yang tidak
// menirunya akan membuat test idempotency hijau karena alasan yang salah.
test('fake: idempotency key sama mengembalikan referensi yang sama, tanpa transaksi baru', async () => {
  const { createFakeProvider } = await import(PROVIDER);
  const p = createFakeProvider();
  const a = await p.initiate(permintaan({ idempotencyKey: 'sama' }));
  const b = await p.initiate(permintaan({ idempotencyKey: 'sama' }));
  assert.equal(b.providerReference, a.providerReference);
  assert.equal(p.gatewayTransactions(), 1, 'hanya satu transaksi gateway');
});

test('fake.pollStatus menjawab pending sampai diprogram sebaliknya', async () => {
  const { createFakeProvider } = await import(PROVIDER);
  const p = createFakeProvider();
  const { providerReference } = await p.initiate(permintaan());
  assert.equal(await p.pollStatus(providerReference), 'pending');
  p.setStatus(providerReference, 'confirmed');
  assert.equal(await p.pollStatus(providerReference), 'confirmed');
});

// Kegagalan gateway harus bisa disimulasikan: FR-C14 seluruhnya tentang apa
// yang terjadi ketika gateway TIDAK menjawab.
test('fake dapat diprogram gagal saat initiate', async () => {
  const { createFakeProvider } = await import(PROVIDER);
  const p = createFakeProvider();
  p.failNextInitiate(new Error('timeout'));
  await assert.rejects(() => p.initiate(permintaan()), /timeout/);
});

// --- G2: adapter Midtrans, fetch di-inject ---

function fetchPalsu(tanggapan) {
  const panggilan = [];
  const fn = async (url, init) => {
    panggilan.push({ url, init });
    return tanggapan;
  };
  fn.panggilan = panggilan;
  return fn;
}

function respons(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

test('midtrans.initiate memanggil endpoint sandbox saat MIDTRANS_ENV=sandbox', async () => {
  const { createMidtransProvider } = await import(PROVIDER);
  const fetchFn = fetchPalsu(respons(201, {
    transaction_id: 'trx-1',
    actions: [{ name: 'generate-qr-code', url: 'https://api.sandbox.midtrans.com/v2/qris/trx-1/qr-code' }],
    expiry_time: '2026-08-07 15:00:00 +0700',
  }));
  const p = createMidtransProvider({ serverKey: KUNCI_PALSU, environment: 'sandbox', fetchFn });

  const hasil = await p.initiate(permintaan());
  assert.equal(fetchFn.panggilan.length, 1);
  assert.ok(fetchFn.panggilan[0].url.includes('sandbox'), fetchFn.panggilan[0].url);
  assert.equal(hasil.providerReference, 'trx-1');
});

test('midtrans.initiate memanggil endpoint produksi saat MIDTRANS_ENV=production', async () => {
  const { createMidtransProvider } = await import(PROVIDER);
  const fetchFn = fetchPalsu(respons(201, { transaction_id: 'trx-2', actions: [], expiry_time: null }));
  const p = createMidtransProvider({ serverKey: KUNCI_PALSU, environment: 'production', fetchFn });
  await p.initiate(permintaan());
  assert.ok(!fetchFn.panggilan[0].url.includes('sandbox'), fetchFn.panggilan[0].url);
});

// AC FR-C14 pertama: retry memakai idempotency key yang SAMA, tidak membuat
// transaksi gateway baru. Midtrans membacanya dari header X-Idempotency-Key.
test('midtrans meneruskan idempotency key ke gateway', async () => {
  const { createMidtransProvider } = await import(PROVIDER);
  const fetchFn = fetchPalsu(respons(201, { transaction_id: 't', actions: [], expiry_time: null }));
  const p = createMidtransProvider({ serverKey: KUNCI_PALSU, environment: 'sandbox', fetchFn });
  await p.initiate(permintaan({ idempotencyKey: 'kunci-retry' }));
  const headers = fetchFn.panggilan[0].init.headers;
  assert.equal(headers['X-Idempotency-Key'], 'kunci-retry');
});

// --- G11: kunci tidak pernah bocor ---

// Kunci dipakai di header Authorization -- itu memang tempatnya. Yang dilarang
// adalah ia muncul di PESAN ERROR, yang berakhir di log, di respons API, dan
// di laporan bug yang ditempelkan orang ke mana-mana.
test('kunci server TIDAK muncul di pesan error saat gateway menolak', async () => {
  const { createMidtransProvider } = await import(PROVIDER);
  const fetchFn = fetchPalsu(respons(401, { status_message: 'unauthorized' }));
  const p = createMidtransProvider({ serverKey: KUNCI_PALSU, environment: 'sandbox', fetchFn });

  await assert.rejects(
    () => p.initiate(permintaan()),
    (err) => {
      assert.ok(!err.message.includes(KUNCI_PALSU), `kunci bocor di pesan: ${err.message}`);
      assert.ok(!JSON.stringify(err).includes(KUNCI_PALSU), 'kunci bocor di properti error');
      return true;
    }
  );
});

test('kunci server TIDAK muncul di pesan error saat gateway tidak dapat dihubungi', async () => {
  const { createMidtransProvider } = await import(PROVIDER);
  const fetchFn = async () => { throw new Error('ECONNREFUSED'); };
  const p = createMidtransProvider({ serverKey: KUNCI_PALSU, environment: 'sandbox', fetchFn });

  await assert.rejects(
    () => p.initiate(permintaan()),
    (err) => {
      assert.ok(!err.message.includes(KUNCI_PALSU), `kunci bocor: ${err.message}`);
      return true;
    }
  );
});

test('midtrans.pollStatus memetakan status gateway ke empat keadaan domain', async () => {
  const { createMidtransProvider } = await import(PROVIDER);
  const kasus = [
    ['settlement', 'confirmed'],
    ['capture', 'confirmed'],
    ['pending', 'pending'],
    ['deny', 'failed'],
    ['cancel', 'failed'],
    ['expire', 'expired'],
  ];
  for (const [gateway, harapan] of kasus) {
    const fetchFn = fetchPalsu(respons(200, { transaction_status: gateway }));
    const p = createMidtransProvider({ serverKey: KUNCI_PALSU, environment: 'sandbox', fetchFn });
    assert.equal(await p.pollStatus('trx'), harapan, `status gateway ${gateway}`);
  }
});

// Status gateway yang tidak dikenal TIDAK boleh dipetakan ke `confirmed`.
// spec-c:320: sistem tidak pernah menandai lunas tanpa konfirmasi. Menebak di
// sini berarti menandai lunas berdasarkan kata yang tidak dimengerti.
test('status gateway tak dikenal tidak pernah jadi confirmed', async () => {
  const { createMidtransProvider } = await import(PROVIDER);
  for (const gateway of ['authorize', 'refund', 'sesuatu_yang_baru', '']) {
    const fetchFn = fetchPalsu(respons(200, { transaction_status: gateway }));
    const p = createMidtransProvider({ serverKey: KUNCI_PALSU, environment: 'sandbox', fetchFn });
    const hasil = await p.pollStatus('trx');
    assert.notEqual(hasil, 'confirmed', `status ${gateway} tidak boleh jadi confirmed`);
  }
});
