// JWT RS256 dan JWKS untuk token perangkat (FR-F12).
//
// ⛔ Kenapa ini ada di SERVER, dan tidak boleh pindah ke klien: prototipe 04
// dan 05 mencetak JWT **simetris di dalam browser**. Pada jalur turun, sync
// rules adalah satu-satunya batas tenant (role replikasi wajib `BYPASSRLS`),
// jadi kunci simetris di klien berarti perangkat mana pun dapat mencetak
// token untuk tenant mana pun -- dan yang menahannya cuma niat baik.
//
// Ditandatangani `node:crypto`. **Nol dependensi baru**: RS256 adalah
// RSASSA-PKCS1-v1_5 di atas SHA-256, yang sudah ada di runtime.
//
// RS256, bukan EdDSA: dukungan JWKS untuk RSA universal, OKP tidak. Yang
// memverifikasi token ini adalah layanan PowerSync, bukan kode kita, jadi
// interoperabilitas menang atas keanggunan.

import { createHash, createPublicKey, createPrivateKey, sign } from 'node:crypto';

function b64url(data: Buffer | string): string {
  return Buffer.from(data).toString('base64url');
}

function muatKunciPrivat(pem: unknown) {
  if (typeof pem !== 'string' || pem.trim().length === 0) {
    throw new Error(
      'Kunci penandatangan token sinkronisasi belum diatur (POWERSYNC_JWT_PRIVATE_KEY). ' +
        'Tanpa kunci, token TIDAK dicetak — klien tidak pernah menandatangani sendiri.'
    );
  }
  try {
    return createPrivateKey(pem);
  } catch (e) {
    throw new Error(`Kunci penandatangan token sinkronisasi tidak dapat dibaca: ${(e as Error).message}`);
  }
}

/**
 * `kid` diturunkan DARI kunci publiknya, bukan dikonfigurasi terpisah.
 *
 * Dua sumber yang harus dijaga sepakat akan hanyut, dan hanyutnya tidak
 * memunculkan error -- hanya verifier yang tidak menemukan kunci, dan itu
 * terlihat sebagai "token ditolak" tanpa petunjuk apa pun.
 */
function kidDari(kunciPublik: ReturnType<typeof createPublicKey>): string {
  const der = kunciPublik.export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('base64url').slice(0, 16);
}

export interface OpsiTandatangan {
  pemPrivat: unknown;
  klaim: Record<string, unknown>;
  berlakuDetik: number;
  /** Waktu di-INJECT. Tidak ada `Date.now()` di modul ini. */
  sekarangMs: number;
}

export function tandatanganiJwt({ pemPrivat, klaim, berlakuDetik, sekarangMs }: OpsiTandatangan): string {
  const kunciPrivat = muatKunciPrivat(pemPrivat);
  const kid = kidDari(createPublicKey(kunciPrivat));

  const iat = Math.floor(sekarangMs / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
  const payload = b64url(
    JSON.stringify({ ...klaim, iat, exp: iat + berlakuDetik })
  );

  const tandaTangan = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), kunciPrivat);
  return `${header}.${payload}.${b64url(tandaTangan)}`;
}

export interface Jwks {
  keys: Record<string, unknown>[];
}

/**
 * JWKS dari kunci privat yang sama.
 *
 * Ekspor `jwk` dari kunci PUBLIK, bukan dari privatnya — `createPublicKey`
 * membuang seluruh komponen rahasia (`d`, `p`, `q`, …). Meng-ekspor privat
 * lalu menghapus fieldnya satu per satu akan bekerja hari ini dan bocor pada
 * hari seseorang menambah field baru.
 */
export function jwksDari(pemPrivat: unknown): Jwks {
  const kunciPublik = createPublicKey(muatKunciPrivat(pemPrivat));
  const jwk = kunciPublik.export({ format: 'jwk' }) as Record<string, unknown>;
  return {
    keys: [{ ...jwk, alg: 'RS256', use: 'sig', kid: kidDari(kunciPublik) }],
  };
}
