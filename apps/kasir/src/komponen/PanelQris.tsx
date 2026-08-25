import { useEffect, useRef, useState } from 'react';
import { Tombol } from '../Tombol.tsx';
import {
  BATAS_POLLING_MS,
  JEDA_POLLING_MS,
  cekStatus,
  tinggalkanDraf,
  type PengirimApi,
  type StatusBayar,
} from '../kasir/qris-dinamis.ts';
import { rupiah } from '../../../../packages/domain/src/uang-tampilan.ts';

/* FR-C14 — layar tunggu QRIS dinamis.

   ⛔ Layar ini ada di antara "uang belum berpindah" dan "uang sudah berpindah",
   dan itu jendela paling berbahaya di seluruh produk. `spec-c:291` menyebutnya
   langsung: *"Kelas bug yang paling sering menghasilkan uang hilang di POS:
   POS meminta QR, gateway timeout, pelanggan SUDAH membayar, POS tidak tahu."*

   Karena itu setiap keadaan di sini punya kalimatnya sendiri, dan tidak satu
   pun berbunyi sekadar "gagal". Kasir harus dapat membedakan "pelanggan belum
   bayar" dari "kami belum tahu apakah pelanggan sudah bayar" — yang pertama
   boleh dibatalkan, yang kedua tidak. */

export type HasilPanel =
  | { status: 'lunas' }
  | { status: 'batal' }
  /** Kasir menutup layar; drafnya SENGAJA dibiarkan hidup di server. */
  | { status: 'ditunda' };

interface Props {
  kirim: PengirimApi;
  qrString: string;
  paymentId: string;
  orderId: string;
  nominal: bigint;
  onSelesai: (h: HasilPanel) => void;
  /** Di-inject supaya polling dapat diuji tanpa menunggu waktu nyata. */
  jeda?: number;
  batas?: number;
}

export function PanelQris({
  kirim,
  qrString,
  paymentId,
  orderId,
  nominal,
  onSelesai,
  jeda = JEDA_POLLING_MS,
  batas = BATAS_POLLING_MS,
}: Props) {
  const [status, setStatus] = useState<StatusBayar>('pending');
  const [habisWaktu, setHabisWaktu] = useState(false);
  const [sibuk, setSibuk] = useState(false);
  const mulai = useRef(Date.now());

  useEffect(() => {
    let hidup = true;
    let jam: ReturnType<typeof setTimeout> | null = null;

    const putaran = async () => {
      if (!hidup) return;
      const hasil = await cekStatus(kirim, paymentId);
      if (!hidup) return;
      setStatus(hasil);
      if (hasil !== 'pending') return;
      /* ⛔ Polling BERHENTI di batasnya, dan statusnya TETAP `pending` —
         bukan `gagal`. `spec-c:307`: timeout polling meninggalkan payment
         sebagai `pending_confirmation` dan masuk daftar "Perlu diperiksa".
         Menandainya gagal berarti membatalkan transaksi yang uangnya mungkin
         sudah masuk. */
      if (Date.now() - mulai.current >= batas) {
        setHabisWaktu(true);
        return;
      }
      jam = setTimeout(() => void putaran(), jeda);
    };

    void putaran();
    return () => {
      hidup = false;
      if (jam !== null) clearTimeout(jam);
    };
  }, [kirim, paymentId, jeda, batas]);

  useEffect(() => {
    if (status === 'confirmed') onSelesai({ status: 'lunas' });
  }, [status, onSelesai]);

  const batalkan = () => {
    setSibuk(true);
    void tinggalkanDraf(kirim, orderId, 'qris_dibatalkan').finally(() => {
      setSibuk(false);
      onSelesai({ status: 'batal' });
    });
  };

  return (
    <div className="kasir-shift">
      <h2 className="t-title">Pindai untuk membayar</h2>
      <p className="t-display num">{rupiah(nominal)}</p>

      {/* ⛔ Payload QR ditampilkan sebagai TEKS, bukan gambar.
          Merender QR menuntut pustaka baru, dan `CLAUDE.md` mengunci
          dependensi. Teksnya tetap dapat dipindai lewat aplikasi bank yang
          menerima tempel-kode, dan batas ini dinyatakan alih-alih disembunyikan
          di balik kotak kosong. */}
      <p className="t-caption kasir-login-sub" style={{ wordBreak: 'break-all' }}>
        {qrString}
      </p>

      {status === 'pending' && !habisWaktu && (
        <p className="t-body-md" role="status">
          Menunggu pembayaran pelanggan… Jangan tutup layar ini.
        </p>
      )}

      {/* ⛔ Habis waktu BUKAN gagal, dan kalimatnya harus mengatakannya.
          Kasir yang membaca "gagal" akan menagih ulang pelanggan yang mungkin
          sudah membayar. */}
      {habisWaktu && status === 'pending' && (
        <p className="t-body-md kasir-login-galat" role="alert">
          Belum ada konfirmasi setelah 5 menit. Ini <strong>tidak berarti</strong> pelanggan belum
          membayar — tekan Cek status sebelum menagih ulang. Transaksi ini masuk daftar &ldquo;Perlu
          diperiksa&rdquo; di back-office.
        </p>
      )}

      {status === 'gagal' && (
        <p className="t-body-md kasir-login-galat" role="alert">
          Pembayaran ditolak penerbit. Pelanggan tidak terdebit; minta metode lain.
        </p>
      )}
      {status === 'kedaluwarsa' && (
        <p className="t-body-md kasir-login-galat" role="alert">
          QR sudah kedaluwarsa. Pelanggan tidak terdebit; buat pembayaran baru.
        </p>
      )}

      <div className="kasir-dialog-aksi">
        <Tombol
          varian="secondary"
          kritis
          disabled={sibuk}
          onClick={() => {
            setHabisWaktu(false);
            mulai.current = Date.now();
            void cekStatus(kirim, paymentId).then(setStatus);
          }}
        >
          Cek status
        </Tombol>
        {/* ⛔ Membatalkan hanya ditawarkan saat kita TAHU uangnya tidak
            berpindah — ditolak penerbit atau QR kedaluwarsa. Selama masih
            `pending`, yang tersedia adalah menutup layar: membatalkan draf
            yang pelanggannya sedang memindai berarti melepas stok untuk
            penjualan yang detik berikutnya lunas. */}
        {(status === 'gagal' || status === 'kedaluwarsa') && (
          <Tombol varian="ghost" kritis disabled={sibuk} onClick={batalkan}>
            {sibuk ? 'Membatalkan…' : 'Batalkan transaksi'}
          </Tombol>
        )}
        {status === 'pending' && (
          <Tombol varian="ghost" kritis disabled={sibuk} onClick={() => onSelesai({ status: 'ditunda' })}>
            Tutup layar
          </Tombol>
        )}
      </div>

      {status === 'pending' && (
        <p className="t-caption">
          Menutup layar tidak membatalkan pembayaran. Transaksinya tersimpan di server dan dapat
          dicek lagi dari layar ini.
        </p>
      )}
    </div>
  );
}
