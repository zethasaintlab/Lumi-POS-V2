import { useState } from 'react';
import { Tombol } from '../Tombol.tsx';
import { LatarDialog } from './LatarDialog.tsx';

/* K-03 — konfirmasi Batalkan keranjang (spec § 4 baris 7, keputusan user
 * 28 September 2026, issue #76).
 *
 * ⛔ Konfirmasi TETAP ada, dan kini ada harganya: mengonfirmasi menulis
 * `audit_event` `cart_cleared` (aktor, jumlah item, total, waktu) — pola
 * kecurangan kasir yang user sebut ("pelanggan membayar tunai, keranjang
 * dibatalkan, uangnya tidak tercatat"). Kalimatnya karena itu menyatakan
 * bahwa pembatalan DICATAT, bukan hanya bertanya "yakin?".
 *
 * ⛔ Escape dan "Batal" tidak menulis apa pun (`LatarDialog`: Escape selalu
 * jalur batal). Kegagalan menulis jejak MENAHAN dialog dan keranjang tetap
 * utuh: keranjang kosong tanpa jejak adalah persis yang fitur ini cegah.
 */

interface Props {
  jumlahItem: string;
  /** Mengembalikan pesan galat, atau `null` bila berhasil (dialog ditutup pemanggil). */
  onKonfirmasi: () => Promise<string | null>;
  onBatal: () => void;
}

export function DialogKonfirmasiKosongkan({ jumlahItem, onKonfirmasi, onBatal }: Props) {
  const [menyimpan, setMenyimpan] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  const jalankan = () => {
    setMenyimpan(true);
    setGalat(null);
    void onKonfirmasi()
      .then((pesan) => setGalat(pesan))
      .catch((e: Error) => setGalat(`Keranjang TIDAK dibatalkan: ${e.message}`))
      .finally(() => setMenyimpan(false));
  };

  return (
    <LatarDialog label="Kosongkan keranjang" onBatal={onBatal}>
      <h2 className="t-title">Kosongkan keranjang?</h2>
      <p className="t-body-md">{jumlahItem} item akan dibuang dari keranjang.</p>
      <p className="t-caption kasir-login-sub">
        Pembatalan ini tercatat di audit: siapa, berapa item, dan total keranjang.
      </p>

      {galat && (
        <p className="t-body-md kasir-login-galat" role="alert">
          {galat}
        </p>
      )}

      <div className="kasir-dialog-aksi">
        <Tombol varian="ghost" kritis disabled={menyimpan} onClick={onBatal}>
          Batal
        </Tombol>
        <Tombol varian="danger" kritis disabled={menyimpan} onClick={jalankan}>
          {menyimpan ? 'Mencatat…' : 'Kosongkan'}
        </Tombol>
      </div>
    </LatarDialog>
  );
}
