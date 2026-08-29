import { useCallback, useEffect, useState } from 'react';
import { Badge, Card, EmptyState, Icon, Table } from 'ds';
import { useSesi } from '../../../../packages/klien-api/src/sesi.tsx';
import { GalatHttp } from '../../../../packages/klien-api/src/http.ts';
import { Tombol } from '../Tombol.tsx';
import { rupiah } from '../../../../packages/domain/src/uang-tampilan.ts';
import { RentangTanggal, hariIni, type Outlet } from './RentangTanggal.tsx';
import { rentangSiap, type PosisiPenjualan, type Rentang } from './b16.ts';

/**
 * B-18 — Laporan Kasir (`IA:§3.3`, akses minimum Manajer Outlet).
 *
 * ## ⛔ Void melekat pada kasir yang PENJUALANNYA dibatalkan
 *
 * Bukan pada yang menekan tombolnya. Server mengelompokkan pembatal ke pemilik
 * order aslinya, dan itu yang membuat jumlah seluruh kasir SAMA dengan angka
 * di Laporan Penjualan — sifat yang dijaga test di sisi server.
 *
 * Layar menyebutnya, karena manajer yang membaca kolom "Dibatalkan" akan
 * mengira ia menunjuk siapa yang membatalkan. Yang menunjuk pelaku pembatalan
 * adalah laporan exception (FR-G5), bukan ini.
 *
 * ## Pola sama dengan B-16 dan B-17
 *
 * `RentangTanggal` bersama, tiga keadaan dibedakan, uang string dari ujung ke
 * ujung lewat `rupiah()`.
 */

interface BarisKasir {
  userId: string;
  name: string;
  penjualan: PosisiPenjualan;
}

interface HasilLaporan {
  from: string;
  to: string;
  outletId: string | null;
  kasir: BarisKasir[];
}

type Keadaan =
  | { jenis: 'awal' }
  | { jenis: 'memuat' }
  | { jenis: 'siap'; hasil: HasilLaporan }
  | { jenis: 'galat'; pesan: string };

export function KasirLaporanLayar() {
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
      const hasil = await api.minta<HasilLaporan>(`/reports/cashiers?${kueri.toString()}`);
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
    <div className="stack" style={{ gap: 'var(--space-4)', maxWidth: '96ch' }}>
      <div className="stack" style={{ gap: 'var(--space-1)' }}>
        <span className="t-title">Laporan Kasir</span>
        <span className="t-caption">
          Posisi penjualan per orang. Jumlah seluruh kasir sama dengan angka di Laporan Penjualan
          untuk rentang yang sama.
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
            catatan="Penjualan yang dibatalkan dikeluarkan dari omzet kasir yang menjualnya."
          />
        </div>
      </Card>

      <Card>
        <div className="card-pad">
          {keadaan.jenis === 'awal' || keadaan.jenis === 'memuat' ? (
            <EmptyState
              icon={<Icon name="users" size={32} />}
              title={keadaan.jenis === 'memuat' ? 'Menghitung laporan…' : 'Pilih rentang tanggal'}
              body={
                keadaan.jenis === 'memuat'
                  ? 'Server sedang menghitung posisi penjualan tiap kasir.'
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
          ) : keadaan.hasil.kasir.length === 0 ? (
            // ⛔ Kosong BUKAN kegagalan — pola yang sama dengan B-16 dan B-17.
            <EmptyState
              icon={<Icon name="users" size={32} />}
              title="Tidak ada transaksi pada rentang ini"
              body={`Tidak ada kasir yang mencatat penjualan ${keadaan.hasil.from === keadaan.hasil.to ? `pada ${keadaan.hasil.from}` : `antara ${keadaan.hasil.from} dan ${keadaan.hasil.to}`} untuk ${namaOutlet(keadaan.hasil.outletId)}. Bila Anda yakin ada penjualan, periksa apakah perangkat kasirnya sudah tersinkronisasi.`}
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

              <Table
                columns={[
                  { key: 'nama', header: 'Kasir' },
                  { key: 'transaksi', header: 'Transaksi', align: 'right' },
                  { key: 'kotor', header: 'Omzet kotor', align: 'right' },
                  { key: 'batal', header: 'Dibatalkan', align: 'right' },
                  { key: 'refund', header: 'Refund', align: 'right' },
                  { key: 'bersih', header: 'Omzet bersih', align: 'right' },
                ]}
                rows={keadaan.hasil.kasir.map((k) => ({
                  nama: k.name,
                  transaksi: <span className="num">{k.penjualan.jumlahTransaksi}</span>,
                  kotor: <span className="num">{rupiah(k.penjualan.omzetKotor)}</span>,
                  // ⛔ Keduanya angka POSITIF di respons; tanda minus ditambahkan
                  // di sini supaya tidak terbaca sebagai pemasukan.
                  batal: <span className="num">− {rupiah(k.penjualan.voidAmount)}</span>,
                  refund: <span className="num">− {rupiah(k.penjualan.refundAmount)}</span>,
                  bersih: (
                    <strong className="num">{rupiah(k.penjualan.omzetBersih)}</strong>
                  ),
                }))}
              />
            </div>
          )}
        </div>
      </Card>

      {/* ⛔ Dinyatakan di layar. Manajer yang membaca "Dibatalkan" akan mengira
          kolom itu menunjuk siapa yang membatalkan. */}
      <span className="t-caption">
        Kolom <strong>Dibatalkan</strong> menunjuk kasir yang <strong>penjualannya</strong>
        dibatalkan, bukan yang menekan tombol pembatalan. Itu yang membuat jumlah seluruh kasir
        cocok dengan Laporan Penjualan. Untuk melihat siapa yang membatalkan, buka Laporan
        exception.
      </span>
    </div>
  );
}
