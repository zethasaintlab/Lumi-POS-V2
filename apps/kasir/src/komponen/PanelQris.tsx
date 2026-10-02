import { useEffect, useRef, useState } from 'react';
import { Tombol } from '../Tombol.tsx';
import { Icon } from 'ds';
import { GambarQr } from './GambarQr.tsx';
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
  /** `baru`: kasir menekan "Buat kode baru" sesudah QR kedaluwarsa. */
  | { status: 'batal'; baru?: boolean }
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
  /** Jam (ms) yang di-inject: hitung mundur dan batas polling memakainya, bukan `Date.now()` langsung. */
  sekarang?: () => number;
}

const dua = (n: number) => String(n).padStart(2, '0');
/** `MM:SS`, dibulatkan KE ATAS: 00:00 hanya muncul saat batasnya sungguh lewat. */
function formatSisa(ms: number): string {
  const detik = Math.max(0, Math.ceil(ms / 1000));
  return `${dua(Math.floor(detik / 60))}:${dua(detik % 60)}`;
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
  sekarang = Date.now,
}: Props) {
  const [status, setStatus] = useState<StatusBayar>('pending');
  const [habisWaktu, setHabisWaktu] = useState(false);
  const [sibuk, setSibuk] = useState(false);
  const jamRef = useRef(sekarang);
  jamRef.current = sekarang;
  const mulai = useRef(sekarang());
  const [kini, setKini] = useState(() => sekarang());

  useEffect(() => {
    const t = setInterval(() => setKini(jamRef.current()), 1000);
    return () => clearInterval(t);
  }, []);

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
      if (jamRef.current() - mulai.current >= batas) {
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

  /* ⛔ `onSelesai` lewat ref, efeknya hanya bergantung pada `status`: induk
     membuatnya baru di tiap render, dan `menyimpan=true` setelah panggilan
     pertama merender ulang — efek yang bergantung padanya menulis penjualan
     LUNAS GANDA untuk satu konfirmasi gateway. */
  const selesaiRef = useRef(onSelesai);
  selesaiRef.current = onSelesai;
  useEffect(() => {
    if (status === 'confirmed') selesaiRef.current({ status: 'lunas' });
  }, [status]);

  const batalkan = (baru: boolean) => {
    setSibuk(true);
    void tinggalkanDraf(kirim, orderId, 'qris_dibatalkan').finally(() => {
      setSibuk(false);
      onSelesai({ status: 'batal', baru });
    });
  };

  /* QR hanya tampil selama MASIH dapat dibayar. Kedaluwarsa dan ditolak
     penerbit menyembunyikannya: kode mati yang masih dapat dipindai mengundang
     pelanggan membayar ke tempat yang salah. Habis waktu lokal TIDAK
     menyembunyikannya — kita belum tahu apakah gateway sudah menutupnya. */
  const qrHidup = status === 'pending';

  if (status === 'confirmed') {
    return (
      <div className="kasir-qris" role="status">
        <span className="kasir-qris-centang" aria-hidden="true">
          <Icon name="check" size={32} />
        </span>
        <h2 className="t-title">Pembayaran terkonfirmasi</h2>
        <p className="t-body-md num">{rupiah(nominal)}</p>
      </div>
    );
  }

  return (
    <div className="kasir-qris">
      <div className="kasir-qris-baris">
        {qrHidup && <GambarQr isi={qrString} />}
        <div className="kasir-qris-info">
          {status === 'kedaluwarsa' ? (
            <h2 className="t-title">Kode QR kedaluwarsa</h2>
          ) : (
            <h2 className="t-title">Pindai QRIS untuk membayar</h2>
          )}
          <p className="t-title num">{rupiah(nominal)}</p>
          {qrHidup && !habisWaktu && (
            <p className="t-body-md num" aria-live="off">
              Berlaku selama {formatSisa(batas - (kini - mulai.current))}
            </p>
          )}
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
        </div>
      </div>

      {/* Jalur salin: payload apa adanya (tanpa trim), dapat dipilih. Hanya selama QR hidup. */}
      {qrHidup && (
        <p className="t-caption kasir-qris-teks" style={{ wordBreak: 'break-all' }}>
          {qrString}
        </p>
      )}

      <div className="kasir-dialog-aksi">
        <Tombol
          varian="secondary"
          kritis
          disabled={sibuk}
          onClick={() => {
            setHabisWaktu(false);
            mulai.current = jamRef.current();
            setKini(mulai.current);
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
        {status === 'gagal' && (
          <Tombol varian="ghost" kritis disabled={sibuk} onClick={() => batalkan(false)}>
            {sibuk ? 'Membatalkan…' : 'Batalkan transaksi'}
          </Tombol>
        )}
        {status === 'kedaluwarsa' && (
          <Tombol varian="ghost" kritis disabled={sibuk} onClick={() => batalkan(true)}>
            {sibuk ? 'Membatalkan…' : 'Buat kode baru'}
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
