import { useCallback, useEffect, useState } from 'react';
import { Badge, Card, EmptyState, Icon, Table } from 'ds';
import { useSesi } from '../sesi.tsx';
import { GalatHttp } from '../http.ts';
import { Tombol } from '../Tombol.tsx';
import { rupiah } from '../katalog/produk.ts';
import { RentangTanggal, hariIni, type Outlet } from './RentangTanggal.tsx';
import {
  namaLengkap,
  periodeKosong,
  rentangSiap,
  totalProduk,
  urutkanProduk,
  type BarisProduk,
  type Rentang,
} from './b17.ts';

/**
 * B-17 — Laporan Produk (`IA:§3.3`, akses minimum Manajer Outlet).
 *
 * ## ⛔ Ini laporan BARANG, bukan uang — dan layar mengatakannya
 *
 * `nilaiKotor` bukan omzet. Ia nilai barang yang keluar: sebelum diskon baris,
 * sebelum pajak, dan **sebelum refund**. Angkanya karena itu tidak akan sama
 * dengan Laporan Penjualan untuk rentang yang sama, dan merchant yang
 * membandingkan keduanya harus tahu kenapa **sebelum** ia menemukan
 * selisihnya sendiri.
 *
 * `CLAUDE.md`: *"baris produk menyatakan barang apa yang keluar, dan refund
 * uang tidak selalu mengembalikan barang"*.
 *
 * ## Per VARIAN, dan itu keputusan produk
 *
 * `order_line` tidak menyimpan `item_id` sama sekali — hanya `variation_id`
 * beserta snapshot namanya. Melaporkan per varian juga lebih berguna: yang
 * habis di rak adalah varian, bukan produk.
 *
 * Nama yang ditampilkan adalah snapshot saat penjualan, jadi produk yang
 * berganti nama tetap dapat dijelaskan di laporan lama.
 */

interface HasilLaporan {
  from: string;
  to: string;
  outletId: string | null;
  produk: BarisProduk[];
}

type Keadaan =
  | { jenis: 'awal' }
  | { jenis: 'memuat' }
  | { jenis: 'siap'; hasil: HasilLaporan }
  | { jenis: 'galat'; pesan: string };

export function ProdukLaporanLayar() {
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
        // Penyaring outlet hilang; laporan seluruh tenant tetap dapat dibuka.
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
      const hasil = await api.minta<HasilLaporan>(`/reports/products?${kueri.toString()}`);
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

  useEffect(() => {
    void muat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const namaOutlet = (id: string | null) =>
    id === null || id === '' ? 'Semua outlet' : (outlet.find((o) => o.id === id)?.name ?? id);

  return (
    <div className="stack" style={{ gap: 'var(--space-4)', maxWidth: '96ch' }}>
      <div className="stack" style={{ gap: 'var(--space-1)' }}>
        <span className="t-title">Laporan Produk</span>
        <span className="t-caption">
          Barang yang <strong>keluar</strong> — bukan uang yang masuk. Dilaporkan per varian, karena
          yang habis di rak adalah varian.
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
            catatan="Pesanan yang dibatalkan tidak dihitung; pesanan yang direfund tetap dihitung."
          />
        </div>
      </Card>

      <Card>
        <div className="card-pad">
          {keadaan.jenis === 'awal' || keadaan.jenis === 'memuat' ? (
            <EmptyState
              icon={<Icon name="package" size={32} />}
              title={keadaan.jenis === 'memuat' ? 'Menghitung laporan…' : 'Pilih rentang tanggal'}
              body={
                keadaan.jenis === 'memuat'
                  ? 'Server sedang menjumlahkan baris pesanan pada rentang ini.'
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
          ) : periodeKosong(keadaan.hasil.produk) ? (
            // ⛔ Kosong BUKAN kegagalan — pola yang sama dengan B-16.
            <EmptyState
              icon={<Icon name="package" size={32} />}
              title="Tidak ada barang keluar pada rentang ini"
              body={`Tidak ada baris pesanan yang tercatat ${keadaan.hasil.from === keadaan.hasil.to ? `pada ${keadaan.hasil.from}` : `antara ${keadaan.hasil.from} dan ${keadaan.hasil.to}`} untuk ${namaOutlet(keadaan.hasil.outletId)}. Bila Anda yakin ada penjualan, periksa apakah perangkat kasirnya sudah tersinkronisasi.`}
            />
          ) : (
            (() => {
              const baris = urutkanProduk(keadaan.hasil.produk);
              const total = totalProduk(baris);
              return (
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
                      { key: 'nama', header: 'Varian' },
                      { key: 'kuantitas', header: 'Kuantitas', align: 'right' },
                      { key: 'nilai', header: 'Nilai kotor', align: 'right' },
                    ]}
                    rows={[
                      ...baris.map((b) => ({
                        nama: namaLengkap(b),
                        // ⛔ `kuantitasTampil` dari SERVER, tidak dihitung
                        // ulang di sini — dua tempat yang membagi 1000 akan
                        // menyimpang, dan yang menyimpang di sini menampilkan
                        // "2000 gelas" untuk dua gelas.
                        kuantitas: <span className="num">{b.kuantitasTampil}</span>,
                        nilai: <span className="num">{rupiah(b.nilaiKotor)}</span>,
                      })),
                      {
                        nama: (
                          <strong>
                            Total · <span className="num">{total.jumlahVarian}</span> varian
                          </strong>
                        ),
                        kuantitas: (
                          <strong className="num">{total.kuantitasTampil}</strong>
                        ),
                        nilai: <strong className="num">{rupiah(total.nilaiKotor)}</strong>,
                      },
                    ]}
                  />
                </div>
              );
            })()
          )}
        </div>
      </Card>

      {/* ⛔ Dinyatakan di layar, bukan hanya di kode. Merchant yang
          membandingkan angka ini dengan Laporan Penjualan akan menemukan
          selisih, dan ia harus tahu kenapa SEBELUM itu terjadi. */}
      <span className="t-caption">
        <strong>Nilai kotor bukan omzet.</strong> Ia nilai barang yang keluar — sebelum diskon,
        sebelum pajak, dan sebelum refund. Pesanan yang direfund tetap dihitung di sini karena
        barangnya sudah keluar; uangnya dikembalikan, barangnya belum tentu. Untuk angka uang,
        buka Laporan Penjualan.
      </span>
    </div>
  );
}
