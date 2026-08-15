'use strict';

// B-00 — sesi back-office dan pintu keluar HTTP-nya.
//
// Keduanya ditulis dengan penyimpanan, jam, dan `fetch` DI-INJECT, jadi
// seluruhnya dapat diuji tanpa browser. Itu prasyarat yang sama yang dituntut
// lapisan sync (`CLAUDE.md`: "waktu, keacakan, dan I/O di-inject").

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const AKAR = join(__dirname, '..', '..');
const SIMPANAN = '../../apps/backoffice/src/sesi-simpanan.ts';
const HTTP = '../../apps/backoffice/src/http.ts';

const SESI_SAH = {
  token: 'token-abc',
  expiresAt: '2026-08-15T23:00:00.000Z',
  userId: 'user-1',
  roles: ['owner'],
  tenantId: 'tenant-1',
};

const SEBELUM = new Date('2026-08-15T12:00:00.000Z').getTime();
const SESUDAH = new Date('2026-08-16T12:00:00.000Z').getTime();

async function simpananMemori() {
  const { penyimpananMemori } = await import(SIMPANAN);
  return penyimpananMemori();
}

// --- penyimpanan sesi ------------------------------------------------------

test('sesi yang disimpan dapat dibaca kembali', async () => {
  const { simpanSesi, bacaSesi } = await import(SIMPANAN);
  const penyimpanan = await simpananMemori();

  simpanSesi(SESI_SAH, { penyimpanan });
  assert.deepEqual(bacaSesi({ penyimpanan, sekarang: () => SEBELUM }), SESI_SAH);
});

test('⛔ sesi yang SUDAH KEDALUWARSA dibuang, bukan dikembalikan', async () => {
  // Mengembalikannya berarti aplikasi menampilkan shell lalu setiap
  // permintaan gagal 401 — dan layar penuh error terbaca seperti kerusakan,
  // bukan seperti "silakan masuk lagi".
  const { simpanSesi, bacaSesi, KUNCI_SESI } = await import(SIMPANAN);
  const penyimpanan = await simpananMemori();

  simpanSesi(SESI_SAH, { penyimpanan });
  assert.equal(bacaSesi({ penyimpanan, sekarang: () => SESUDAH }), null);
  assert.equal(penyimpanan.getItem(KUNCI_SESI), null, 'baris kedaluwarsa tidak ikut dihapus');
});

test('⛔ `expiresAt` yang RUSAK dianggap kedaluwarsa, bukan berlaku selamanya', async () => {
  // `new Date('bukan tanggal').getTime()` = NaN, dan setiap perbandingan
  // dengan NaN bernilai false — jadi `waktu > sekarang` diam-diam menjawab
  // "belum kedaluwarsa" untuk nilai yang rusak. Sesi abadi dari satu karakter
  // yang tersunting.
  const { sudahKedaluwarsa } = await import(SIMPANAN);
  assert.equal(sudahKedaluwarsa({ ...SESI_SAH, expiresAt: 'bukan tanggal' }, SEBELUM), true);
  assert.equal(sudahKedaluwarsa({ ...SESI_SAH, expiresAt: '' }, SEBELUM), true);
});

test('⛔ JSON rusak MENGEMBALIKAN null, tidak melempar', async () => {
  // Melempar di sini membuat aplikasi gagal saat boot karena satu baris
  // penyimpanan yang tersunting, dan penggunanya tidak punya cara
  // membersihkannya selain devtools.
  const { bacaSesi, KUNCI_SESI } = await import(SIMPANAN);
  const penyimpanan = await simpananMemori();

  penyimpanan.setItem(KUNCI_SESI, '{bukan json');
  assert.equal(bacaSesi({ penyimpanan, sekarang: () => SEBELUM }), null);
  assert.equal(penyimpanan.getItem(KUNCI_SESI), null);
});

test('⛔ sesi yang bentuknya tidak lengkap ditolak', async () => {
  const { bacaSesi, KUNCI_SESI } = await import(SIMPANAN);

  for (const kurang of ['token', 'userId', 'tenantId', 'expiresAt', 'roles']) {
    const penyimpanan = await simpananMemori();
    const rusak = { ...SESI_SAH };
    delete rusak[kurang];
    penyimpanan.setItem(KUNCI_SESI, JSON.stringify(rusak));
    assert.equal(
      bacaSesi({ penyimpanan, sekarang: () => SEBELUM }),
      null,
      `sesi tanpa "${kurang}" diterima`
    );
  }
});

