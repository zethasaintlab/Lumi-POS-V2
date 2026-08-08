import { createContext, useContext, useEffect, useState } from 'react';
import { EmptyState } from 'ds';
import { bukaDbLokal, type DbLokalTerbuka } from '../lokal/db.ts';
import {
  buatPemberitahu,
  type Pemberitahu,
} from '../../../../packages/sync-client/src/pemberitahu.ts';

/* Penyedia database lokal.

   Satu-satunya state global yang benar-benar dibutuhkan. Keputusan user
   8 Agustus 2026 (PLAN-pondasi-kasir §3.3): tanpa library state, karena
   DATABASE LOKAL ADALAH state-nya. Yang disimpan di React hanya pegangan ke
   database itu -- bukan salinan datanya.

   Ia TIDAK menahan render anak-anaknya saat database belum siap. Topbar dan
   menu harus tetap ada saat database gagal dibuka; kasir yang terjebak di
   satu layar galat tanpa jalan ke mana pun tidak dapat berbuat apa-apa. */

export interface LokalTerpasang extends DbLokalTerbuka {
  /**
   * Isyarat "antrean mungkin berubah", dipancarkan jalur tulis kita sendiri.
   *
   * Ada karena `watch()` PowerSync butuh ~1.000 ms untuk melihat perubahan
   * pada raw table (diukur), sementara `spec-h:224` menuntut indikator
   * diperbarui < 1 detik. Satu instance per proses, sama seperti database.
   */
  pemberitahu: Pemberitahu;
}

export type KeadaanLokal =
  | { tahap: 'membuka'; lokal: null }
  | { tahap: 'siap'; lokal: LokalTerpasang }
  | { tahap: 'galat'; lokal: null; pesan: string };

const Konteks = createContext<KeadaanLokal>({ tahap: 'membuka', lokal: null });

/* Dibuka SEKALI per proses, di luar React.

   `StrictMode` memasang lalu melepas lalu memasang ulang setiap efek di
   pengembangan. Tanpa promise tunggal di sini, itu berarti dua
   `PowerSyncDatabase` atas berkas yang sama. */
let pembukaan: Promise<LokalTerpasang> | null = null;
function buka(): Promise<LokalTerpasang> {
  pembukaan ??= bukaDbLokal().then((terbuka) => ({ ...terbuka, pemberitahu: buatPemberitahu() }));
  return pembukaan;
}

/**
 * Instance tunggal yang dipakai aplikasi, di luar React.
 *
 * Dibutuhkan penjadwal relay (yang hidup di luar pohon komponen) dan harness
 * browser, yang mengukur latensi indikator terhadap `pemberitahu` yang
 * BENAR-BENAR dipakai aplikasi — bukan salinan yang dibuat khusus untuk
 * diukur.
 */
export function lokalSekarang(): Promise<LokalTerpasang> {
  return buka();
}

export function DbLokalProvider({ children }: { children: React.ReactNode }) {
  const [keadaan, setKeadaan] = useState<KeadaanLokal>({ tahap: 'membuka', lokal: null });

  useEffect(() => {
    let hidup = true;
    buka().then(
      (lokal) => hidup && setKeadaan({ tahap: 'siap', lokal }),
      (e: Error) => hidup && setKeadaan({ tahap: 'galat', lokal: null, pesan: e.message })
    );
    return () => {
      hidup = false;
    };
  }, []);

  return <Konteks.Provider value={keadaan}>{children}</Konteks.Provider>;
}

export function useKeadaanLokal(): KeadaanLokal {
  return useContext(Konteks);
}

/**
 * Database lokal yang sudah terbuka.
 *
 * Melempar bila dipanggil sebelum siap — komponen yang membutuhkannya harus
 * dirender di dalam `<IsiSiap>`, dan melempar di sini membuat kesalahan itu
 * terlihat saat dikembangkan alih-alih menjadi `undefined` yang menjalar.
 */
export function useDbLokal(): LokalTerpasang {
  const k = useKeadaanLokal();
  if (!k.lokal) throw new Error('useDbLokal dipanggil sebelum database lokal siap.');
  return k.lokal;
}

/**
 * Merender `children` hanya bila database siap; selain itu keadaan kosong
 * atau error.
 *
 * Aturan design system #7: setiap komponen punya keadaan kosong DAN error.
 * Pesan error menyebut AKIBATNYA bagi kasir — "penjualan tidak dapat
 * disimpan" — bukan hanya nama galatnya, karena itu yang menentukan apa yang
 * harus dilakukan orang di depan mesin.
 */
export function IsiSiap({ children }: { children: React.ReactNode }) {
  const k = useKeadaanLokal();

  if (k.tahap === 'membuka') {
    return <EmptyState title="Menyiapkan data perangkat" body="Membuka database lokal." />;
  }
  if (k.tahap === 'galat') {
    return (
      <EmptyState
        title="Database lokal tidak dapat dibuka"
        body={`Penjualan tidak dapat disimpan di perangkat ini sampai masalahnya selesai. ${k.pesan}`}
      />
    );
  }
  return <>{children}</>;
}
