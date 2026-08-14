// Connector PowerSync -- jalur TURUN saja.
//
// Berkas ini tidak mengimpor `@powersync/web`: bentuk yang dibutuhkan
// PowerSync hanya dua metode, dan menuliskannya struktural membuat bagian
// paling berbahayanya (`uploadData`) dapat diuji di node.

import type { SumberToken, Kredensial } from './token.ts';

export interface ConnectorPowerSync {
  fetchCredentials(): Promise<Kredensial>;
  uploadData(db: unknown): Promise<void>;
}

/** Irisan yang dipakai `uploadData` untuk memeriksa antrean CRUD PowerSync. */
export interface SumberCrud {
  getCrudBatch(): Promise<unknown | null>;
}

/**
 * ⛔ Jalur naik PowerSync HARUS kosong, dan bukan karena belum sempat dibuat.
 *
 * `CLAUDE.md` bagian F2: "Jangan pasang trigger CRUD PowerSync. Penulisan
 * lokal ke raw table ditangkap HANYA lewat
 * `powersync_create_raw_table_crud_trigger`. Tidak memasangnya adalah yang
 * membuat `outbox_local` + REST idempoten tetap satu-satunya jalur naik."
 *
 * Karena triggernya tidak dipasang, `getCrudBatch()` selalu `null`. Kalau
 * suatu hari ia TIDAK null, artinya jalur naik kedua sudah lahir tanpa
 * disengaja -- entah karena trigger terpasang, entah karena sebuah tabel
 * dideklarasikan sebagai tabel PowerSync biasa.
 *
 * Yang benar saat itu terjadi adalah GAGAL KERAS. Menyelesaikan batch-nya
 * berarti membuang penulisan diam-diam; mengunggahnya berarti mengirim
 * penjualan lewat jalur yang tidak punya idempotency, tidak punya penomoran
 * struk, dan tidak pernah diuji.
 */
export async function tolakJalurNaikPowerSync(db: SumberCrud): Promise<void> {
  const batch = await db.getCrudBatch();
  if (batch === null || batch === undefined) return;

  throw new Error(
    'PowerSync memiliki antrean CRUD, padahal jalur naik seharusnya HANYA outbox_local + REST ' +
      'idempoten. Kemungkinan besar trigger raw table terpasang, atau ada tabel yang ' +
      'dideklarasikan sebagai tabel PowerSync biasa. Lihat CLAUDE.md bagian F2.'
  );
}

/**
 * Connector untuk `ps.connect(...)`.
 *
 * `fetchCredentials` dipanggil ulang oleh PowerSync setiap kali token
 * kedaluwarsa, jadi ia tidak boleh menyimpan token di cache sendiri.
 */
export function buatConnector(sumberToken: SumberToken): ConnectorPowerSync {
  return {
    fetchCredentials: () => sumberToken.ambil(),
    uploadData: (db) => tolakJalurNaikPowerSync(db as SumberCrud),
  };
}
