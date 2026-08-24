import { Tombol } from './Tombol.tsx';
import { Masuk } from './Masuk.tsx';
import { Ringkasan } from './ringkasan/Ringkasan.tsx';
import { PenyediaSesi, useSesi } from '../../../packages/klien-api/src/sesi.tsx';
import 'ds/styles.css';
import './hp.css';

/**
 * Owner mobile — `IA:§4`.
 *
 * ## ⛔ Tanpa `AppShell`, dan tanpa sidebar
 *
 * `IA:229`: *"Persona P3 membuka aplikasi pukul 23:00 untuk satu pertanyaan.
 * IA-nya harus menjawab pertanyaan itu di layar pertama, bukan menyediakan
 * navigasi lengkap."* `AppShell` design system adalah shell back-office
 * dengan sidebar peta layar — kebalikan persis dari itu.
 *
 * ## ⛔ Tanpa bilah nav bawah, SEKARANG
 *
 * `IA:§4.2` menggambar `[Laporan] [Otorisasi]`, dan keduanya belum ada di v1:
 * Otorisasi adalah M-04 (`IA:251`, ditunda) dan Laporan adalah M-03 (belum
 * dibangun). Bilah nav yang tabnya menuju layar yang tidak ada terbaca sebagai
 * aplikasi rusak, bukan sebagai fitur yang ditunda — jadi ia lahir bersama
 * M-03, bukan sebelumnya.
 *
 * ## Online-only, dan itu keputusan IA
 *
 * `IA:265` menandai seluruh M-01…M-03 ❌ offline. Tidak ada PowerSync, tidak
 * ada SQLite lokal, tidak ada `outbox_local` di aplikasi ini — owner membaca,
 * ia tidak menjual.
 */

function Terlindungi() {
  const { sesi, keluar } = useSesi();
  if (sesi === null) return <Masuk />;

  return (
    <div className="stack" style={{ gap: 0 }}>
      <Ringkasan />
      <div style={{ padding: 'var(--space-4)' }}>
        <Tombol varian="ghost" penuh onClick={() => void keluar()}>
          Keluar
        </Tombol>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <PenyediaSesi>
      <Terlindungi />
    </PenyediaSesi>
  );
}
