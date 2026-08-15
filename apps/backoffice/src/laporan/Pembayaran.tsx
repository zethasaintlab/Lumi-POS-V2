import { useCallback, useEffect, useState } from 'react';
import { Badge, Card, EmptyState, Icon, Table } from 'ds';
import { useSesi } from '../sesi.tsx';
import { GalatHttp } from '../http.ts';
import { Tombol } from '../Tombol.tsx';
import { rupiah } from '../katalog/produk.ts';
import { RentangTanggal, hariIni, type Outlet } from './RentangTanggal.tsx';
import { rentangSiap, type Rentang } from './b16.ts';

/**
 * B-19 — Laporan Pembayaran (`IA:§3.3`, akses minimum Manajer Outlet).
 *
 * ## ⛔ Tanpa rekonsiliasi, dan kata itu tidak muncul di layar
 *
 * `IA:§3.3` menamai layarnya "Laporan Pembayaran & Rekonsiliasi", tapi Modul
 * C-3 belum dibangun sama sekali (P1). Menampilkan kata "rekonsiliasi" untuk
 * layar yang tidak merekonsiliasi apa pun adalah janji yang tidak ditepati —
 * dan merchant yang mencarinya akan mengira ia rusak.
 *
 * Judul layar karena itu "Laporan Pembayaran" saja. Batasnya tercatat di
 * kontrak endpoint, bukan disamarkan dengan kolom kosong.
 *
 * ## ⛔ Hanya yang terkonfirmasi
 *
 * `spec-c:223`. QRIS dinamis yang masih menunggu konfirmasi dan pembayaran
 * yang gagal tidak dihitung — layar menyebutnya, karena selisih dengan total
 * di layar kasir adalah pertanyaan pertama yang akan diajukan merchant.
 *
 * Sampai PR ini, laporan di tablet TIDAK menyaring status sama sekali dan
 * menampilkan angka yang lebih besar. Itu diperbaiki bersama layar ini.
 */

interface BarisMetode {
  method: string;
  jumlahTransaksi: number;
  totalDiterima: string;
}

interface HasilLaporan {
  from: string;
  to: string;
  outletId: string | null;
  metode: BarisMetode[];
  totalDiterima: string;
}

type Keadaan =
  | { jenis: 'awal' }
  | { jenis: 'memuat' }
  | { jenis: 'siap'; hasil: HasilLaporan }
  | { jenis: 'galat'; pesan: string };

/** Nama metode yang dibaca merchant, bukan nilai kolom. */
const LABEL_METODE: Record<string, string> = {
  cash: 'Tunai',
  qris_dynamic: 'QRIS (dinamis)',
  qris_static: 'QRIS (statis)',
  card_edc: 'Kartu / EDC',
  other: 'Lainnya',
};

