import { useCallback, useEffect, useState } from 'react';
import {
  ringkasanAntrean,
  type RingkasanAntrean,
} from '../../../../packages/sync-client/src/status.ts';
import { useKeadaanLokal } from './DbLokalProvider.tsx';

/* Ringkasan antrean, dijaga tetap mutakhir lewat DUA jalur.

   ⛔ Bukan kehati-hatian berlebihan. Keduanya menutupi kelemahan yang lain:

     - `pemberitahu` menyala SEKETIKA, tapi hanya untuk perubahan yang lewat
       kode kita (penjualan baru, putaran relay selesai).
     - `watch()` melihat SEMUANYA -- termasuk katalog yang turun dan tulisan
       dari tab lain -- tapi butuh ~1.000 ms (diukur sembilan kali; lihat
       PLAN-pondasi-kasir §11.4), sementara `spec-h:224` menuntut < 1 detik.

   Menyandarkan indikator pada salah satunya saja berarti memilih antara
   "cepat tapi buta" dan "melihat semua tapi terlambat". */

export const RINGKASAN_KOSONG: RingkasanAntrean = {
  menunggu: 0,
  gagal: 0,
  tertuaPada: null,
  terakhirTerkirimPada: null,
};

export function useAntrean(): { ringkasan: RingkasanAntrean; siap: boolean; muatUlang: () => void } {
  const keadaan = useKeadaanLokal();
  const lokal = keadaan.lokal;
  const [ringkasan, setRingkasan] = useState<RingkasanAntrean>(RINGKASAN_KOSONG);
  const [pemicu, setPemicu] = useState(0);

  const muatUlang = useCallback(() => setPemicu((n) => n + 1), []);

  useEffect(() => {
    if (!lokal) return;
    const { db, ps, pemberitahu } = lokal;
    let hidup = true;

    const muat = () => {
      ringkasanAntrean(db).then(
        (r) => {
          if (hidup) setRingkasan(r);
        },
        () => {
          // Kegagalan membaca ringkasan tidak menjatuhkan layar. Angka lama
          // lebih baik daripada layar putih; yang TIDAK boleh adalah angka
          // yang dikarang jadi nol -- itu berbunyi "semua sudah terkirim".
        }
      );
    };

    muat();
    const lepas = pemberitahu.langgan(muat);
    const ac = new AbortController();
    ps.watch(
      'SELECT count(*) AS n FROM outbox_local',
      [],
      { onResult: muat },
      { signal: ac.signal, tables: ['outbox_local'] }
    );

    return () => {
      hidup = false;
      lepas();
      ac.abort();
    };
  }, [lokal, pemicu]);

  return { ringkasan, siap: keadaan.tahap === 'siap', muatUlang };
}
