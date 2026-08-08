import { useSyncExternalStore } from 'react';
import 'ds/styles.css';
import './kasir.css';
import { ShellKasir } from './ShellKasir.tsx';
import { DbLokalProvider } from './konteks/DbLokalProvider.tsx';
import { BelumDibangun } from './layar/BelumDibangun.tsx';
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
    <ShellKasir
      // Nilai sementara: identitas perangkat dan sesi lahir bersama Modul F.
      // Ditulis apa adanya alih-alih dikosongkan, supaya jelas bahwa yang
      // belum ada adalah SUMBERNYA, bukan tempatnya di layar.
      outlet="Outlet belum dipilih"
      device="Perangkat belum terdaftar"
      pengguna="Belum masuk"
      ruteAktif={rute}
    >
      {/* Database dibuka DI DALAM shell, bukan di sekelilingnya: topbar dan
          menu harus tetap ada saat database gagal dibuka, kalau tidak kasir
          terjebak di satu layar galat tanpa jalan ke mana pun.

          Penjadwal relay SENGAJA belum dinyalakan di sini. `buatPengirimHttp`
          menuntut baseUrl, tenantId, dan actorId, dan ketiganya lahir dari
          pendaftaran perangkat -- Modul F. Menyalakannya sekarang berarti
          memukul endpoint tanpa identitas, 15 detik sekali, sepanjang hari. */}
      <DbLokalProvider>
        <BelumDibangun rute={rute} />
      </DbLokalProvider>
    </ShellKasir>
  );
}

export default App;
