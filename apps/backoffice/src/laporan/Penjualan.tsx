import { useCallback, useEffect, useState } from 'react';
import { Badge, Card, EmptyState, Icon, Table } from 'ds';
import { useSesi } from '../sesi.tsx';
import { GalatHttp } from '../http.ts';
import { Tombol } from '../Tombol.tsx';
import { rupiah } from '../katalog/produk.ts';
import { RentangTanggal, hariIni, type Outlet } from './RentangTanggal.tsx';
import {
  periodeKosong,
  rentangSiap,
  susunRingkasan,
  type PosisiPenjualan,
  type Rentang,
} from './b16.ts';

/**
 * B-16 — Laporan Penjualan (`IA:§3.3`, akses minimum Manajer Outlet).
 *
 * Konsumen pertama `GET /reports/sales`.
 *
 * ## ⛔ Uang tetap STRING dari server sampai layar
 *
 * Endpoint mengirim setiap nilai uang sebagai string desimal karena
 * `PosisiPenjualan` memakai `bigint` dan `Number` membuang presisi di atas
 * 2⁵³. Layar ini tidak pernah memanggil `Number()` atas nilai uang — ia
 * meneruskannya ke `rupiah()`, yang mengubahnya lewat `BigInt` langsung.
 *
 * Menemukan itu memaksa perbaikan di `rupiah()` sendiri: versi sebelumnya
 * melewatkan string lewat `Number`, dan `Number('9007199254740993')`
 * menghasilkan …992 — satu rupiah hilang tanpa satu pun error.
 *
 * ## ⛔ Pemilih rentang menjaga invariannya sendiri
 *
 * Server menolak `from > to` dengan 400 — benar untuk API, buruk untuk layar.
 * Merchant yang menggeser tanggal awal melewati tanggal akhir bermaksud
 * memindahkan rentangnya, bukan meminta error. `setelRentang` mendorong sisi
 * lain, jadi rentang terbalik tidak pernah terkirim.
 *
 * ## ⛔ Tiga keadaan yang berbeda, dan ketiganya dibedakan
 *
 * **Memuat** · **Galat** (server tidak menjawab / menolak) · **Kosong**
 * (periode tanpa transaksi). Yang ketiga BUKAN kegagalan, dan menampilkannya
 * sebagai error akan membuat merchant mengira laporannya rusak di hari libur.
 *
 * Dan nol yang BERMAKNA — omzet nol dengan transaksi yang semuanya direfund —
 * tidak pernah masuk keadaan kosong. Itu hari yang justru paling perlu
 * dilihat.
 */

interface HasilLaporan {
  from: string;
  to: string;
  outletId: string | null;
  penjualan: PosisiPenjualan;
}

type Keadaan =
  | { jenis: 'awal' }
  | { jenis: 'memuat' }
  | { jenis: 'siap'; hasil: HasilLaporan }
  | { jenis: 'galat'; pesan: string };

