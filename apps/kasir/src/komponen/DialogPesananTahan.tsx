import { useState } from 'react';
import { Tombol } from '../Tombol.tsx';
import { LatarDialog } from './LatarDialog.tsx';
import type { RingkasTahanan } from '../kasir/keranjang-tahan.ts';
import { MAKS_TAHANAN } from '../kasir/keranjang-tahan.ts';

/* K-03 toolbar #8 -- Pesanan tahan (Task 12, spec § 4).
 *
 * Daftar tahanan SHIFT INI: Tahan pesanan ini · Lanjutkan · Buang. Murni
 * lokal; pesanan tidak terkirim ke perangkat lain.
 *
 * ⛔ Lanjutkan NONAKTIF selama keranjang berjalan berisi, dengan kalimat yang
 * menawarkan "Tahan pesanan ini dulu" -- tidak pernah menimpa diam-diam.
 * ⛔ Buang minta konfirmasi lalu menulis jejak `cart_cleared` (sama dengan
 * Batalkan); batal di konfirmasi tidak menulis apa pun. Gagal apa pun menahan
 * dialog dan tahanan tetap utuh. */

/** Format Indonesia `14:32`, zona perangkat = zona outlet. */
function jam(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

interface Props {
  /** `null` = sedang dibaca. */
  daftar: RingkasTahanan[] | null;
  keranjangKosong: boolean;
  /** Mengembalikan pesan galat, atau `null` bila berhasil (pemanggil menutup dialog). */
  onTahan: () => Promise<string | null>;
  onLanjutkan: (id: string) => Promise<string | null>;
  onBuang: (id: string) => Promise<string | null>;
  onTutup: () => void;
  galatMuat: string | null;
  /** Pemformat rupiah tunggal dari pemanggil -- dialog ini tidak memformat uang sendiri. */
  formatUang: (n: bigint) => string;
}

export function DialogPesananTahan({ daftar, keranjangKosong, onTahan, onLanjutkan, onBuang, onTutup, galatMuat, formatUang }: Props) {
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const [konfirmasiBuang, setKonfirmasiBuang] = useState<string | null>(null);

  const jalankan = (f: () => Promise<string | null>) => {
    setSibuk(true);
    setGalat(null);
    void f()
      .then((pesan) => setGalat(pesan))
      .catch((e: Error) => setGalat(e.message))
      .finally(() => {
        setSibuk(false);
        setKonfirmasiBuang(null);
      });
  };

  return (
    <LatarDialog label="Pesanan tahan" onBatal={onTutup} lebar>
      <div className="kasir-dialog-form">
        <h2 className="t-title">Pesanan tahan</h2>
        <p className="t-caption kasir-login-sub">
          Disimpan di perangkat ini untuk shift ini (maksimal {MAKS_TAHANAN}). Tidak terkirim ke perangkat lain,
          dan shift tidak dapat ditutup selama masih ada.
        </p>

        <Tombol
          varian="secondary"
          disabled={sibuk || keranjangKosong}
          keterangan={keranjangKosong ? 'tahan-alasan' : undefined}
          onClick={() => jalankan(onTahan)}
        >
          Tahan pesanan ini
        </Tombol>
        {keranjangKosong && (
          <span id="tahan-alasan" className="t-caption">
            Keranjang kosong. Tidak ada pesanan yang dapat ditahan.
          </span>
        )}
        {!keranjangKosong && (
          <p id="tahan-lanjut-alasan" className="t-caption">
            Keranjang berjalan belum kosong. Tahan pesanan ini dulu sebelum melanjutkan pesanan lain.
          </p>
        )}

        {galatMuat !== null && (
          <p className="t-body-md kasir-login-galat" role="alert">
            Pesanan tahan tidak dapat dibaca: {galatMuat}
          </p>
        )}
        {daftar === null && galatMuat === null && <p className="t-body-md">Membaca pesanan tahan…</p>}
        {daftar !== null && daftar.length === 0 && galatMuat === null && (
          <p className="t-body-md">Belum ada pesanan tahan di shift ini.</p>
        )}

        {daftar !== null && daftar.length > 0 && (
          <ul className="kasir-tahan-daftar">
            {daftar.map((t) => (
              <li key={t.id} className="kasir-tahan-baris">
                <div className="kasir-tahan-isi">
                  <span className="t-body-md">Ditahan {jam(t.dibuatPada)}</span>
                  <span className="t-caption">
                    {t.jumlahItem} item · <span className="num">{formatUang(t.subtotal)}</span>
                  </span>
                </div>
                {konfirmasiBuang === t.id ? (
                  <div className="kasir-tahan-aksi">
                    <span className="t-caption">Buang pesanan ini? Pembatalan tercatat di audit.</span>
                    <Tombol varian="ghost" disabled={sibuk} onClick={() => setKonfirmasiBuang(null)}>
                      Batal
                    </Tombol>
                    <Tombol varian="danger" disabled={sibuk} onClick={() => jalankan(() => onBuang(t.id))}>
                      Ya, buang
                    </Tombol>
                  </div>
                ) : (
                  <div className="kasir-tahan-aksi">
                    <Tombol
                      varian="secondary"
                      disabled={sibuk || !keranjangKosong}
                      keterangan={!keranjangKosong ? 'tahan-lanjut-alasan' : undefined}
                      onClick={() => jalankan(() => onLanjutkan(t.id))}
                    >
                      Lanjutkan
                    </Tombol>
                    <Tombol varian="ghost" disabled={sibuk} onClick={() => setKonfirmasiBuang(t.id)}>
                      Buang
                    </Tombol>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {galat !== null && (
          <p className="t-body-md kasir-login-galat" role="alert">
            {galat}
          </p>
        )}

        <div className="kasir-dialog-aksi">
          <Tombol varian="ghost" disabled={sibuk} onClick={onTutup}>
            Tutup
          </Tombol>
        </div>
      </div>
    </LatarDialog>
  );
}
