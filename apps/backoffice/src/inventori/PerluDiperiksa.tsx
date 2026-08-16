import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Card, EmptyState, Icon, Table } from 'ds';
import { useSesi } from '../sesi.tsx';
import { GalatHttp } from '../http.ts';
import { Tombol } from '../Tombol.tsx';
import { rupiah } from '../katalog/produk.ts';
import { RentangTanggal, hariIni, type Outlet } from '../laporan/RentangTanggal.tsx';
import { rentangSiap, type Rentang } from '../laporan/b16.ts';
import { waktuTampil, zonaPerangkat } from '../pengawasan/b21.ts';
import { kuantitasTampil } from './b12.ts';
import {
  arahSelisih,
  besaranSelisih,
  labelAlasanSelisih,
  LABEL_SELISIH,
  nadaSelisih,
} from '../penjualan/b04.ts';

/**
 * B-15 — Perlu Diperiksa (`IA:§3.3`, grup INVENTORI).
 *
 * ## ⛔ Dua hal, karena IA menyebut dua hal
 *
 * Judulnya di IA berbunyi *"Perlu Diperiksa (oversell + selisih)"*. Membangun
 * setengahnya menghasilkan layar yang namanya menjanjikan lebih daripada
 * isinya — dan yang tidak dibangun adalah separuh yang menyangkut uang.
 *
 * ## ⛔ Oversell BUKAN kesalahan, dan layar ini tidak menyebutnya begitu
 *
 * PRD menyebut pencegahan oversell saat offline sebagai **non-goal permanen**:
 * konsekuensi teorema CAP, bukan bug. Dua perangkat yang menjual barang
 * terakhir saat offline sama-sama benar, dan keduanya harus berhasil.
 *
 * Yang sistem lakukan adalah membuat konsekuensinya terlihat. Kata "pelaku"
 * karena itu tidak muncul di mana pun di layar ini — yang ditampilkan
 * perangkat yang **terlibat**, dan ada test yang memindainya.
 */

type Baris = Record<string, unknown>;
const ANGKA = { whiteSpace: 'nowrap' } as const;

