import { useState } from 'react';
import { Tombol } from '../Tombol.tsx';
import { LatarDialog } from './LatarDialog.tsx';
import { tampilkanKuantitas } from '../../../../packages/domain/src/kuantitas.ts';
import { rupiah } from '../../../../packages/domain/src/uang-tampilan.ts';
import { MAKS_TAHANAN, type RingkasTahanan } from '../kasir/keranjang-tahan.ts';

/* K-03 toolbar — Pesanan tahan (spec § 4 baris 8): daftar tahanan SHIFT INI,
   dengan Tahan pesanan ini · Lanjutkan · Buang.

   ⛔ Lanjutkan NONAKTIF selama keranjang berjalan berisi, dengan kalimat yang
   menawarkan "Tahan pesanan ini dulu" — menimpa keranjang itu diam-diam
   menghapus pesanan pelanggan lain.

   ⛔ Buang MENULIS jejak `cart_cleared` (G-BATAL-AUDIT), jadi ia meminta
   konfirmasi sebelum menulis: pola yang sama dengan Batalkan. Gagal apa pun
   MENAHAN dialog dan tahanan tetap utuh.

   ⛔ Setiap aksi menjawab pesan galat atau `null`; pemanggil yang memutuskan
   apa yang berubah di keranjang. Dialog tidak menyentuh database. */

interface Props {
  daftar: RingkasTahanan[];
  /** Keranjang berjalan berisi? */
  keranjangBerisi: boolean;
  /** Sesi dikenali? Buang butuh aktor untuk jejak. */
  adaSesi: boolean;
  onTahan: () => Promise<string | null>;
  onLanjut: (id: string) => Promise<string | null>;
  onBuang: (id: string) => Promise<string | null>;
  onTutup: () => void;
}

const jam = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }).replace('.', ':');
};

export function DialogPesananTahan({ daftar, keranjangBerisi, adaSesi, onTahan, onLanjut, onBuang, onTutup }: Props) {
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const [konfirmasiBuang, setKonfirmasiBuang] = useState<string | null>(null);

  const jalankan = (aksi: () => Promise<string | null>) => {
    setSibuk(true);
    setGalat(null);
    void aksi()
      .then((pesan) => setGalat(pesan))
      .catch((e: Error) => setGalat(e.message))
      .finally(() => setSibuk(false));
  };

  const penuh = daftar.length >= MAKS_TAHANAN;
  const alasanTahan = !keranjangBerisi
    ? 'Keranjang kosong. Tidak ada yang bisa ditahan.'
    : penuh
      ? `Sudah ada ${MAKS_TAHANAN} pesanan tahan. Lanjutkan atau buang salah satunya dulu.`
      : null;

  return (
    <LatarDialog label="Pesanan tahan" onBatal={onTutup}>
      <h2 className="t-title">Pesanan tahan</h2>
      <p className="t-caption kasir-login-sub">
        Tersimpan di perangkat ini untuk shift ini. Kas tidak dapat ditutup selama masih ada.
      </p>

      <Tombol
        varian="primary"
        disabled={sibuk || alasanTahan !== null}
        keterangan={alasanTahan !== null ? 'tahan-alasan' : undefined}
        onClick={() => jalankan(onTahan)}
      >
        Tahan pesanan ini
      </Tombol>
      {alasanTahan !== null && (
        <span id="tahan-alasan" className="sr-only">
          {alasanTahan}
        </span>
      )}

      {keranjangBerisi && daftar.length > 0 && (
        <p className="t-caption kasir-login-sub">
          Keranjang berjalan masih berisi. Tahan pesanan ini dulu sebelum melanjutkan pesanan lain.
        </p>
      )}

      {daftar.length === 0 ? (
        <p className="t-body-md">Belum ada pesanan tahan di shift ini.</p>
      ) : (
        <ul className="kasir-baris-daftar">
          {daftar.map((t) =>
            konfirmasiBuang === t.id ? (
              <li key={t.id} className="kasir-tahan-baris" data-tahanan={t.id}>
                <span className="grow t-body-md">Buang pesanan ini? Pembuangan tercatat di audit.</span>
                <Tombol varian="ghost" kritis disabled={sibuk} onClick={() => setKonfirmasiBuang(null)}>
                  Batal
                </Tombol>
                <Tombol
                  varian="danger"
                  kritis
                  disabled={sibuk}
                  onClick={() =>
                    jalankan(async () => {
                      const pesan = await onBuang(t.id);
                      if (pesan === null) setKonfirmasiBuang(null);
                      return pesan;
                    })
                  }
                >
                  Buang pesanan
                </Tombol>
              </li>
            ) : (
              <li key={t.id} className="kasir-tahan-baris" data-tahanan={t.id}>
                <span className="grow t-body-md">
                  {tampilkanKuantitas(String(t.jumlahItem))} item · <span className="num">{rupiah(t.subtotal)}</span>
                  <span className="t-caption"> · {jam(t.dibuatPada)}</span>
                </span>
                <Tombol
                  varian="ghost"
                  disabled={sibuk || keranjangBerisi}
                  keterangan={keranjangBerisi ? 'tahan-lanjut-alasan' : undefined}
                  onClick={() => jalankan(() => onLanjut(t.id))}
                >
                  Lanjutkan
                </Tombol>
                <Tombol
                  varian="ghost"
                  disabled={sibuk || !adaSesi}
                  keterangan={!adaSesi ? 'tahan-buang-alasan' : undefined}
                  onClick={() => setKonfirmasiBuang(t.id)}
                >
                  Buang
                </Tombol>
              </li>
            )
          )}
        </ul>
      )}
      {keranjangBerisi && daftar.length > 0 && (
        <span id="tahan-lanjut-alasan" className="sr-only">
          Keranjang berjalan berisi. Tahan pesanan ini dulu.
        </span>
      )}
      {!adaSesi && daftar.length > 0 && (
        <span id="tahan-buang-alasan" className="sr-only">
          Sesi tidak dikenali. Masuk ulang untuk membuang pesanan tahan.
        </span>
      )}

      {galat !== null && (
        <p className="t-body-md kasir-login-galat" role="alert">
          {galat}
        </p>
      )}

      <div className="kasir-dialog-aksi">
        <Tombol varian="ghost" kritis disabled={sibuk} onClick={onTutup}>
          Tutup
        </Tombol>
      </div>
    </LatarDialog>
  );
}
