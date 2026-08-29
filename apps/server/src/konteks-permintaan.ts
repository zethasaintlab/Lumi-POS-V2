import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Konteks per-permintaan yang tidak diteruskan lewat parameter.
 *
 * ## ⛔ Kenapa AsyncLocalStorage dan bukan parameter
 *
 * `spec-f:412` menuntut *"setiap tindakan selama sesi support tercatat dengan
 * penanda"* — **setiap**. Meneruskan `supportSessionId` sebagai parameter
 * berarti menyentuh setiap pemanggil `recordAuditEvent` dan
 * `catatPerubahanServer` yang ada hari ini, dan **tidak** menyentuh yang lahir
 * bulan depan. Penanda yang hilang tidak menghasilkan error; ia menghasilkan
 * baris audit yang menisbatkan tindakan support kepada OWNER MERCHANT secara
 * pribadi. Itu tuduhan, dan tuduhan yang diam.
 *
 * Bentuk kegagalan yang sama persis dengan yang membuat penjaga peran pindah
 * ke satu hook: "audit menemukan 34 endpoint mutasi tanpa penjaga peran;
 * menambalnya satu per satu memperbaiki ke-34 itu dan TIDAK memperbaiki yang
 * ke-35."
 *
 * Jadi ia diset SEKALI, di hook yang sudah memverifikasi sesinya, dan dibaca
 * di satu tempat.
 *
 * ## ⛔ Yang TIDAK boleh masuk ke sini
 *
 * `tenantId` dan `actorUserId` tetap parameter eksplisit. Keduanya menentukan
 * BARIS MANA yang ditulis dan milik siapa; konteks tersembunyi untuk itu
 * membuat fungsi yang dipanggil dari jalur non-HTTP (webhook Midtrans,
 * `tools/*.mjs`) diam-diam menulis ke tenant yang salah atau gagal dengan
 * pesan yang tidak menyebut sebabnya.
 *
 * Penanda support aman di sini justru karena ketiadaannya adalah keadaan
 * NORMAL dan benar: permintaan tanpa sesi support memang tidak punya penanda.
 *
 * `node:async_hooks` adalah stdlib — nol dependensi baru.
 */
export interface KonteksPermintaan {
  /** F.5 — hanya terisi bila permintaan datang lewat token akses support. */
  supportSessionId?: string;
}

const penyimpanan = new AsyncLocalStorage<KonteksPermintaan>();

/** Menjalankan `fn` dengan konteks ini terpasang. Dipakai test dan jalur non-HTTP. */
export function denganKonteks<T>(konteks: KonteksPermintaan, fn: () => T): T {
  return penyimpanan.run(konteks, fn);
}

/**
 * Memasang konteks kosong untuk SISA permintaan ini.
 *
 * ⛔ Dipanggil SINKRON di hook `onRequest` paling awal, sebelum satu `await`
 * pun. `enterWith` mengikat store ke konteks async yang sedang berjalan; kalau
 * ia dipanggil SESUDAH sebuah `await`, yang terikat adalah kelanjutan hook itu
 * saja — dan storenya hilang tepat sebelum handler, tempat ia dibutuhkan.
 * Terukur, bukan dugaan: penandanya mendarat `null`.
 *
 * ⛔ Objeknya kosong dan DIMUTASI belakangan lewat `setelSesiSupport`. Isinya
 * belum diketahui pada titik ini — verifikasi token menuntut query database —
 * dan store yang dipasang belakangan tidak akan terlihat siapa pun.
 */
export function mulaiKonteks(): void {
  penyimpanan.enterWith({});
}

/**
 * Menandai bahwa permintaan ini berjalan atas nama sesi support.
 *
 * Memutasi store yang `mulaiKonteks` pasang. Tidak melakukan apa pun bila
 * tidak ada store — jalur non-HTTP memang tidak punya satu.
 */
export function setelSesiSupport(id: string): void {
  const store = penyimpanan.getStore();
  if (store) store.supportSessionId = id;
}

/**
 * Sesi support yang sedang berjalan, bila ada.
 *
 * Mengembalikan `null` di luar permintaan HTTP (webhook, alat operator, test
 * yang memanggil fungsi domain langsung) — dan itu jawaban yang benar, bukan
 * kegagalan.
 */
export function sesiSupportSekarang(): string | null {
  return penyimpanan.getStore()?.supportSessionId ?? null;
}
