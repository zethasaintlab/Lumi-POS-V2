'use strict';

const crypto = require('node:crypto');

/**
 * Mencetak sesi back-office SUNGGUHAN untuk test.
 *
 * ⛔ Kenapa BUKAN seam `buildApp({ sesiWajib: false })`
 *
 * Saklar yang mematikan penjaga keamanan adalah saklar yang suatu hari mati
 * di produksi — dan yang menemukannya bukan test, melainkan orang. Pola repo
 * ini untuk hal semacam ini konsisten: adapter pembayaran GAGAL SAAT BOOT
 * bila kuncinya kosong, bukan diam-diam jatuh ke mode tanpa gateway.
 *
 * Jadi test memakai jalur yang sama dengan aplikasi: baris `user_session`
 * yang benar-benar ada, dan token yang benar-benar dihash SHA-256.
 *
 * ⛔ Kenapa BUKAN `POST /auth/login`
 *
 * Login memverifikasi password lewat Argon2id — 23 ms per panggilan, diukur.
 * Dengan ratusan test yang masing-masing butuh sesi, itu menit-menit murni
 * menunggu KDF membuktikan sesuatu yang bukan pokok testnya. Test yang MEMANG
 * menguji login tetap memakai endpointnya (`tests/identity/auth-backoffice`).
 *
 * `client` harus berupa koneksi peran aplikasi; INSERT-nya tunduk RLS seperti
 * penulisan lain mana pun.
 */
async function buatSesi(appClient, { tenantId, userId, kedaluwarsaDalamJam = 12 } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  await appClient.query('BEGIN');
  await appClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
  await appClient.query(
    `INSERT INTO user_session (id, tenant_id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' hours')::interval)`,
    [crypto.randomUUID(), tenantId, userId, tokenHash, String(kedaluwarsaDalamJam)]
  );
  await appClient.query('COMMIT');

  return token;
}

/**
 * Header lengkap untuk permintaan back-office terautentikasi.
 *
 * `x-tenant-id` TETAP dikirim: ia petunjuk pencarian sesi, karena
 * `user_session` tunduk RLS dan pembacaannya menuntut `app.tenant_id`
 * (`apps/server/src/sesi.ts`). Ia BUKAN otoritas — tenant dan aktor yang
 * berlaku datang dari baris sesinya.
 *
 * `x-actor-id` sengaja TIDAK disertakan secara bawaan. Kalau ada test yang
 * lulus hanya karena header itu ada, penjaganya tidak menjaga apa pun.
 */
function headerSesi(tenantId, token, tambahan = {}) {
  return {
    'content-type': 'application/json',
    'x-tenant-id': tenantId,
    authorization: `Bearer ${token}`,
    ...tambahan,
  };
}

module.exports = { buatSesi, headerSesi };
