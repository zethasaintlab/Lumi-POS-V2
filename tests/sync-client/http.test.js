'use strict';

// Adapter REST di belakang port `kirim`. `fetchFn` di-inject -- pola yang
// sama dengan `PaymentProvider` di apps/server, bukan abstraksi baru.
//
// Yang diuji di sini bukan "HTTP bekerja" melainkan hal-hal yang membuat
// antrean salah kalau keliru: endpoint mana untuk jenis apa, header mana yang
// ikut, dan bagaimana bentuk jawaban diterjemahkan ke HasilKirim.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const HTTP = '../../packages/sync-client/src/http.ts';

function baris(extra = {}) {
  return {
    id: 'obx-1',
    entity_type: 'order',
    entity_id: 'ord-9',
    operation: 'create',
    payload: JSON.stringify({ total: 44400 }),
    idempotency_key: 'key-1',
    status: 'pending',
    attempts: 0,
    last_error: null,
    last_attempt_at: null,
    created_at: '2026-08-08T10:00:00.000Z',
    depends_on: null,
    ...extra,
  };
}

function fetchPalsu(jawab) {
  const panggilan = [];
  const fn = async (url, opsi) => {
    panggilan.push({ url, opsi });
    return jawab(url, opsi);
  };
  return { panggilan, fn };
}

function jawabanJson(status, body) {
  return {
    status,
    async json() {
      return body;
    },
  };
}

const KONFIG = { baseUrl: 'http://server.lokal', tenantId: 'ten-1', actorId: 'usr-1' };

test('memetakan keempat jenis ke endpoint yang benar', async () => {
  const { buatPengirimHttp } = await import(HTTP);
  const f = fetchPalsu(() => jawabanJson(201, {}));
  const kirim = buatPengirimHttp({ ...KONFIG, fetchFn: f.fn });

  await kirim(baris({ entity_type: 'shift', entity_id: 'shf-1' }));
  await kirim(baris({ entity_type: 'order', entity_id: 'ord-9' }));
  await kirim(baris({ entity_type: 'order_cancel', entity_id: 'ord-9' }));
  await kirim(baris({ entity_type: 'payment', entity_id: 'ord-9' }));

  assert.deepEqual(
    f.panggilan.map((p) => p.url),
    [
      'http://server.lokal/shifts',
      'http://server.lokal/orders',
      'http://server.lokal/orders/ord-9/cancel',
      'http://server.lokal/orders/ord-9/payments',
    ]
  );
  assert.ok(f.panggilan.every((p) => p.opsi.method === 'POST'));
});

// `Idempotency-Key` diambil dari BARIS, bukan di-generate di sini. Kalau
// adapter ini yang membuatnya, setiap percobaan mengirim key berbeda dan
// retry menghasilkan penjualan ganda -- persis yang disabotase di T9.
test('mengirim Idempotency-Key dari baris, dan header tenant/aktor', async () => {
  const { buatPengirimHttp } = await import(HTTP);
  const f = fetchPalsu(() => jawabanJson(201, {}));
  const kirim = buatPengirimHttp({ ...KONFIG, fetchFn: f.fn });

  await kirim(baris({ idempotency_key: 'key-abc' }));
  const h = f.panggilan[0].opsi.headers;
  assert.equal(h['Idempotency-Key'], 'key-abc');
  assert.equal(h['X-Tenant-Id'], 'ten-1');
  assert.equal(h['X-Actor-Id'], 'usr-1');
  assert.equal(h['Content-Type'], 'application/json');
});

// `payload` disimpan sebagai TEXT di outbox_local. Ia harus dikirim apa
// adanya, bukan di-parse lalu di-stringify ulang: perjalanan bolak-balik itu
// dapat mengubah urutan kunci, dan server menghitung hash request dari body
// untuk mendeteksi "key sama, body berbeda" (IDEMPOTENCY_KEY_REUSED).
test('mengirim payload apa adanya, tanpa parse-lalu-stringify ulang', async () => {
  const { buatPengirimHttp } = await import(HTTP);
  const f = fetchPalsu(() => jawabanJson(201, {}));
  const kirim = buatPengirimHttp({ ...KONFIG, fetchFn: f.fn });

  const asli = '{"b":2,"a":1}';
  await kirim(baris({ payload: asli }));
  assert.equal(f.panggilan[0].opsi.body, asli);
});

test('menerjemahkan kode error dari body ke HasilKirim', async () => {
  const { buatPengirimHttp } = await import(HTTP);
  const f = fetchPalsu(() =>
    jawabanJson(409, { error: { code: 'ID_ALREADY_EXISTS', message: 'Shift sudah ada.' } })
  );
  const kirim = buatPengirimHttp({ ...KONFIG, fetchFn: f.fn });

  const hasil = await kirim(baris({ entity_type: 'shift' }));
  assert.equal(hasil.status, 409);
  assert.equal(hasil.code, 'ID_ALREADY_EXISTS');
  assert.match(hasil.pesan, /sudah ada/);
});

// Jaringan yang putus melempar, bukan mengembalikan respons. Ia harus menjadi
// `status: null` -- yang oleh klasifikasi dibaca sebagai `coba-lagi`, bukan
// gagal permanen.
test('fetch yang melempar menjadi status null, bukan error yang lolos', async () => {
  const { buatPengirimHttp } = await import(HTTP);
  const kirim = buatPengirimHttp({
    ...KONFIG,
    fetchFn: async () => {
      throw new TypeError('Failed to fetch');
    },
  });

  const hasil = await kirim(baris());
  assert.equal(hasil.status, null);
  assert.match(hasil.pesan, /Failed to fetch/);
});

// Body yang bukan JSON (proxy menyisipkan HTML, server 502 dari load
// balancer) tidak boleh menjatuhkan relay. Statusnya tetap terbaca, dan
// itulah yang menentukan keputusannya.
test('body yang bukan JSON tidak menjatuhkan relay', async () => {
  const { buatPengirimHttp } = await import(HTTP);
  const kirim = buatPengirimHttp({
    ...KONFIG,
    fetchFn: async () => ({
      status: 502,
      async json() {
        throw new SyntaxError('Unexpected token <');
      },
    }),
  });

  const hasil = await kirim(baris());
  assert.equal(hasil.status, 502);
  assert.equal(hasil.code, null);
});

test('menolak entity_type yang tidak punya endpoint', async () => {
  const { buatPengirimHttp } = await import(HTTP);
  const kirim = buatPengirimHttp({ ...KONFIG, fetchFn: async () => jawabanJson(201, {}) });
  await assert.rejects(kirim(baris({ entity_type: 'cash_movement' })), /endpoint/i);
});
