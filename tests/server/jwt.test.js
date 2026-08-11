'use strict';

// F12-1 -- JWT RS256 dan JWKS, tanpa dependensi baru.
//
// PowerSync memverifikasi token klien lewat JWKS (`client_auth.jwks`).
// Prototipe 04/05 mencetak JWT SIMETRIS di dalam browser -- pola prototipe
// yang tidak boleh masuk aplikasi: pada jalur turun, sync rules adalah
// satu-satunya batas tenant, jadi kunci simetris di klien berarti perangkat
// mana pun dapat mencetak token untuk tenant mana pun.
//
// Ditandatangani `node:crypto`. RS256 dipilih karena dukungan JWKS untuk RSA
// universal; OKP (EdDSA) tidak.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const JWT = '../../apps/server/src/modules/identity/jwt.ts';

// Kunci 2048-bit dibuat SEKALI untuk seluruh berkas: keygen RSA lambat, dan
// mengulangnya per test menambah detik tanpa menguji apa pun.
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });

function bagian(token) {
  const [h, p, s] = token.split('.');
  return {
    header: JSON.parse(Buffer.from(h, 'base64url').toString()),
    payload: JSON.parse(Buffer.from(p, 'base64url').toString()),
    signature: s,
  };
}

test('F12-1 token bertanda tangan RS256 dan dapat diverifikasi kunci publiknya', async () => {
  const { tandatanganiJwt } = await import(JWT);
  const token = tandatanganiJwt({
    pemPrivat: PEM,
    klaim: { sub: 'dev-1', aud: 'powersync' },
    berlakuDetik: 300,
    sekarangMs: 1_754_000_000_000,
  });

  const { header, payload } = bagian(token);
  assert.equal(header.alg, 'RS256');
  assert.equal(header.typ, 'JWT');
  assert.ok(header.kid, 'header tanpa kid -- JWKS tidak dapat memilih kunci');
  assert.equal(payload.sub, 'dev-1');

  const [h, p, s] = token.split('.');
  const sah = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${h}.${p}`),
    publicKey,
    Buffer.from(s, 'base64url')
  );
  assert.equal(sah, true, 'tanda tangan tidak dapat diverifikasi kunci publiknya');
});

// Token yang tidak pernah kedaluwarsa adalah token yang dicuri sekali lalu
// dipakai selamanya. `spec-f:247`: "Umur pendek + refresh".
test('F12-1 iat dan exp diisi dari waktu yang DI-INJECT, bukan jam nyata', async () => {
  const { tandatanganiJwt } = await import(JWT);
  const t0 = 1_754_000_000_000;
  const token = tandatanganiJwt({
    pemPrivat: PEM,
    klaim: { sub: 'dev-1' },
    berlakuDetik: 300,
    sekarangMs: t0,
  });
  const { payload } = bagian(token);
  assert.equal(payload.iat, Math.floor(t0 / 1000));
  assert.equal(payload.exp, Math.floor(t0 / 1000) + 300);
});

// Tanda tangan yang tidak berubah saat isinya berubah bukan tanda tangan.
test('F12-1 klaim yang berbeda menghasilkan tanda tangan yang berbeda', async () => {
  const { tandatanganiJwt } = await import(JWT);
  const buat = (sub) =>
    tandatanganiJwt({ pemPrivat: PEM, klaim: { sub }, berlakuDetik: 300, sekarangMs: 1 });
  assert.notEqual(bagian(buat('dev-1')).signature, bagian(buat('dev-2')).signature);
});

test('F12-1 JWKS memuat kunci publik dalam bentuk yang dapat dipakai verifier', async () => {
  const { jwksDari, tandatanganiJwt } = await import(JWT);
  const jwks = jwksDari(PEM);

  assert.equal(jwks.keys.length, 1);
  const jwk = jwks.keys[0];
  assert.equal(jwk.kty, 'RSA');
  assert.equal(jwk.alg, 'RS256');
  assert.equal(jwk.use, 'sig');
  assert.ok(jwk.n && jwk.e, 'JWK RSA wajib punya n dan e');

  // `kid` HARUS cocok dengan header token, kalau tidak verifier tidak dapat
  // memilih kunci yang benar dan gagal tanpa petunjuk apa pun.
  const { header } = bagian(
    tandatanganiJwt({ pemPrivat: PEM, klaim: { sub: 'x' }, berlakuDetik: 60, sekarangMs: 1 })
  );
  assert.equal(jwk.kid, header.kid);

  // Dan ia benar-benar dapat dipakai: kunci publik direkonstruksi DARI JWKS,
  // lalu dipakai memverifikasi token. Tanpa langkah ini, test di atas hanya
  // memeriksa bentuk, bukan kegunaan.
  const dariJwks = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const token = tandatanganiJwt({ pemPrivat: PEM, klaim: { sub: 'y' }, berlakuDetik: 60, sekarangMs: 1 });
  const [h, p, s] = token.split('.');
  assert.equal(
    crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), dariJwks, Buffer.from(s, 'base64url')),
    true
  );
});

// JWKS tidak boleh membocorkan kunci privat. Kalau `d` ikut, siapa pun yang
// mengambil `/.well-known/jwks.json` dapat mencetak token untuk tenant mana
// pun -- persis kegagalan yang FR-F12 ada untuk mencegahnya.
test('F12-1 JWKS TIDAK memuat komponen kunci privat', async () => {
  const { jwksDari } = await import(JWT);
  const jwk = jwksDari(PEM).keys[0];
  for (const rahasia of ['d', 'p', 'q', 'dp', 'dq', 'qi']) {
    assert.equal(jwk[rahasia], undefined, `JWKS membocorkan komponen privat "${rahasia}"`);
  }
});

test('F12-1 kunci kosong ditolak, bukan menghasilkan token tanpa tanda tangan', async () => {
  const { tandatanganiJwt, jwksDari } = await import(JWT);
  for (const kosong of ['', '   ', undefined, null]) {
    assert.throws(
      () => tandatanganiJwt({ pemPrivat: kosong, klaim: {}, berlakuDetik: 60, sekarangMs: 1 }),
      /kunci/i
    );
    assert.throws(() => jwksDari(kosong), /kunci/i);
  }
});

test('F12-1 PEM yang cacat gagal dengan pesan, bukan lolos diam-diam', async () => {
  const { tandatanganiJwt } = await import(JWT);
  assert.throws(
    () => tandatanganiJwt({ pemPrivat: 'bukan pem', klaim: {}, berlakuDetik: 60, sekarangMs: 1 }),
    /kunci|key/i
  );
});
