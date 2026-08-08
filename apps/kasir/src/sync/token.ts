// Sumber token PowerSync.
//
// ⛔ Keputusan user 8 Agustus 2026 (PLAN-pondasi-kasir §3.5): "Pindah ke
// endpoint server (Modul F). Jangan generate di klien."
//
// Prototipe 04 dan 05 MENCETAK JWT di dalam browser dengan kunci simetris.
// Itu pola prototipe dan tidak boleh masuk aplikasi: pada jalur turun, sync
// rules adalah SATU-SATUNYA batas tenant (role replikasi wajib `BYPASSRLS`,
// jadi invariant #8 tidak menjaga apa pun di sana). Kunci simetris di klien
// berarti perangkat mana pun dapat mencetak token untuk tenant mana pun --
// dan yang menahannya cuma niat baik.
//
// Berkas ini karena itu tidak berisi satu pun operasi kriptografi. Ia hanya
// meminta token ke server kami. Endpoint-nya BELUM ADA; ia lahir bersama
// Modul F, dan sampai itu terjadi `buatSumberTokenServer` gagal dengan pesan
// yang menyebutkan hal itu alih-alih diam.

export interface Kredensial {
  /** URL layanan PowerSync. */
  endpoint: string;
  /** JWT yang DICETAK SERVER, ditandatangani kunci asimetris. */
  token: string;
}

export interface SumberToken {
  ambil(): Promise<Kredensial>;
}

export interface KonfigSumberToken {
  /** Base URL server Lumi, bukan URL PowerSync. */
  baseUrl: string;
  deviceId: string;
  fetchFn?: typeof fetch;
}

/**
 * Meminta kredensial ke server Lumi.
 *
 * Bentuk responsnya sengaja ditetapkan di sini lebih dulu supaya endpoint
 * Modul F punya kontrak yang harus dipenuhi, bukan sebaliknya:
 *
 *   POST /devices/{deviceId}/sync-token  ->  { endpoint, token }
 */
export function buatSumberTokenServer({
  baseUrl,
  deviceId,
  fetchFn = fetch,
}: KonfigSumberToken): SumberToken {
  return {
    async ambil() {
      const res = await fetchFn(`${baseUrl}/devices/${encodeURIComponent(deviceId)}/sync-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.status === 404) {
        throw new Error(
          'Endpoint token sinkronisasi belum ada di server. Ia lahir bersama Modul F (identity); ' +
            'sampai itu terjadi, jalur turun tidak dapat tersambung. Token TIDAK PERNAH dicetak di klien.'
        );
      }
      if (res.status !== 200) {
        throw new Error(`Gagal mengambil token sinkronisasi (HTTP ${res.status}).`);
      }
      const body = (await res.json()) as Partial<Kredensial>;
      if (!body.token || !body.endpoint) {
        throw new Error('Respons token sinkronisasi tidak memuat `endpoint` dan `token`.');
      }
      return { endpoint: body.endpoint, token: body.token };
    },
  };
}
