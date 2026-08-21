import { useEffect, useState } from 'react';
import { Icon } from 'ds';
import {
  bacaAmbangAntrean,
  pesanAntreanMenua,
  tingkatAntrean,
  umurAntreanJam,
  type TingkatAntrean,
} from '../../../packages/domain/src/antrean-menua.ts';
import { navigasi } from './rute/navigasi.ts';

/* FR-H8 — peringatan antrean menua di layar kasir (`spec-h:310`).

   ## ⛔ PITA, bukan dialog

   AC FR-H8 kedua menuliskannya sebagai aturan: *"Notifikasi tidak mengganggu
   alur kasir di jam sibuk — muncul sebagai banner, bukan dialog."* Dialog
   yang muncul saat pelanggan sedang menunggu kembalian akan ditutup tanpa
   dibaca, setiap kali, sampai ia berhenti berarti apa pun.

   Karena itu pita ini:
   - tidak pernah mengambil fokus,
   - tidak menutupi apa pun (ia mendorong konten, tidak melayang di atasnya),
   - dan tidak punya tombol "tutup". Yang menutupnya adalah antrean yang
     terkuras. Peringatan yang dapat ditutup akan ditutup, dan uang yang
     belum tercatat tidak berhenti belum tercatat karena kasir menekan silang.

   ## ⛔ Jamnya di-INJECT lewat state, bukan dibaca saat render

   Umur antrean berubah karena WAKTU BERJALAN, bukan karena data berubah.
   Komponen yang menghitungnya dari `Date.now()` saat render akan menyeberangi
   ambang 4 jam tanpa pernah merender ulang — pita itu baru muncul saat ada
   penjualan berikutnya, yaitu tepat saat kasir sedang sibuk. Detak satu menit
   di bawah yang membuatnya muncul sendiri.

   Satu menit, bukan satu detik: ambang terkecil 4 jam, dan detak per detik
   membangunkan React 3.600 kali untuk melewati satu batas. */

const DETAK_MS = 60_000;

const IKON: Record<Exclude<TingkatAntrean, 'aman'>, 'clock' | 'alert'> = {
  peringatan: 'clock',
  kritis: 'alert',
  darurat: 'alert',
};

export function PitaAntrean({ tertuaPada }: { tertuaPada: string | null }) {
  const [sekarang, setSekarang] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setSekarang(Date.now()), DETAK_MS);
    return () => clearInterval(id);
  }, []);

  // Ambang dibaca dari environment variable (invariant #5, AC FR-H8 pertama).
  // Dibaca tiap render alih-alih di-memo: `import.meta.env` dibekukan saat
  // build, jadi tidak ada biaya yang perlu dihindari, dan memo-nya akan
  // menjadi satu tempat lagi yang harus benar.
  const ambang = bacaAmbangAntrean(import.meta.env.VITE_AMBANG_ANTREAN_JAM);
  const umur = umurAntreanJam(tertuaPada, sekarang);
  const tingkat = tingkatAntrean(umur, ambang);
  const pesan = pesanAntreanMenua(tingkat, umur);

  if (pesan === null || tingkat === 'aman') return null;

  return (
    // `role="status"` + `aria-live="polite"`, BUKAN `role="alert"`. Yang
    // kedua menyela pembaca layar di tengah kalimat; yang pertama menunggu
    // jeda. Aturan yang sama dengan "banner, bukan dialog", di lapisan yang
    // berbeda.
    <div className={`kasir-pita kasir-pita-${tingkat}`} role="status" aria-live="polite">
      <Icon name={IKON[tingkat]} size={18} />
      <span className="t-caption grow">{pesan}</span>
      {/* Satu jalan keluar, dan ia menuju tempat yang dapat menindaklanjuti:
          K-14 memuat daftar item gagal, tombol kirim ulang, dan ekspor
          darurat. Pita yang hanya memberi tahu tanpa jalan keluar adalah
          pita yang membuat kasir cemas tanpa alat. */}
      <button type="button" className="btn btn-ghost" onClick={() => navigasi('/sync')}>
        Lihat antrean
      </button>
    </div>
  );
}
