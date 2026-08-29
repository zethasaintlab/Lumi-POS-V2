import type { KonfigPerangkat } from '../../../../packages/sync-client/src/perangkat.ts';
import type { PengirimApi } from '../kasir/qris-dinamis.ts';

/**
 * Pemanggil REST LANGSUNG dari perangkat kasir.
 *
 * ## ⛔ Ia BUKAN pengganti relay outbox, dan tidak boleh menjadi satu
 *
 * Setiap penulisan yang harus bertahan melewati jaringan mati tetap lewat
 * `outbox_local` — itu satu-satunya jalur naik, dan menambah jalur kedua
 * diam-diam adalah persis yang keputusan F2 larang (trigger CRUD PowerSync
 * sengaja tidak dipasang justru karena itu).
 *
 * Yang lewat sini hanya permintaan yang **tidak masuk akal untuk diantrekan**:
 * meminta QR ke gateway dan menanyakan statusnya. Keduanya tidak berguna bila
 * dikirim setengah jam kemudian — pelanggannya sudah pulang — dan keduanya
 * hanya dapat dijalankan saat server terjangkau, yang justru sudah dipastikan
 * lebih dulu (FR-C3).
 *
 * ## ⛔ Header-nya SAMA dengan relay
 *
 * `X-Tenant-Id`, `X-Actor-Id`, `Idempotency-Key`, `Content-Type` — tepat empat,
 * persis yang `buatPengirimHttp` susun. Perangkat kasir tidak punya sesi
 * back-office (`spec-f:183`), jadi tidak ada Bearer; rute yang dipakainya
 * ditandai `sesiOpsional` di server.
 */
export function buatPemanggilApi(konfig: KonfigPerangkat, actorId: string): PengirimApi {
  const dasar = konfig.baseUrl.replace(/\/+$/, '');
  return async (jalur, opsi) => {
    const headers: Record<string, string> = {
      'X-Tenant-Id': konfig.tenantId,
      'X-Actor-Id': actorId,
    };
    // ⛔ `Content-Type: application/json` HANYA saat ada body. Fastify menolak
    // permintaan ber-content-type JSON yang badannya kosong dengan
    // `400 FST_ERR_CTP_EMPTY_JSON_BODY` — pelajaran yang sudah dicatat di
    // klien back-office, dan ia berlaku sama di sini.
    const adaBody = opsi.body !== undefined;
    if (adaBody) headers['Content-Type'] = 'application/json';
    if (opsi.idempotencyKey !== undefined) headers['Idempotency-Key'] = opsi.idempotencyKey;

    const res = await fetch(`${dasar}${jalur}`, {
      method: opsi.metode,
      headers,
      body: adaBody ? JSON.stringify(opsi.body) : undefined,
    });

    // ⛔ Body yang tidak dapat diurai TIDAK melempar. Pemanggilnya memutuskan
    // dari `status`, dan gateway yang menjawab HTML error page tidak boleh
    // membuat kasir melihat lemparan mentah alih-alih pesan yang terbaca.
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  };
}