export function PenjualanLayar() {
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
        // Kegagalan memuat daftar outlet TIDAK menjatuhkan laporan. Yang
        // hilang hanya penyaring; laporan seluruh tenant tetap dapat dibuka.
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
      const hasil = await api.minta<HasilLaporan>(`/reports/sales?${kueri.toString()}`);
      setKeadaan({ jenis: 'siap', hasil });
    } catch (err) {
      setKeadaan({
        jenis: 'galat',
        pesan:
          err instanceof GalatHttp
            ? err.message
            : 'Tidak dapat menghubungi server. Laporan ini butuh koneksi — angkanya dihitung server, bukan dari data perangkat ini.',
      });
    }
  }, [api, rentang, outletId]);

  // Dimuat sekali saat layar dibuka, lalu hanya saat merchant menekan tombol.
  // Memuat ulang pada setiap ketikan tanggal akan menembak server di setiap
  // keadaan setengah-diketik.
  useEffect(() => {
    void muat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const namaOutlet = (id: string | null) =>
    id === null || id === '' ? 'Semua outlet' : (outlet.find((o) => o.id === id)?.name ?? id);

  return (
    <div className="stack" style={{ gap: 'var(--space-4)', maxWidth: '84ch' }}>
      <div className="stack" style={{ gap: 'var(--space-1)' }}>
        <span className="t-title">Laporan Penjualan</span>
        <span className="t-caption">
          Dihitung server untuk seluruh perangkat — berbeda dari laporan di aplikasi kasir, yang
          hanya mencakup perangkat itu sendiri.
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
            catatan="Pesanan yang dibatalkan dikeluarkan dari omzet; refund dikurangkan."
          />
        </div>
      </Card>

      {/* --- hasil ---------------------------------------------------------- */}
      <Card>
        <div className="card-pad">
          {keadaan.jenis === 'awal' || keadaan.jenis === 'memuat' ? (
            <EmptyState
              icon={<Icon name="activity" size={32} />}
              title={keadaan.jenis === 'memuat' ? 'Menghitung laporan…' : 'Pilih rentang tanggal'}
              body={
                keadaan.jenis === 'memuat'
                  ? 'Server sedang menjumlahkan transaksi pada rentang ini.'
                  : 'Tentukan tanggal awal dan akhir, lalu tekan Tampilkan.'
              }
            />
          ) : keadaan.jenis === 'galat' ? (
            // ⛔ Galat DIBEDAKAN dari kosong. `spec-g` FR-G7 menuntut kegagalan
            // menjelaskan alasannya, bukan spinner tanpa akhir.
            <EmptyState
              icon={<Icon name="alert" size={32} />}
              title="Laporan tidak dapat dimuat"
              body={keadaan.pesan}
              action={<Tombol onClick={() => void muat()}>Coba lagi</Tombol>}
            />
          ) : periodeKosong(keadaan.hasil.penjualan) ? (
            // ⛔ Kosong BUKAN kegagalan. Menampilkannya sebagai error membuat
            // merchant mengira laporannya rusak di hari libur.
            <EmptyState
              icon={<Icon name="receipt" size={32} />}
              title="Tidak ada transaksi pada rentang ini"
              body={`Tidak ada penjualan yang tercatat ${keadaan.hasil.from === keadaan.hasil.to ? `pada ${keadaan.hasil.from}` : `antara ${keadaan.hasil.from} dan ${keadaan.hasil.to}`} untuk ${namaOutlet(keadaan.hasil.outletId)}. Bila Anda yakin ada penjualan, periksa apakah perangkat kasirnya sudah tersinkronisasi.`}
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

              {/* Angka utama, ditonjolkan sendirian. */}
              {susunRingkasan(keadaan.hasil.penjualan)
                .filter((b) => b.utama)
                .map((b) => (
                  <div key={b.kunci} className="stack" style={{ gap: 'var(--space-1)' }}>
                    <span className="label">{b.judul}</span>
                    <span className="t-display num">{rupiah(b.nilai)}</span>
                    <span className="t-caption">{b.keterangan}</span>
                  </div>
                ))}

              <Table
                columns={[
                  { key: 'judul', header: 'Angka' },
                  { key: 'nilai', header: 'Nilai', align: 'right' },
                  { key: 'keterangan', header: 'Arti' },
                ]}
                rows={susunRingkasan(keadaan.hasil.penjualan)
                  .filter((b) => !b.utama)
                  .map((b) => ({
                    judul: b.judul,
                    nilai: (
                      <span className="num">
                        {/* ⛔ Jumlah transaksi bukan uang — ia satu-satunya
                            nilai yang memang `number`. */}
                        {b.kunci === 'jumlahTransaksi'
                          ? String(b.nilai)
                          : `${b.pengurang ? '− ' : ''}${rupiah(b.nilai)}`}
                      </span>
                    ),
                    keterangan: <span className="t-caption">{b.keterangan}</span>,
                  }))}
              />
            </div>
          )}
        </div>
      </Card>

      <span className="t-caption">
        Angka di sini dihitung server dengan fungsi yang sama persis dengan laporan di aplikasi
        kasir — yang berbeda hanya cakupannya: laporan kasir hanya mencakup perangkat itu sendiri,
        laporan ini mencakup seluruh perangkat yang sudah tersinkronisasi.
      </span>
    </div>
  );
}
