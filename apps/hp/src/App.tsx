import { Masuk } from './Masuk.tsx';
import { Beranda } from './Beranda.tsx';
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
 * ## Online-only, dan itu keputusan IA
 *
 * `IA:265` menandai seluruh M-01…M-03 ❌ offline. Tidak ada PowerSync, tidak
 * ada SQLite lokal, tidak ada `outbox_local` di aplikasi ini — owner membaca,
 * ia tidak menjual.
 */

function Terlindungi() {
  const { sesi } = useSesi();
  return sesi === null ? <Masuk /> : <Beranda />;
}

export default function App() {
  return (
    <PenyediaSesi>
      <Terlindungi />
    </PenyediaSesi>
  );
}
