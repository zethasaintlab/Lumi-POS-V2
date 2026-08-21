import type { BarisOutbox, HasilKirim } from './ports.ts';

/**
 * Peta jenis entitas -> endpoint. Diturunkan dari `packages/contracts/
 * openapi.yaml`, dan sengaja hanya memuat empat jenis yang BENAR-BENAR punya
 * endpoint (lihat `ENTITY_TYPES` di enqueue.ts).
 */
const RUTE: Record<string, (entityId: string) => string> = {
  shift: () => '/shifts',
  order: () => '/orders',
  order_cancel: (id) => `/orders/${encodeURIComponent(id)}/cancel`,
  payment: (id) => `/orders/${encodeURIComponent(id)}/payments`,
  // FR-E5. `entity_id`-nya adalah id BARIS penandaan, bukan variation:
  // satu produk ditandai berkali-kali, dan `statusRecordBanyak` memetakan
  // status per entitas — memakai variation membuat penandaan kemarin yang
  // gagal terkirim menampilkan status merah pada penandaan hari ini.
  sold_out: () => '/inventory/sold-out',
  // FR-D7. `entity_id`-nya adalah id SHIFT — rutenya bersarang di bawahnya,
  // dan ambang frekuensinya dihitung per shift.
  no_sale: (id) => `/shifts/${encodeURIComponent(id)}/no-sale`,
};

/**
 * Jenis yang PUNYA rute. Diekspor untuk satu tujuan: penjaga yang menuntutnya
 * sama persis dengan `ENTITY_TYPES` di `enqueue.ts`.
 *
 * ⛔ Dua daftar yang menyimpang adalah cacat yang muncul JAUH dari tempat
 * kesalahannya. Jenis yang masuk antrean tanpa rute melempar saat relay
 * mengirimnya — berjam-jam setelah penjualan ditulis, di perangkat merchant.
 */
export const RUTE_DIDUKUNG: readonly string[] = Object.keys(RUTE);

export interface KonfigHttp {
  baseUrl: string;
  tenantId: string;
  /**
   * Aktor CADANGAN, dipakai hanya bila barisnya tidak membawa `actor_id`
   * sendiri. Baris yang membawa aktornya selalu menang -- lihat komentar di
   * `enqueue`.
   */
  actorId: string;
  /**
   * `fetch` DI-INJECT, tidak pernah dipanggil langsung. Pola yang sama dengan
   * `PaymentProvider` di apps/server: jaringan adalah dependensi, bukan
   * kemampuan bawaan modul.
   */
  fetchFn: typeof fetch;
}

/**
 * Membuat pengirim yang memenuhi port `kirim` di `RelayDeps`.
 *
 * Ia TIDAK pernah melempar untuk kegagalan jaringan -- setiap kegagalan
 * diterjemahkan menjadi `HasilKirim`, dan `klasifikasi` yang memutuskan
 * artinya. Melempar akan membuat satu item yang gagal menjatuhkan seluruh
 * putaran batch.
 *
 * Satu-satunya lemparan yang tersisa adalah `entity_type` tak dikenal, dan
 * itu memang harus keras: item seperti itu tidak akan pernah bisa dikirim,
 * dan mendiamkannya berarti penjualan yang hilang tanpa jejak.
 */
export function buatPengirimHttp(konfig: KonfigHttp): (baris: BarisOutbox) => Promise<HasilKirim> {
  const { baseUrl, tenantId, actorId, fetchFn } = konfig;

  return async function kirim(baris: BarisOutbox): Promise<HasilKirim> {
    const rute = RUTE[baris.entity_type];
    if (!rute) {
      throw new Error(
        `entity_type '${baris.entity_type}' tidak punya endpoint. Yang didukung: ${Object.keys(RUTE).join(', ')}.`
      );
    }

    let respons: Response;
    try {
      respons = await fetchFn(`${baseUrl}${rute(baris.entity_id)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-Id': tenantId,
          // Aktor BARIS menang atas aktor konfigurasi. Lihat `enqueue`.
          'X-Actor-Id': baris.actor_id ?? actorId,
          // Diambil dari BARIS, bukan di-generate di sini.
          //
          // Kalau adapter ini yang membuatnya, setiap percobaan mengirim key
          // berbeda dan retry menghasilkan penjualan ganda. Itu persis cacat
          // yang disabotase di T9 property test, dan ia terlihat hanya di
          // bawah kegagalan jaringan -- tidak pernah pada jalur bahagia.
          'Idempotency-Key': baris.idempotency_key,
        },
        // Dikirim APA ADANYA, dan itu pilihan yang disengaja: server
        // menghitung hash request dari body untuk mendeteksi "key sama, body
        // berbeda" (IDEMPOTENCY_KEY_REUSED), jadi apa pun yang mengubah byte
        // body antar percobaan mengubah retry yang sah menjadi 422 permanen.
        //
        // ⚠ TIDAK TERUJI, dan itu dicoba. Mengganti baris ini dengan
        // `JSON.stringify(JSON.parse(baris.payload))` tidak menjatuhkan satu
        // pun test, termasuk yang menembak server sungguhan — perjalanan
        // bolak-balik JSON bersifat deterministik untuk bentuk payload kami,
        // jadi kedua percobaan tetap menghasilkan byte yang sama.
        //
        // Jadi ini pertahanan, bukan sesuatu yang dijaga test. Ia tetap
        // dipertahankan karena gratis: V8 MENGURUTKAN ULANG kunci yang
        // menyerupai integer saat parse, dan payload yang suatu hari memuat
        // kunci seperti itu akan patah dengan cara yang hanya terlihat sebagai
        // 422 di perangkat merchant.
        body: baris.payload,
      });
    } catch (e) {
      // Jaringan putus, DNS gagal, timeout. Permintaannya mungkin sudah
      // sampai -- `klasifikasi` membacanya sebagai `coba-lagi`, tidak pernah
      // sebagai gagal permanen.
      return { status: null, pesan: (e as Error).message };
    }

    let code: string | null = null;
    let pesan: string | undefined;
    try {
      const body = (await respons.json()) as { error?: { code?: string; message?: string } };
      code = body?.error?.code ?? null;
      pesan = body?.error?.message;
    } catch {
      // Body bukan JSON: proxy menyisipkan HTML, atau 502 datang dari load
      // balancer. Statusnya tetap terbaca, dan itulah yang menentukan
      // keputusan.
      code = null;
    }

    return { status: respons.status, code, pesan: pesan ?? `HTTP ${respons.status}` };
  };
}
