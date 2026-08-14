// Menyalakan sinkronisasi: jalur turun (PowerSync) dan jalur naik (relay).
//
// Keduanya dinyalakan dari SATU tempat, dan hanya bila perangkat sudah punya
// identitas. Sebelum FR-F12 ditarik ke F2, tidak ada identitas sama sekali --
// penjadwal tidak dinyalakan, dan `ps.connect()` tidak pernah dipanggil.
//
// Berkas ini tidak mengimpor `@powersync/web`: bentuk yang dibutuhkannya dari
// database PowerSync hanya `connect`, jadi ia struktural. Yang tersisa untuk
// browser tinggal perilakunya, bukan pemasangannya.

import {
  buatPenjadwal,
  type Penjadwal,
} from '../../../../packages/sync-client/src/penjadwal.ts';
import { buatPengirimHttp } from '../../../../packages/sync-client/src/http.ts';
import {
  siapKirim,
  type KonfigPerangkat,
} from '../../../../packages/sync-client/src/perangkat.ts';
import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import type { Pemberitahu } from '../../../../packages/sync-client/src/pemberitahu.ts';
import { buatConnector, type ConnectorPowerSync } from './konektor.ts';
import { buatSumberTokenServer } from './token.ts';

export interface DapatDisambungkan {
  connect(connector: ConnectorPowerSync): unknown;
}

export interface DepsSinkronisasi {
  db: DbLokal;
  ps: DapatDisambungkan;
  pemberitahu: Pemberitahu;
  konfig: KonfigPerangkat;
  fetchFn?: typeof fetch;
  setTimer?: (fn: () => unknown, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

export interface SinkronisasiHidup {
  penjadwal: Penjadwal;
  /** Melepas listener `online` dan menghentikan penjadwal. */
  hentikan(): void;
}

/**
 * Menyalakan keduanya. Melempar bila perangkat belum siap — pemanggil yang
 * memutuskan apa yang ditampilkan, dan diam-diam tidak menyala adalah
 * kegagalan paling sulit dilacak yang bisa dipilih di sini.
 */
export function jalankanSinkronisasi(deps: DepsSinkronisasi): SinkronisasiHidup {
  const { db, ps, pemberitahu, konfig } = deps;
  if (!siapKirim(konfig)) {
    throw new Error('Perangkat belum punya identitas lengkap; sinkronisasi tidak dinyalakan.');
  }

  const fetchFn = deps.fetchFn ?? fetch;

  // --- jalur TURUN ---------------------------------------------------------
  // Token diminta ke server (FR-F12) dan tidak pernah dicetak di sini.
  ps.connect(
    buatConnector(
      buatSumberTokenServer({
        baseUrl: konfig.baseUrl,
        deviceId: konfig.deviceId,
        tenantId: konfig.tenantId,
        tokenSecret: konfig.tokenSecret as string,
        fetchFn,
      })
    )
  );

  // --- jalur NAIK ----------------------------------------------------------
  const penjadwal = buatPenjadwal({
    db,
    now: () => Date.now(),
    kirim: buatPengirimHttp({
      baseUrl: konfig.baseUrl,
      tenantId: konfig.tenantId,
      // Aktor CADANGAN saja: setiap baris membawa aktornya sendiri, dibekukan
      // saat penjualan dibuat. Yang di sini hanya dipakai untuk baris lama
      // yang belum punya — dan `device_code` menandai asalnya dengan jujur
      // alih-alih menebak nama orang.
      actorId: `device:${konfig.deviceCode}`,
      fetchFn,
    }),
    setTimer: deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms)),
    clearTimer: deps.clearTimer ?? ((h) => clearTimeout(h as number)),
    pemberitahu,
  });

  void penjadwal.mulai();

  // Koneksi yang kembali menjalankan putaran SEGERA, tanpa menunggu tick
  // berikutnya. Ia tidak mereset backoff item -- keputusan 8 Agustus 2026.
  const saatOnline = () => void penjadwal.picu('online');
  if (typeof window !== 'undefined') window.addEventListener('online', saatOnline);

  return {
    penjadwal,
    hentikan() {
      if (typeof window !== 'undefined') window.removeEventListener('online', saatOnline);
      penjadwal.berhenti();
    },
  };
}