test('⛔ `tenantId` IKUT disimpan meski login tidak mengembalikannya', async () => {
  // `POST /auth/login` MENUNTUT X-Tenant-Id, jadi tenant sudah diketahui
  // sebelum login. Tanpa menyimpannya, setiap permintaan sesudah login tidak
  // punya tenant untuk dikirim dan seluruh API menolak dengan 400.
  const { bacaSesi, KUNCI_SESI } = await import(SIMPANAN);
  const penyimpanan = await simpananMemori();
  const tanpaTenant = { ...SESI_SAH };
  delete tanpaTenant.tenantId;

  penyimpanan.setItem(KUNCI_SESI, JSON.stringify(tanpaTenant));
  assert.equal(bacaSesi({ penyimpanan, sekarang: () => SEBELUM }), null);
});

test('hapusSesi membersihkan penyimpanan', async () => {
  const { simpanSesi, hapusSesi, bacaSesi } = await import(SIMPANAN);
  const penyimpanan = await simpananMemori();

  simpanSesi(SESI_SAH, { penyimpanan });
  hapusSesi({ penyimpanan });
  assert.equal(bacaSesi({ penyimpanan, sekarang: () => SEBELUM }), null);
});

// --- pintu keluar HTTP -----------------------------------------------------

function fetchPalsu(jawaban) {
  const dicatat = [];
  const fn = async (url, opsi) => {
    dicatat.push({ url, opsi });
    const j = typeof jawaban === 'function' ? jawaban(dicatat.length) : jawaban;
    return {
      status: j.status,
      ok: j.status >= 200 && j.status < 300,
      text: async () => (j.body === undefined ? '' : JSON.stringify(j.body)),
    };
  };
  fn.dicatat = dicatat;
  return fn;
}

test('⛔ ketiga header sesi disuntikkan otomatis', async () => {
  const { buatKlien } = await import(HTTP);
  const fetch = fetchPalsu({ status: 200, body: { ok: true } });
  const klien = buatKlien({
    baseUrl: 'http://server',
    fetch,
    sesi: () => SESI_SAH,
  });

  await klien.minta('/tenants/usage');

  const h = fetch.dicatat[0].opsi.headers;
  assert.equal(h['x-tenant-id'], 'tenant-1');
  assert.equal(h['x-actor-id'], 'user-1');
  assert.equal(h.authorization, 'Bearer token-abc');
  assert.equal(fetch.dicatat[0].url, 'http://server/tenants/usage');
});

test('⛔ pemanggil TIDAK dapat menimpa header sesi', async () => {
  // Layar yang mengirim `x-actor-id` sendiri akan bertindak atas nama orang
  // lain, dan audit trail akan mencatatkannya sebagai orang itu.
  const { buatKlien } = await import(HTTP);
  const fetch = fetchPalsu({ status: 200, body: {} });
  const klien = buatKlien({ baseUrl: 'http://server', fetch, sesi: () => SESI_SAH });

  await klien.minta('/items', {
    metode: 'POST',
    body: {},
    header: { 'x-actor-id': 'orang-lain', 'x-tenant-id': 'tenant-lain' },
  });

  const h = fetch.dicatat[0].opsi.headers;
  assert.equal(h['x-actor-id'], 'user-1');
  assert.equal(h['x-tenant-id'], 'tenant-1');
});

test('header tambahan yang BUKAN header sesi tetap diteruskan', async () => {
  const { buatKlien } = await import(HTTP);
  const fetch = fetchPalsu({ status: 200, body: {} });
  const klien = buatKlien({ baseUrl: 'http://server', fetch, sesi: () => SESI_SAH });

  await klien.minta('/orders', { metode: 'POST', body: {}, header: { 'idempotency-key': 'k1' } });
  assert.equal(fetch.dicatat[0].opsi.headers['idempotency-key'], 'k1');
});

test('⛔ sesi dibaca TIAP permintaan, bukan ditangkap saat klien dibuat', async () => {
  // Klien dibuat sekali seumur aplikasi; sesi berganti saat login. Menangkap
  // nilainya di closure membuat permintaan pertama sesudah login memakai
  // `null` yang lama — dan gejalanya adalah 400 "Header X-Tenant-Id wajib
  // diisi" tepat setelah login BERHASIL.
  const { buatKlien } = await import(HTTP);
  const fetch = fetchPalsu({ status: 200, body: {} });
  let sesi = null;
  const klien = buatKlien({ baseUrl: 'http://server', fetch, sesi: () => sesi });

  await klien.minta('/health');
  assert.equal(fetch.dicatat[0].opsi.headers['x-tenant-id'], undefined);

  sesi = SESI_SAH;
  await klien.minta('/health');
  assert.equal(fetch.dicatat[1].opsi.headers['x-tenant-id'], 'tenant-1');
});

