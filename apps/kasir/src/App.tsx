import { useSyncExternalStore } from 'react';
import 'ds/styles.css';
import './kasir.css';
import { ShellKasir } from './ShellKasir.tsx';
import { DbLokalProvider, IsiSiap } from './konteks/DbLokalProvider.tsx';
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

function App() {
  const jalur = useJalur();
  const { rute } = cocokkanRute(jalur);
  const { sesi } = useSesi();

  return (
    // Penyedia membungkus SHELL, bukan hanya isinya: `SyncIndicator` di topbar
    // membaca antrean, dan ia harus tetap tergambar saat database belum siap
    // -- dengan keadaan yang menyatakan itu, bukan dengan "Tersinkron".
    //
    // Yang menahan render hanya ISI layar (`IsiSiap`). Topbar dan menu tetap
    // ada, kalau tidak kasir terjebak di satu layar galat tanpa jalan ke mana
    // pun.
    <DbLokalProvider>
      <ShellKasir
        // Outlet dan perangkat masih menunggu K-15 mengisinya ke
        // `device_config`; nama pengguna sekarang datang dari sesi sungguhan.
        outlet="Outlet belum dipilih"
        device="Perangkat belum terdaftar"
        pengguna={sesi ? sesi.nama : 'Belum masuk'}
        ruteAktif={rute}
      >
        <IsiSiap>
          <Isi jalur={jalur} />
        </IsiSiap>
      </ShellKasir>
    </DbLokalProvider>
  );
}

export default App;
