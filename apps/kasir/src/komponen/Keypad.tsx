import { Tombol } from '../Tombol.tsx';

/* Keypad 6 digit — dipakai K-01 (login) dan K-11 (otorisasi).

   Satu komponen untuk keduanya karena `spec-f:109-112` menetapkan mekanisme
   yang sama persis di kedua permukaan, dan dua salinan keypad adalah dua
   tempat yang harus diingat saat aturan panjang PIN berubah.

   ## Kenapa keypad di layar, padahal tablet punya keyboard

   `spec-f:114`: otorisasi terjadi "di tengah transaksi, dengan antrean
   menunggu, tangan sering basah". Keyboard virtual sistem menutup separuh
   layar dan tata letaknya berbeda antar perangkat; tombol besar yang
   posisinya tetap dapat ditekan tanpa melihat.

   Target sentuh 56px (aturan design system #3 untuk aksi menyangkut uang) —
   otorisasi refund menyangkut uang, dan salah ketik di sini berarti mengulang
   seluruh dialog di depan pelanggan. */

interface Props {
  nilai: string;
  panjang: number;
  onUbah: (nilai: string) => void;
  /** Dimatikan saat terkunci atau saat verifikasi sedang berjalan. */
  nonaktif?: boolean;
}

export function Keypad({ nilai, panjang, onUbah, nonaktif = false }: Props) {
  const tekan = (digit: string) => {
    if (nilai.length >= panjang) return;
    onUbah(nilai + digit);
  };

  return (
    <div className="kasir-keypad">
      {/* Titik, bukan angka. `spec-f:19`: PIN tidak pernah terlihat -- dan
          perangkat kasir berdiri di ruang publik dengan pelanggan tepat di
          seberang layar. */}
      <div className="kasir-pin-titik" aria-label={`${nilai.length} dari ${panjang} digit terisi`}>
        {Array.from({ length: panjang }, (_, i) => (
          <span key={i} className={i < nilai.length ? 'kasir-titik terisi' : 'kasir-titik'} />
        ))}
      </div>

      <div className="kasir-keypad-grid">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <Tombol key={d} kritis disabled={nonaktif} onClick={() => tekan(d)}>
            {d}
          </Tombol>
        ))}
        <Tombol varian="ghost" kritis disabled={nonaktif || nilai.length === 0} onClick={() => onUbah('')}>
          Hapus
        </Tombol>
        <Tombol kritis disabled={nonaktif} onClick={() => tekan('0')}>
          0
        </Tombol>
        <Tombol
          varian="ghost"
          kritis
          disabled={nonaktif || nilai.length === 0}
          onClick={() => onUbah(nilai.slice(0, -1))}
        >
          ←
        </Tombol>
      </div>
    </div>
  );
}