interface BarisOversell {
  id: string;
  outletId: string;
  variationId: string;
  itemName: string;
  variationName: string;
  detectedAt: string;
  quantityOver: string;
  devicesInvolved: string[];
  ordersInvolved: string[];
  resolvedBy: string | null;
  resolvedByNama: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

interface BarisSelisih {
  shiftId: string;
  outletId: string;
  businessDate: string;
  openedByNama: string;
  closedByNama: string | null;
  approvedByNama: string | null;
  closedAt: string | null;
  difference: string;
  varianceReasonCode: string | null;
  varianceNote: string | null;
}

interface Hasil {
  from: string;
  to: string;
  outletId: string | null;
  oversell: BarisOversell[];
  selisihKas: BarisSelisih[];
}

type Keadaan =
  | { jenis: 'memuat' }
  | { jenis: 'siap'; hasil: Hasil }
  | { jenis: 'galat'; pesan: string };

export function PerluDiperiksaLayar() {
  const { api } = useSesi();
  const [rentang, setRentang] = useState<Rentang>(() => ({ dari: hariIni(), sampai: hariIni() }));
  const [outlet, setOutlet] = useState<Outlet[]>([]);
  const [outletId, setOutletId] = useState('');
  const [sertakanSelesai, setSertakanSelesai] = useState(false);
  const [keadaan, setKeadaan] = useState<Keadaan>({ jenis: 'memuat' });
  const [zona] = useState(() => zonaPerangkat());

  useEffect(() => {
    let batal = false;
    void (async () => {
      try {
        const o = await api.minta<Outlet[]>('/outlets');
        if (!batal) setOutlet(o);
      } catch {
        // Penyaring outlet hilang; seluruh tenant tetap terbuka.
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
      const q = new URLSearchParams({ from: rentang.dari, to: rentang.sampai });
      if (outletId.length > 0) q.set('outlet_id', outletId);
      if (sertakanSelesai) q.set('include_resolved', 'true');
      const hasil = await api.minta<Hasil>(`/reports/inventory/oversells?${q.toString()}`);
      setKeadaan({ jenis: 'siap', hasil });
    } catch (err) {
      setKeadaan({
        jenis: 'galat',
        pesan:
          err instanceof GalatHttp
            ? err.message
            : 'Tidak dapat menghubungi server. Layar ini butuh koneksi.',
      });
    }
  }, [api, rentang, outletId, sertakanSelesai]);

  useEffect(() => {
    void muat();
  }, [muat]);

  const hasil = keadaan.jenis === 'siap' ? keadaan.hasil : null;
  const jumlah = useMemo(
    () => (hasil === null ? 0 : hasil.oversell.length + hasil.selisihKas.length),
    [hasil]
  );

  const namaOutlet = (id: string) => outlet.find((o) => o.id === id)?.name ?? id;

  return (
    <div className="stack" style={{ gap: 'var(--space-4)', maxWidth: '104ch' }}>
      <div className="stack" style={{ gap: 'var(--space-1)' }}>
        <span className="t-title">Perlu Diperiksa</span>
        <span className="t-caption">
          Kejadian yang menuntut keputusan manusia: stok terjual melebihi catatan, dan selisih kas
          saat tutup shift.
        </span>
      </div>

      <Card>
        <div className="card-pad">
          <div className="stack" style={{ gap: 'var(--space-4)' }}>
            <RentangTanggal
              rentang={rentang}
              onRentang={setRentang}
              outlet={outlet}
              outletId={outletId}
              onOutlet={setOutletId}
              sedangMuat={keadaan.jenis === 'memuat'}
              onTampilkan={() => void muat()}
              catatan="Oversell dihitung menurut waktu sistem menyadarinya, bukan tanggal penjualannya."
            />
            <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'center' }}>
              <Tombol
                varian={sertakanSelesai ? 'primary' : 'secondary'}
                onClick={() => setSertakanSelesai((v) => !v)}
              >
                {sertakanSelesai ? 'Sembunyikan yang selesai' : 'Tampilkan yang sudah ditindaklanjuti'}
              </Tombol>
              {hasil !== null ? (
                <span className="t-caption">
                  <span className="num">{jumlah}</span> hal perlu diperiksa
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </Card>

      {keadaan.jenis !== 'siap' ? (
        <Card>
          <div className="card-pad">
            <EmptyState
              icon={<Icon name={keadaan.jenis === 'galat' ? 'alert' : 'alert'} size={32} />}
              title={keadaan.jenis === 'galat' ? 'Tidak dapat dimuat' : 'Memuat…'}
              body={
                keadaan.jenis === 'galat'
                  ? keadaan.pesan
                  : 'Server sedang mengumpulkan kejadian pada rentang ini.'
              }
              action={
                keadaan.jenis === 'galat' ? (
                  <Tombol onClick={() => void muat()}>Coba lagi</Tombol>
                ) : undefined
              }
            />
          </div>
        </Card>
      ) : jumlah === 0 ? (
        <Card>
          <div className="card-pad">
            {/* ⛔ Kosong di sini adalah KABAR BAIK, dan kalimatnya harus
                mengatakannya. Empty state yang netral membuat merchant
                mengira layarnya belum bekerja. */}
            <EmptyState
              icon={<Icon name="shield" size={32} />}
              title="Tidak ada yang perlu diperiksa"
              body={`Tidak ada oversell maupun selisih kas ${hasil !== null && hasil.from === hasil.to ? `pada ${hasil.from}` : `antara ${hasil?.from} dan ${hasil?.to}`}. Perangkat yang belum tersinkronisasi belum terhitung di sini.`}
            />
          </div>
        </Card>
      ) : (
        <>
          {hasil !== null && hasil.oversell.length > 0 ? (
            <Card>
              <div className="card-pad">
                <div className="stack" style={{ gap: 'var(--space-4)' }}>
                  <div className="row between">
                    <span className="t-body-md">Stok terjual melebihi catatan</span>
                    <Badge tone="neutral">{hasil.oversell.length}</Badge>
                  </div>

                  <Table
                    columns={[
                      { key: 'waktu', header: 'Terdeteksi' },
                      { key: 'produk', header: 'Produk' },
                      { key: 'kelebihan', header: 'Kelebihan', align: 'right' },
                      { key: 'terlibat', header: 'Terlibat', align: 'right' },
                      { key: 'status', header: 'Status' },
                    ]}
                    rows={hasil.oversell.map<Baris>((o) => ({
                      waktu: (
                        <span className="num" style={ANGKA}>
                          {waktuTampil(o.detectedAt, zona)}
                        </span>
                      ),
                      produk: (
                        <span className="stack" style={{ gap: 0 }}>
                          <span>
                            {o.itemName} — {o.variationName}
                          </span>
                          {outlet.length > 1 ? (
                            <span className="t-caption">{namaOutlet(o.outletId)}</span>
                          ) : null}
                        </span>
                      ),
                      kelebihan: (
                        <span className="num" style={ANGKA}>
                          {kuantitasTampil(BigInt(o.quantityOver))}
                        </span>
                      ),
                      // ⛔ "Terlibat", bukan "pelaku". Lihat catatan kepala.
                      terlibat: (
                        <span className="t-caption num">
                          {o.devicesInvolved.length} perangkat · {o.ordersInvolved.length} transaksi
                        </span>
                      ),
                      status:
                        o.resolvedAt === null ? (
                          <Badge tone="warning">Belum ditindaklanjuti</Badge>
                        ) : (
                          <span className="stack" style={{ gap: 0 }}>
                            <Badge tone="success">Selesai</Badge>
                            <span className="t-caption">
                              {o.resolvedByNama}
                              {o.resolutionNote !== null ? ` — ${o.resolutionNote}` : ''}
                            </span>
                          </span>
                        ),
                    }))}
                  />

                  {/* ⛔ Dinyatakan di layar, bukan hanya di kode. Merchant yang
                      melihat daftar ini tanpa penjelasan akan mengira kasirnya
                      berbuat salah. */}
                  <span className="t-caption">
                    Ini <strong>bukan kesalahan kasir</strong>. Dua perangkat yang menjual barang
                    terakhir saat sama-sama offline keduanya benar — sistem sengaja menerima
                    keduanya agar penjualan tidak hilang, lalu menampilkannya di sini supaya stoknya
                    dapat dirapikan.
                  </span>
                </div>
              </div>
            </Card>
          ) : null}

          {hasil !== null && hasil.selisihKas.length > 0 ? (
            <Card>
              <div className="card-pad">
                <div className="stack" style={{ gap: 'var(--space-4)' }}>
                  <div className="row between">
                    <span className="t-body-md">Selisih kas saat tutup shift</span>
                    <Badge tone="neutral">{hasil.selisihKas.length}</Badge>
                  </div>

                  <Table
                    columns={[
                      { key: 'tanggal', header: 'Tanggal' },
                      { key: 'kasir', header: 'Kasir' },
                      { key: 'alasan', header: 'Alasan' },
                      { key: 'selisih', header: 'Selisih', align: 'right' },
                    ]}
                    rows={hasil.selisihKas.map<Baris>((s) => {
                      const arah = arahSelisih(s.difference);
                      return {
                        tanggal: (
                          <span className="num" style={ANGKA}>
                            {s.businessDate}
                          </span>
                        ),
                        kasir: (
                          <span className="stack" style={{ gap: 0 }}>
                            <span>{s.openedByNama}</span>
                            {s.approvedByNama !== null ? (
                              <span className="t-caption">disetujui {s.approvedByNama}</span>
                            ) : null}
                          </span>
                        ),
                        alasan: (
                          <span className="t-caption">
                            {labelAlasanSelisih(s.varianceReasonCode)}
                            {s.varianceNote !== null && s.varianceNote !== ''
                              ? ` — ${s.varianceNote}`
                              : ''}
                          </span>
                        ),
                        selisih: (
                          <span
                            className="row"
                            style={{ gap: 'var(--space-2)', justifyContent: 'flex-end' }}
                          >
                            <span className="num" style={ANGKA}>
                              {arah === 'kurang' ? '− ' : arah === 'lebih' ? '+ ' : ''}
                              {rupiah(besaranSelisih(s.difference))}
                            </span>
                            <Badge tone={nadaSelisih(arah)}>{LABEL_SELISIH[arah]}</Badge>
                          </span>
                        ),
                      };
                    })}
                  />
                </div>
              </div>
            </Card>
          ) : null}
        </>
      )}

      <span className="t-caption">
        Kelebihan stok ditampilkan dalam satuan barang. Untuk merapikannya, catat koreksi lewat{' '}
        <strong>Penyesuaian</strong> di layar Stok — riwayatnya tetap tersimpan, dan koreksi menjadi
        baris baru alih-alih menghapus kejadiannya.
      </span>
    </div>
  );
}
