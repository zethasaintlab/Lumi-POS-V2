import { useSyncExternalStore } from 'react';
import 'ds/styles.css';
import './kasir.css';
import { ShellKasir } from './ShellKasir.tsx';
import { DbLokalProvider, IsiSiap } from './konteks/DbLokalProvider.tsx';
import { Layar } from './layar/index.tsx';
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

function App() {
  const jalur = useJalur();
  const { rute } = cocokkanRute(jalur);

  return (
    // Penyedia membungkus SHELL, bukan hanya isinya: `SyncIndicator` di topbar
    // membaca antrean, dan ia harus tetap tergambar saat database belum siap
    // -- dengan keadaan yang menyatakan itu, bukan dengan "Tersinkron".
    //
    // Yang menahan render hanya ISI layar (`IsiSiap`). Topbar dan menu tetap
    // ada, kalau tidak kasir terjebak di satu layar galat tanpa jalan ke mana
    // pun.
    //
    // Penjadwal relay SENGAJA belum dinyalakan. `buatPengirimHttp` menuntut
    // baseUrl, tenantId, dan actorId, dan ketiganya lahir dari pendaftaran
    // perangkat (Modul F). Menyalakannya sekarang berarti memukul endpoint
    // tanpa identitas, 15 detik sekali, sepanjang hari.
    <DbLokalProvider>
      <ShellKasir
        // Nilai sementara: identitas perangkat dan sesi lahir bersama Modul F.
        // Ditulis apa adanya alih-alih dikosongkan, supaya jelas bahwa yang
        // belum ada adalah SUMBERNYA, bukan tempatnya di layar.
        outlet="Outlet belum dipilih"
        device="Perangkat belum terdaftar"
        pengguna="Belum masuk"
        ruteAktif={rute}
      >
        <IsiSiap>
          <Layar rute={rute} />
        </IsiSiap>
      </ShellKasir>
    </DbLokalProvider>
  );
}

export default App;
