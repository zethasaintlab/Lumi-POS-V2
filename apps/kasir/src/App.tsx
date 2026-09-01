import { useEffect, useState, useSyncExternalStore } from 'react';
import 'ds/styles.css';
import './kasir.css';
import { ShellKasir } from './ShellKasir.tsx';
import { DbLokalProvider, IsiSiap, useKeadaanLokal } from './konteks/DbLokalProvider.tsx';
import {
  bacaKonfigPerangkat,
  type KonfigPerangkat,
} from '../../../packages/sync-client/src/perangkat.ts';
import { useSesi } from './konteks/useSesi.ts';
import { Layar } from './layar/index.tsx';
import { Login, SesiBelumSiap } from './layar/Login.tsx';
import { cocokkanRute } from './rute/tabel.ts';
import { jalurSekarang, langgananJalur } from './rute/navigasi.ts';

/* Akar aplikasi kasir.

   `useSyncExternalStore` dipakai, bukan `useState` + efek: sumber kebenaran
   jalurnya ada di `window.history`, di luar React, dan menyalinnya ke state
   React berarti dua salinan yang harus dijaga sepakat. Pola yang sama akan
   dipakai untuk data dari SQLite (keputusan user 8 Agustus 2026,
   PLAN-pondasi-kasir §3.3: database lokal ADALAH state-nya). */
function useJalur(): string {
  return useSyncExternalStore(langgananJalur, jalurSekarang, () => '/');
}

/* Isi aplikasi setelah database siap.

   Terpisah dari `App` karena `useSesi` membaca `sesi_lokal`, dan itu hanya
   mungkin setelah database terbuka. Hook yang dipanggil di `App` akan
   berjalan sebelum `DbLokalProvider` sempat membuka apa pun. */
function Isi({ jalur }: { jalur: string }) {
  const { rute, params } = cocokkanRute(jalur);
  const { sesi, siap } = useSesi();

  /* ⛔ K-15 (Perangkat) TIDAK menuntut sesi, dan itu bukan kelalaian.

     Perangkat baru belum punya satu pun pengguna di database lokalnya —
     katalog dan identitas turun SETELAH provisioning. Menuntut login lebih
     dulu membuat perangkat baru mustahil disiapkan: tidak ada PIN yang dapat
     diverifikasi terhadap tabel yang masih kosong. */
  const tanpaSesi = rute?.layar === 'K-15';

  if (!siap) return <SesiBelumSiap />;
  if (!sesi && !tanpaSesi) return <Login />;

  return <Layar rute={rute} params={params} />;
}

/* Identitas perangkat untuk topbar.

   ⛔ DIBACA dari `device_config`, tidak lagi dipaku sebagai teks.

   Sampai 31 Agustus 2026 `App` mengirim string tetap "Outlet belum dipilih"
   dan "Perangkat belum terdaftar" ke `ShellKasir` — SELAMANYA, termasuk pada
   perangkat yang sudah didaftarkan lewat K-15. Kasir yang sudah menyiapkan
   perangkatnya tetap membaca "Perangkat belum terdaftar" di setiap layar,
   sepanjang hari, dan tidak ada cara membedakannya dari perangkat yang memang
   belum siap.

   Bersamanya ikut jatuh cacat yang lebih berbahaya: indikator sinkronisasi
   menyatakan "Tersinkron" pada perangkat yang belum punya alamat server sama
   sekali. Lihat catatan di `keadaanIndikator`. */
function useIdentitasPerangkat(): { outlet: string; device: string; terdaftar: boolean } {
  const { lokal } = useKeadaanLokal();
  const [konfig, setKonfig] = useState<KonfigPerangkat | null>(null);

  useEffect(() => {
    if (!lokal) return;
    let batal = false;
    void (async () => {
      try {
        const k = await bacaKonfigPerangkat(lokal.db);
        if (!batal) setKonfig(k);
      } catch {
        // Kegagalan baca DIPERLAKUKAN sebagai belum terdaftar. Menganggapnya
        // terdaftar akan mengembalikan klaim "Tersinkron" lewat pintu belakang.
        if (!batal) setKonfig(null);
      }
    })();
    return () => {
      batal = true;
    };
  }, [lokal]);

  if (!konfig) {
    return { outlet: 'Outlet belum dipilih', device: 'Perangkat belum terdaftar', terdaftar: false };
  }
  return {
    // ⛔ Nama outlet ada di tabel `outlet` yang turun lewat PowerSync; sampai
    // ia turun, kode perangkat adalah satu-satunya yang perangkat ini tahu
    // tentang dirinya. Menampilkan id mentah akan mengulangi persis cacat
    // "UUID sebagai nama pengguna" di back-office.
    outlet: 'Outlet aktif',
    device: konfig.deviceCode,
    terdaftar: true,
  };
}

/* Kerangka aplikasi, DI DALAM `DbLokalProvider`.

   ⛔ Terpisah dari `App` karena `useIdentitasPerangkat` membaca
   `useKeadaanLokal`, dan hook yang dipanggil di `App` berjalan SEBELUM
   penyedianya ada di pohon — konteksnya belum terpasang, dan yang terjadi
   bukan galat yang jelas melainkan identitas perangkat yang selamanya kosong.
   Alasan yang sama persis dengan `Isi` yang sudah terpisah untuk `useSesi`. */
function Kerangka() {
  const jalur = useJalur();
  const { rute } = cocokkanRute(jalur);
  const { sesi } = useSesi();
  const perangkat = useIdentitasPerangkat();

  return (
    <ShellKasir
      outlet={perangkat.outlet}
      device={perangkat.device}
      perangkatTerdaftar={perangkat.terdaftar}
      pengguna={sesi ? sesi.nama : 'Belum masuk'}
      ruteAktif={rute}
    >
      <IsiSiap>
        <Isi jalur={jalur} />
      </IsiSiap>
    </ShellKasir>
  );
}

function App() {
  return (
    // Penyedia membungkus SHELL, bukan hanya isinya: `SyncIndicator` di topbar
    // membaca antrean, dan ia harus tetap tergambar saat database belum siap
    // -- dengan keadaan yang menyatakan itu, bukan dengan "Tersinkron".
    //
    // Yang menahan render hanya ISI layar (`IsiSiap`). Topbar dan menu tetap
    // ada, kalau tidak kasir terjebak di satu layar galat tanpa jalan ke mana
    // pun.
    <DbLokalProvider>
      <Kerangka />
    </DbLokalProvider>
  );
}

export default App;
