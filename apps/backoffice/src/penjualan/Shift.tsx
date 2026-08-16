import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Card, EmptyState, Icon, Table } from 'ds';
import { useSesi } from '../sesi.tsx';
import { GalatHttp } from '../http.ts';
import { Tombol } from '../Tombol.tsx';
import { rupiah } from '../katalog/produk.ts';
import { RentangTanggal, hariIni, type Outlet } from '../laporan/RentangTanggal.tsx';
import { rentangSiap, type Rentang } from '../laporan/b16.ts';
import { waktuTampil, zonaPerangkat } from '../pengawasan/b21.ts';
import { ShiftDetailModal } from './ShiftDetail.tsx';
import {
  LABEL_SELISIH,
  arahSelisih,
  besaranSelisih,
  nadaSelisih,
  pesanKeadaan,
  ringkasShift,
  type BarisShift,
  type Keadaan,
} from './b04.ts';

/**
 * B-04 — Laporan Shift (`IA:§3.3`, grup PENJUALAN).
 *
 * ## ⛔ Layar ini tidak dapat ada sampai server dapat menutup shift
 *
 * Sampai `POST /shifts/{id}/close` dibangun, setiap shift di server berstatus
 * `open` selamanya dan seluruh kolom uangnya NULL — layar ini akan menampilkan
 * tabel berisi tanda pisah. Itu sebabnya B-04 diblokir dua penyelidikan yang
 * lalu, dan sebabnya ia dibangun bersama endpointnya.
 *
 * ## ⛔ Bawaan hanya shift TERTUTUP
 *
 * Shift berjalan belum punya hitungan fisik, dan menampilkannya bercampur
 * membuat kolom Selisih penuh tanda pisah yang terbaca seperti kerusakan.
 * Ia dapat dimunculkan, dan saat itu kekosongannya punya penjelasan sendiri.
 */

type Baris = Record<string, unknown>;
const ANGKA = { whiteSpace: 'nowrap' } as const;

