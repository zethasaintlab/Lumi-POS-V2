// Port yang dipakai seluruh modul ini. Sengaja sempit, supaya `node:sqlite`
// (test) dan `writeTransaction` PowerSync (aplikasi) sama-sama memenuhinya
// tanpa adaptor tebal.
//
// Prototipe 04 sudah membuktikan `writeTransaction` PowerSync adalah
// `BEGIN IMMEDIATE`/`COMMIT` sungguhan dengan kunci global, jadi
// `transaction` di bawah tidak berpura-pura.

export interface DbLokal {
  getAll<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbLokal) => Promise<T>): Promise<T>;
}

/**
 * Baris `outbox_local` apa adanya. Nama kolom sengaja tidak di-camelCase di
 * sini -- ia bentuk baris database, dan menerjemahkannya dua kali membuat
 * salah ketik hanya ketahuan saat runtime.
 */
export interface BarisOutbox {
  id: string;
  entity_type: string;
  entity_id: string;
  operation: string;
  payload: string;
  idempotency_key: string;
  status: string;
  attempts: number;
  last_error: string | null;
  last_attempt_at: string | null;
  created_at: string;
  depends_on: string | null;
}

/** Hasil satu panggilan HTTP, sudah dilepas dari bentuk `fetch`. */
export interface HasilKirim {
  /** null bila permintaan tidak pernah sampai (jaringan putus, timeout). */
  status: number | null;
  /** Kode error dari body `{ error: { code } }`, bila ada. */
  code?: string | null;
  /** Pesan untuk `last_error`. */
  pesan?: string;
}

export interface RelayDeps {
  db: DbLokal;
  /**
   * Waktu di-inject. `ARCH` § 11 dan `CLAUDE.md` menuntutnya sebagai
   * prasyarat DST, dan retrofitnya mahal.
   */
  now: () => number;
  /** Mengirim satu item. Jaringan tidak pernah disentuh langsung dari sini. */
  kirim: (baris: BarisOutbox) => Promise<HasilKirim>;
}
