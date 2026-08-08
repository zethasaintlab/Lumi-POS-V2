// Permukaan publik `sync-client` (invariant #4: modul berkomunikasi hanya
// lewat `index.ts`).
//
// FR-H1 -- antrean upload persisten. Seluruh isi paket ini adalah fungsi
// dengan waktu, keacakan, dan I/O DI-INJECT: tidak ada `Date.now()`, tidak
// ada `fetch`, tidak ada akses berkas. `tests/sync-client/determinisme.test.js`
// menegakkannya terhadap kode, bukan terhadap niat.
//
// Yang TIDAK ada di sini, dan sengaja: pemasangan ke PowerSync, penjadwalan
// putaran relay, dan UI apa pun (FR-H2/H3/H4). Paket ini berdiri sendiri
// sampai pondasi klien ada.

export { enqueue, ENTITY_TYPES } from './enqueue.ts';
export type { ItemOutbox, EntityType } from './enqueue.ts';

export { kirimBatch, pulihkanSetelahMati, BATAS_BATCH } from './relay.ts';
export type { HasilBatch } from './relay.ts';

export { buatPengirimHttp } from './http.ts';
export type { KonfigHttp } from './http.ts';

export { klasifikasi } from './klasifikasi.ts';
export type { Keputusan } from './klasifikasi.ts';

export { jedaBackoffMs, sudahJatuhTempo, BATAS_PERCOBAAN_GAGAL } from './backoff.ts';

export type { DbLokal, BarisOutbox, HasilKirim, RelayDeps } from './ports.ts';