test('⛔ 401 memanggil onSesiHabis', async () => {
  const { buatKlien, GalatHttp } = await import(HTTP);
  const fetch = fetchPalsu({ status: 401, body: { error: { code: 'SESSION_INVALID', message: 'x' } } });
  let dipanggil = 0;
  const klien = buatKlien({
    baseUrl: 'http://server',
    fetch,
    sesi: () => SESI_SAH,
    onSesiHabis: () => { dipanggil += 1; },
  });

  await assert.rejects(() => klien.minta('/tenants/usage'), GalatHttp);
  assert.equal(dipanggil, 1);
});

test('⛔ pesan error SERVER diteruskan apa adanya — ia membawa angkanya', async () => {
  // Pesan kuota menyebut terpakai/batas (`spec-e:152`, pola yang sama).
  // Menggantinya dengan "Terjadi kesalahan" membuang satu-satunya informasi
  // yang dapat dipakai pengguna.
  const { buatKlien } = await import(HTTP);
  const pesan = 'Paket saat ini memuat 200 produk. Sudah terpakai 150, dan operasi ini menambah 100.';
  const fetch = fetchPalsu({ status: 403, body: { error: { code: 'QUOTA_EXCEEDED', message: pesan } } });
  const klien = buatKlien({ baseUrl: 'http://server', fetch, sesi: () => SESI_SAH });

  await assert.rejects(
    () => klien.minta('/catalog/import', { metode: 'POST', body: {} }),
    (err) => {
      assert.equal(err.status, 403);
      assert.equal(err.kode, 'QUOTA_EXCEEDED');
      assert.equal(err.message, pesan);
      return true;
    }
  );
});

test('⛔ POST TANPA body tidak mengirim content-type — Fastify menolak 400 kalau dikirim', async () => {
  // Ditemukan dengan menjalankannya terhadap server sungguhan, BUKAN lewat
  // test ini: `POST /auth/logout` menjawab
  // `400 FST_ERR_CTP_EMPTY_JSON_BODY` karena wrapper mengirim
  // `content-type: application/json` dengan body kosong.
  //
  // Fake `fetch` di berkas ini menjawab 204 dengan patuh — ia tidak
  // menegakkan satu pun aturan Fastify. Kelas yang sama dengan "fake
  // `DbLokal` tidak menegakkan constraint apa pun" (`CLAUDE.md`): hijau di
  // test, gagal keras di jalur sungguhan.
  //
  // Mengenai SETIAP POST tanpa body, bukan hanya logout —
  // `/items/{id}/archive`, `/items/{id}/restore`, `/devices/{id}/revoke`.
  const { buatKlien } = await import(HTTP);
  const fetch = fetchPalsu({ status: 204 });
  const klien = buatKlien({ baseUrl: 'http://server', fetch, sesi: () => SESI_SAH });

  await klien.minta('/devices/d1/revoke', { metode: 'POST' });

  const { opsi } = fetch.dicatat[0];
  assert.equal(opsi.headers['content-type'], undefined, 'content-type dikirim tanpa body');
  assert.equal(opsi.body, undefined);
  // Header sesi TETAP dikirim — yang hilang hanya content-type.
  assert.equal(opsi.headers['x-actor-id'], 'user-1');
  assert.equal(opsi.headers.authorization, 'Bearer token-abc');
});

test('POST DENGAN body tetap mengirim content-type', async () => {
  const { buatKlien } = await import(HTTP);
  const fetch = fetchPalsu({ status: 200, body: {} });
  const klien = buatKlien({ baseUrl: 'http://server', fetch, sesi: () => SESI_SAH });

  await klien.minta('/items', { metode: 'POST', body: { id: 'i1' } });
  assert.equal(fetch.dicatat[0].opsi.headers['content-type'], 'application/json');
  assert.equal(fetch.dicatat[0].opsi.body, '{"id":"i1"}');
});