export function ShiftLayar() {
  const { api } = useSesi();
  const [rentang, setRentang] = useState<Rentang>(() => ({ dari: hariIni(), sampai: hariIni() }));
  const [outlet, setOutlet] = useState<Outlet[]>([]);
  const [outletId, setOutletId] = useState('');
  const [sertakanTerbuka, setSertakanTerbuka] = useState(false);
  const [keadaan, setKeadaan] = useState<Keadaan>({ jenis: 'memuat' });
  const [detailId, setDetailId] = useState<string | null>(null);
  const [zona] = useState(() => zonaPerangkat());

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
      const q = new URLSearchParams({ from: rentang.dari, to: rentang.sampai });
      if (outletId.length > 0) q.set('outlet_id', outletId);
      if (sertakanTerbuka) q.set('include_open', 'true');
      const hasil = await api.minta<{ items: BarisShift[] }>(`/reports/shifts?${q.toString()}`);
      setKeadaan({ jenis: 'siap', items: hasil.items });
    } catch (err) {
      setKeadaan({
        jenis: 'galat',
        pesan:
          err instanceof GalatHttp
            ? err.message
            : 'Tidak dapat menghubungi server. Laporan shift butuh koneksi.',
      });
    }
  }, [api, rentang, outletId, sertakanTerbuka]);

  useEffect(() => {
    void muat();
  }, [muat]);

  const items = useMemo(
    () => (keadaan.jenis === 'siap' ? keadaan.items : []),
    [keadaan]
  );
  const ringkas = useMemo(() => ringkasShift(items), [items]);
  const pesan = pesanKeadaan(keadaan, sertakanTerbuka);

  const namaOutlet = (id: string) =>
    outlet.find((o) => o.id === id)?.name ?? id;

  return (
    <div className="stack" style={{ gap: 'var(--space-4)', maxWidth: '104ch' }}>
      <div className="stack" style={{ gap: 'var(--space-1)' }}>
        <span className="t-title">Laporan Shift</span>
        <span className="t-caption">
          Setiap shift yang ditutup, beserta selisih kasnya. Tekan tanggalnya untuk melihat
          rinciannya.
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
              catatan="Shift dikelompokkan menurut tanggal bisnisnya."
            />

            <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'center' }}>
              <Tombol
                varian={sertakanTerbuka ? 'primary' : 'secondary'}
                onClick={() => setSertakanTerbuka((v) => !v)}
              >
                {sertakanTerbuka ? 'Hanya yang ditutup' : 'Tampilkan shift berjalan'}
              </Tombol>
              {keadaan.jenis === 'siap' ? (
                <span className="t-caption">
                  <span className="num">{ringkas.jumlah}</span> shift
                  {ringkas.bermasalah > 0 ? (
                    <>
                      {' · '}
                      <span className="num">{ringkas.bermasalah}</span> berselisih
                    </>
                  ) : null}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <div className="card-pad">
          {pesan !== null ? (
            <EmptyState
              icon={<Icon name={keadaan.jenis === 'galat' ? 'alert' : 'clock'} size={32} />}
              title={pesan.judul}
              body={pesan.badan}
              action={
                keadaan.jenis === 'galat' ? (
                  <Tombol onClick={() => void muat()}>Coba lagi</Tombol>
                ) : undefined
              }
            />
          ) : (
            <Table
              columns={[
                { key: 'tanggal', header: 'Tanggal' },
                { key: 'kasir', header: 'Kasir' },
                { key: 'waktu', header: 'Buka — tutup' },
                { key: 'omzet', header: 'Diterima', align: 'right' },
                { key: 'selisih', header: 'Selisih kas', align: 'right' },
              ]}
              rows={items.map<Baris>((s) => {
                const arah = arahSelisih(s.difference);
                return {
                  // Tanggalnya yang dapat diklik — bukan seluruh baris.
                  // `Table` design system tidak punya `onRowClick`, dan
                  // `<tr onClick>` tidak dapat dicapai keyboard.
                  tanggal: (
                    <span style={ANGKA}>
                      <Tombol varian="ghost" onClick={() => setDetailId(s.id)}>
                        <span className="num">{s.businessDate}</span>
                      </Tombol>
                    </span>
                  ),
                  kasir: (
                    <span className="stack" style={{ gap: 0 }}>
                      <span>{s.openedByNama}</span>
                      {outlet.length > 1 ? (
                        <span className="t-caption">{namaOutlet(s.outletId)}</span>
                      ) : null}
                    </span>
                  ),
                  waktu: (
                    <span className="t-caption num" style={ANGKA}>
                      {waktuTampil(s.openedAt, zona)}
                      {s.closedAt !== null ? ` — ${waktuTampil(s.closedAt, zona)}` : ' — berjalan'}
                    </span>
                  ),
                  omzet: (
                    <span className="num" style={ANGKA}>
                      {rupiah(s.totalDiterima)}
                    </span>
                  ),
                  // ⛔ Angka DAN label. Selisih kas muncul di sebelah nama
                  // orang; warna sendirian tidak boleh menjadi tuduhannya.
                  selisih: (
                    <span
                      className="row"
                      style={{ gap: 'var(--space-2)', justifyContent: 'flex-end' }}
                    >
                      <span className="num" style={ANGKA}>
                        {arah === 'belum'
                          ? '—'
                          : `${arah === 'kurang' ? '− ' : arah === 'lebih' ? '+ ' : ''}${rupiah(besaranSelisih(s.difference))}`}
                      </span>
                      <Badge tone={nadaSelisih(arah)}>{LABEL_SELISIH[arah]}</Badge>
                    </span>
                  ),
                };
              })}
            />
          )}
        </div>
      </Card>

      <ShiftDetailModal shiftId={detailId} onTutup={() => setDetailId(null)} />

      <span className="t-caption">
        <strong>Kurang</strong> berarti uang di laci lebih sedikit daripada yang seharusnya;{' '}
        <strong>Lebih</strong> berarti ada uang yang belum dapat dijelaskan. Keduanya perlu
        ditindaklanjuti, dengan cara yang berbeda.
      </span>

      <span className="t-caption">
        Saldo seharusnya dihitung dari buku kas — modal awal ditambah seluruh pergerakan kas shift
        itu — dan dibekukan saat shift ditutup. Ia tidak berubah lagi meski transaksi menyusul dari
        perangkat yang terlambat tersinkronisasi.
      </span>
    </div>
  );
}