export function PembayaranLayar() {
  const { api } = useSesi();
  const [rentang, setRentang] = useState<Rentang>(() => ({ dari: hariIni(), sampai: hariIni() }));
  const [outlet, setOutlet] = useState<Outlet[]>([]);
  const [outletId, setOutletId] = useState('');
  const [keadaan, setKeadaan] = useState<Keadaan>({ jenis: 'awal' });

  useEffect(() => {
    let batal = false;
    void (async () => {
      try {
        const o = await api.minta<Outlet[]>('/outlets');
        if (!batal) setOutlet(o);
      } catch {
        // Penyaring outlet hilang; laporan seluruh tenant tetap terbuka.
      }
    })();
    return () => {
      batal = true;
    };
  }, [api]);

  const muat = useCallback(async () => {
    if (!rentangSiap(rentang)) return;
    setKeadaan({ jenis: 'memuat' });
    try {
      const kueri = new URLSearchParams({ from: rentang.dari, to: rentang.sampai });
      if (outletId.length > 0) kueri.set('outlet_id', outletId);
      const hasil = await api.minta<HasilLaporan>(`/reports/payments?${kueri.toString()}`);
      setKeadaan({ jenis: 'siap', hasil });
    } catch (err) {
      setKeadaan({
        jenis: 'galat',
        pesan:
          err instanceof GalatHttp
            ? err.message
            : 'Tidak dapat menghubungi server. Laporan ini butuh koneksi — angkanya dihitung server.',
      });
    }
  }, [api, rentang, outletId]);

  useEffect(() => {
    void muat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const namaOutlet = (id: string | null) =>
    id === null || id === '' ? 'Semua outlet' : (outlet.find((o) => o.id === id)?.name ?? id);

  return (
    <div className="stack" style={{ gap: 'var(--space-4)', maxWidth: '84ch' }}>
      <div className="stack" style={{ gap: 'var(--space-1)' }}>
        {/* ⛔ "Laporan Pembayaran" saja — tanpa "& Rekonsiliasi". */}
        <span className="t-title">Laporan Pembayaran</span>
        <span className="t-caption">
          Uang yang benar-benar <strong>diterima</strong>, dikelompokkan per metode.
        </span>
      </div>

      <Card>
        <div className="card-pad">
          <RentangTanggal
            rentang={rentang}
            onRentang={setRentang}
            outlet={outlet}
            outletId={outletId}
            onOutlet={setOutletId}
            sedangMuat={keadaan.jenis === 'memuat'}
            onTampilkan={() => void muat()}
            catatan="Pembayaran atas pesanan yang dibatalkan tidak dihitung."
          />
        </div>
      </Card>

      <Card>
        <div className="card-pad">
          {keadaan.jenis === 'awal' || keadaan.jenis === 'memuat' ? (
            <EmptyState
              icon={<Icon name="qr" size={32} />}
              title={keadaan.jenis === 'memuat' ? 'Menghitung laporan…' : 'Pilih rentang tanggal'}
              body={
                keadaan.jenis === 'memuat'
                  ? 'Server sedang menjumlahkan pembayaran pada rentang ini.'
                  : 'Tentukan tanggal awal dan akhir, lalu tekan Tampilkan.'
              }
            />
          ) : keadaan.jenis === 'galat' ? (
            <EmptyState
              icon={<Icon name="alert" size={32} />}
              title="Laporan tidak dapat dimuat"
              body={keadaan.pesan}
              action={<Tombol onClick={() => void muat()}>Coba lagi</Tombol>}
            />
          ) : keadaan.hasil.metode.length === 0 ? (
            <EmptyState
              icon={<Icon name="qr" size={32} />}
              title="Tidak ada pembayaran terkonfirmasi"
              body={`Tidak ada pembayaran yang terkonfirmasi ${keadaan.hasil.from === keadaan.hasil.to ? `pada ${keadaan.hasil.from}` : `antara ${keadaan.hasil.from} dan ${keadaan.hasil.to}`} untuk ${namaOutlet(keadaan.hasil.outletId)}. Pembayaran QRIS yang masih menunggu konfirmasi gateway belum muncul di sini.`}
            />
          ) : (
            <div className="stack" style={{ gap: 'var(--space-4)' }}>
              <div className="row between">
                <span className="t-body-md">
                  {keadaan.hasil.from === keadaan.hasil.to
                    ? keadaan.hasil.from
                    : `${keadaan.hasil.from} – ${keadaan.hasil.to}`}
                </span>
                <Badge tone="neutral">{namaOutlet(keadaan.hasil.outletId)}</Badge>
              </div>

              <div className="stack" style={{ gap: 'var(--space-1)' }}>
                <span className="label">Total diterima</span>
                <span className="t-display num">{rupiah(keadaan.hasil.totalDiterima)}</span>
              </div>

              <Table
                columns={[
                  { key: 'metode', header: 'Metode' },
                  { key: 'jumlah', header: 'Transaksi', align: 'right' },
                  { key: 'total', header: 'Diterima', align: 'right' },
                ]}
                rows={keadaan.hasil.metode.map((m) => ({
                  metode: LABEL_METODE[m.method] ?? m.method,
                  jumlah: <span className="num">{m.jumlahTransaksi}</span>,
                  total: <span className="num">{rupiah(m.totalDiterima)}</span>,
                }))}
              />
            </div>
          )}
        </div>
      </Card>

      <span className="t-caption">
        Hanya pembayaran yang <strong>terkonfirmasi</strong> yang dihitung — QRIS yang masih
        menunggu jawaban gateway dan pembayaran yang gagal tidak termasuk. Angka ini juga bukan
        omzet: omzet bersih mengurangkan refund, sementara refund tidak menghasilkan pembayaran
        negatif. Untuk angka omzet, buka Laporan Penjualan.
      </span>
    </div>
  );
}
