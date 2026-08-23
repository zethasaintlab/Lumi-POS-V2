import { createContext, useContext, useEffect, useState } from 'react';
import { EmptyState } from 'ds';
import { bukaDbLokal, type DbLokalTerbuka } from '../lokal/db.ts';
import {
  buatPemberitahu,
  type Pemberitahu,
} from '../../../../packages/sync-client/src/pemberitahu.ts';
import {
  bacaKonfigPerangkat,
  siapKirim,
  type KonfigPerangkat,
} from '../../../../packages/sync-client/src/perangkat.ts';
import { jalankanSinkronisasi, type SinkronisasiHidup } from '../sync/jalankan.ts';
import { bacaModeTelemetri } from '../../../../packages/domain/src/telemetri.ts';
import { pasangTelemetri, type TelemetriHidup } from '../telemetri/pasang.ts';
import { segarkanFitur } from '../fitur/segarkan.ts';

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

/* Sinkronisasi dinyalakan SEKALI per proses, tepat setelah database terbuka.

   Ia sengaja tidak dinyalakan dari dalam komponen: `StrictMode` memasang dan
   melepas efek dua kali di pengembangan, dan `ps.connect()` dua kali dalam
   satu proses belum pernah kami uji.

   Diam bila perangkat belum punya identitas -- menyalakannya tanpa itu berarti
   memukul endpoint tanpa tenant, 15 detik sekali, sepanjang hari. */
let sinkronisasi: Promise<SinkronisasiHidup | null> | null = null;
function nyalakanSinkronisasi(lokal: LokalTerpasang): Promise<SinkronisasiHidup | null> {
  sinkronisasi ??= bacaKonfigPerangkat(lokal.db).then((konfig) => {
    if (!siapKirim(konfig)) return null;
    nyalakanTelemetri(lokal, konfig!);
    nyalakanFitur(lokal, konfig!);
    return jalankanSinkronisasi({
      db: lokal.db,
      ps: lokal.ps,
      pemberitahu: lokal.pemberitahu,
      konfig: konfig!,
    });
  });
  return sinkronisasi;
}

/* Telemetri dinyalakan bersama sinkronisasi, dan dengan syarat yang sama.

   ⛔ Ia menuntut identitas perangkat karena endpoint-nya diautentikasi secret
   perangkat — tanpa itu tidak ada ke mana mengirim. Yang TIDAK ikut menunggu
   adalah pencatatannya: `catat()` menulis ke buffer lokal sejak boot, dan
   perangkat yang belum terdaftar tetap mengumpulkan metrik tentang dirinya.

   Modenya dari environment variable (invariant #5). Variabel yang tidak diset
   berarti `off` — lihat `bacaModeTelemetri`. */
let telemetri: TelemetriHidup | null = null;
function nyalakanTelemetri(lokal: LokalTerpasang, konfig: KonfigPerangkat): void {
  if (telemetri !== null) return;
  telemetri = pasangTelemetri({
    db: lokal.db,
    mode: bacaModeTelemetri(import.meta.env.VITE_TELEMETRY),
    baseUrl: konfig.baseUrl,
    tenantId: konfig.tenantId,
    deviceId: konfig.deviceId,
    tokenSecret: konfig.tokenSecret as string,
    appVersion: import.meta.env.VITE_APP_VERSION ?? '0.0.0',
  });
}

/* Feature flag disegarkan bersama sinkronisasi, dengan syarat yang sama.
   `ARCH:358` — kill switch per fitur per merchant, tanpa rilis.

   ⛔ Sekali saat boot, lalu setiap `JEDA_SEGARKAN_FITUR`. Ia sengaja JAUH
   lebih jarang daripada relay: flag berubah beberapa kali setahun, dan
   memukul endpoint tiap 15 detik untuk tiga boolean adalah beban yang tidak
   membeli apa pun.

   ⛔ Kegagalan DIABAIKAN sepenuhnya — `segarkanFitur` tidak pernah melempar,
   dan keadaan lama dipertahankan. Perangkat yang tidak dapat menyegarkan
   tetap memakai flag terakhir yang diketahuinya, dan itu justru yang
   membuat kill switch berlaku offline. */
const JEDA_SEGARKAN_FITUR = 15 * 60 * 1000;

let fitur: ReturnType<typeof setInterval> | null = null;
function nyalakanFitur(lokal: LokalTerpasang, konfig: KonfigPerangkat): void {
  if (fitur !== null) return;
  const sekali = () =>
    void segarkanFitur({
      db: lokal.db,
      baseUrl: konfig.baseUrl,
      tenantId: konfig.tenantId,
      deviceId: konfig.deviceId,
      tokenSecret: konfig.tokenSecret as string,
      fetchFn: fetch.bind(globalThis),
      waktu: () => new Date(),
    });
  sekali();
  fitur = setInterval(sekali, JEDA_SEGARKAN_FITUR);
}

/** Sinkronisasi yang sedang hidup, atau `null` bila perangkat belum terhubung. */
export function sinkronisasiSekarang(): Promise<SinkronisasiHidup | null> {
  return sinkronisasi ?? Promise.resolve(null);
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
      (lokal) => {
        if (!hidup) return;
        setKeadaan({ tahap: 'siap', lokal });
        // Kegagalan menyalakan sinkronisasi TIDAK menjatuhkan aplikasi:
        // penjualan offline tetap harus bisa dilakukan (I6). Ia dilaporkan
        // ke konsol dan terlihat di K-14 sebagai antrean yang tidak bergerak.
        void nyalakanSinkronisasi(lokal).catch((e) =>
          console.error('Sinkronisasi tidak dapat dinyalakan:', e)
        );
      },
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
