import { createContext, useContext, useEffect, useState } from 'react';
import { EmptyState } from 'ds';
import { bukaDbLokal, type DbLokalTerbuka } from '../lokal/db.ts';

/* Penyedia database lokal.

   Satu-satunya state global yang benar-benar dibutuhkan pondasi ini. Keputusan
   user 8 Agustus 2026 (PLAN-pondasi-kasir §3.3): tanpa library state, karena
   DATABASE LOKAL ADALAH state-nya. Yang disimpan di React hanya pegangan ke
   database itu -- bukan salinan datanya. */

const Konteks = createContext<DbLokalTerbuka | null>(null);

/* Dibuka SEKALI per proses, di luar React.

   `StrictMode` memasang lalu melepas lalu memasang ulang setiap efek di
   pengembangan. Tanpa promise tunggal di sini, itu berarti dua
   `PowerSyncDatabase` atas berkas OPFS yang sama -- dan prototipe 03 sudah
   mengukur bahwa dua penulis atas satu berkas OPFS berakhir
   `NoModificationAllowedError`. */
let pembukaan: Promise<DbLokalTerbuka> | null = null;
function buka(): Promise<DbLokalTerbuka> {
  pembukaan ??= bukaDbLokal();
  return pembukaan;
}

type Keadaan =
  | { tahap: 'membuka' }
  | { tahap: 'siap'; db: DbLokalTerbuka }
  | { tahap: 'galat'; pesan: string };

export function DbLokalProvider({ children }: { children: React.ReactNode }) {
  const [keadaan, setKeadaan] = useState<Keadaan>({ tahap: 'membuka' });

  useEffect(() => {
    let hidup = true;
    buka().then(
      (db) => hidup && setKeadaan({ tahap: 'siap', db }),
      (e: Error) => hidup && setKeadaan({ tahap: 'galat', pesan: e.message })
    );
    return () => {
      hidup = false;
    };
  }, []);

  if (keadaan.tahap === 'membuka') {
    return <EmptyState title="Menyiapkan data perangkat" body="Membuka database lokal." />;
  }

  /* Aturan design system #7: setiap komponen punya keadaan kosong DAN error.
     Pesannya menyebut akibatnya bagi kasir -- "tidak dapat menyimpan
     penjualan" -- bukan hanya nama galatnya, karena itu yang menentukan apa
     yang harus dilakukan orang di depan mesin. */
  if (keadaan.tahap === 'galat') {
    return (
      <EmptyState
        title="Database lokal tidak dapat dibuka"
        body={`Penjualan tidak dapat disimpan di perangkat ini sampai masalahnya selesai. ${keadaan.pesan}`}
      />
    );
  }

  return <Konteks.Provider value={keadaan.db}>{children}</Konteks.Provider>;
}

/** Database lokal yang sudah terbuka. Melempar bila dipakai di luar penyedia. */
export function useDbLokal(): DbLokalTerbuka {
  const db = useContext(Konteks);
  if (!db) throw new Error('useDbLokal dipakai di luar <DbLokalProvider>.');
  return db;
}