test('204 tidak dicoba diurai sebagai JSON', async () => {
  const { buatKlien } = await import(HTTP);
  const fetch = fetchPalsu({ status: 204 });
  const klien = buatKlien({ baseUrl: 'http://server', fetch, sesi: () => SESI_SAH });
  assert.equal(await klien.minta('/auth/logout', { metode: 'POST' }), undefined);
});

test('⛔ login mengirim X-Tenant-Id tapi TIDAK mengirim X-Actor-Id', async () => {
  // Belum ada aktor — itulah yang sedang diminta. Mengirimnya berarti
  // mengarang identitas sebelum ada yang membuktikannya.
  const { masuk } = await import(HTTP);
  const fetch = fetchPalsu({
    status: 200,
    body: { token: 't', expiresAt: '2026-08-15T23:00:00Z', userId: 'u', roles: ['owner'] },
  });

  await masuk(
    { baseUrl: 'http://server', fetch },
    { tenantId: 'tenant-1', email: 'a@b.id', password: 'rahasia sekali' }
  );

  const { url, opsi } = fetch.dicatat[0];
  assert.equal(url, 'http://server/auth/login');
  assert.equal(opsi.headers['x-tenant-id'], 'tenant-1');
  assert.equal(opsi.headers['x-actor-id'], undefined);
  assert.equal(opsi.headers.authorization, undefined);
  assert.deepEqual(JSON.parse(opsi.body), { email: 'a@b.id', password: 'rahasia sekali' });
});

test('⛔ login gagal meneruskan pesan SERAGAM server, tidak memperkayanya', async () => {
  // `spec-f:148`: pesan kegagalan tidak membocorkan keberadaan pengguna.
  // Membedakan "email tidak ada" dari "password salah" di klien membangun
  // kembali oracle enumerasi yang server berusaha tutup.
  const { masuk, GalatHttp } = await import(HTTP);
  const fetch = fetchPalsu({
    status: 401,
    body: { error: { code: 'INVALID_CREDENTIALS', message: 'Email atau password salah.' } },
  });

  await assert.rejects(
    () => masuk({ baseUrl: 'http://server', fetch }, { tenantId: 't', email: 'a@b.id', password: 'x' }),
    (err) => {
      assert.ok(err instanceof GalatHttp);
      assert.equal(err.message, 'Email atau password salah.');
      return true;
    }
  );
});

// --- ⛔ kenyataan yang disematkan -------------------------------------------

test('⛔ SERVER BELUM memverifikasi token sesi di endpoint mana pun selain logout', async () => {
  // Test ini tidak menguji perilaku yang diinginkan — ia MENYEMATKAN
  // kenyataan hari ini supaya tidak salah dibaca.
  //
  // `user_session` ditulis `login` dan dihapus `logout`. Tidak ada kode lain
  // yang membacanya, jadi `Authorization: Bearer` diabaikan oleh setiap
  // endpoint selain `POST /auth/logout`. Kredensial yang SUNGGUHAN adalah
  // `X-Actor-Id` — header biasa berisi id pengguna.
  //
  // Konsekuensinya: penjaga rute di `App.tsx` adalah penjaga UX, BUKAN batas
  // keamanan. Siapa pun yang tahu sepasang tenant_id + user_id dapat
  // memanggil API tanpa pernah login.
  //
  // Saat middleware sesi dibangun di server, test ini akan GAGAL — dan
  // kegagalannya adalah kabar baik. Perbarui bersama perubahan itu.
  const berkas = ['auth.ts', 'users.ts', 'devices.ts', 'tokens.ts'];
  const penyebut = [];
  for (const nama of berkas) {
    const isi = readFileSync(
      join(AKAR, 'apps', 'server', 'src', 'modules', 'identity', 'handlers', nama),
      'utf8'
    );
    if (/user_session/.test(isi)) penyebut.push(nama);
  }

  assert.deepEqual(
    penyebut,
    ['auth.ts'],
    'ada berkas lain yang menyentuh user_session — verifikasi sesi mungkin sudah dibangun; ' +
      'kalau ya, perbarui komentar batas keamanan di sesi-simpanan.ts, http.ts, dan App.tsx'
  );

  const auth = readFileSync(
    join(AKAR, 'apps', 'server', 'src', 'modules', 'identity', 'handlers', 'auth.ts'),
    'utf8'
  );
  const pembacaan = auth.match(/SELECT[^;]*FROM user_session/gi) ?? [];
  assert.deepEqual(
    pembacaan,
    [],
    'user_session mulai dibaca untuk otorisasi — perbarui pernyataan batas keamanan di klien'
  );
});
