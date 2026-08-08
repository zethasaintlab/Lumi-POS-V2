// ⛔ POLA PROTOTIPE. JANGAN PERNAH DISALIN KE `apps/`.
//
// Berkas ini mencetak JWT HS256 DI BROWSER, yang berarti rahasianya ada di
// kode klien. Kunci simetris membuat siapa pun yang dapat memverifikasi token
// juga dapat membuatnya — jadi setiap orang yang membuka halaman ini dapat
// mencetak token untuk tenant mana pun.
//
// Itu dapat diterima di sini dan hanya di sini, karena:
//   - seluruh stack hanya mengikat ke localhost;
//   - rahasianya sekali-pakai dan tidak dipakai di tempat lain;
//   - yang sedang diuji adalah JALUR TURUN, bukan otentikasi.
//
// Di F2 sungguhan, token dicetak server Fastify kami dengan kunci ASIMETRIS
// (RS256/EdDSA). Klien menerima token, tidak pernah bahan rahasianya, dan
// `client_auth.jwks_uri` menunjuk endpoint JWKS server itu.

const RAHASIA = 'prototipe-05-localhost-saja-jangan-dipakai-di-produksi';

// Harus sama persis dengan `client_auth.audience` di powersync/service.yaml.
// Tidak cocok -> 401, dan pesannya tidak menyebut audience.
const AUDIENCE = 'powersync-dev';
const KID = 'prototipe-05';

function b64url(bytes) {
  const s = typeof bytes === 'string' ? bytes : String.fromCharCode(...new Uint8Array(bytes));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * @param tenantId dibaca sync rules lewat `auth.parameter('tenant_id')`.
 *   Ia klaim TOP-LEVEL, bukan di dalam objek `parameters` — dan itu bukan
 *   pilihan gaya: `auth.parameters()` mengembalikan seluruh payload JWT,
 *   sehingga `auth.parameter('x')` membaca `payload.x`.
 */
export async function cetakToken(tenantId, { userId = 'usr-prototipe' } = {}) {
  const sekarang = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT', kid: KID };
  const payload = {
    sub: userId,
    aud: AUDIENCE,
    iat: sekarang,
    exp: sekarang + 3600,
    tenant_id: tenantId,
  };

  const bagian = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const kunci = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(RAHASIA),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const tandaTangan = await crypto.subtle.sign('HMAC', kunci, new TextEncoder().encode(bagian));
  return `${bagian}.${b64url(tandaTangan)}`;
}

/**
 * Connector jalur TURUN saja.
 *
 * `uploadData` sengaja tidak melakukan apa-apa, dan itu BUKAN kekurangan
 * prototipe. Prototipe 04 T4 membuktikan `ps_crud` hanya terisi bila kita
 * memasang trigger raw table sendiri; kita tidak memasangnya, jadi tidak
 * pernah ada yang perlu diunggah lewat jalur ini. Jalur naik kami tetap
 * `outbox_local` + REST idempoten.
 */
export function buatConnector(tenantId, endpoint) {
  return {
    async fetchCredentials() {
      return { endpoint, token: await cetakToken(tenantId) };
    },
    async uploadData() {
      // Sengaja kosong — lihat di atas.
    },
  };
}
