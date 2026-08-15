import { useCallback, useEffect, useState } from 'react';
import { Badge, Card, EmptyState, Icon, Table } from 'ds';
import { useSesi } from '../sesi.tsx';
import { GalatHttp } from '../http.ts';
import { Tombol } from '../Tombol.tsx';
import { rupiah } from '../katalog/produk.ts';
import { RentangTanggal, hariIni, type Outlet } from '../laporan/RentangTanggal.tsx';
import { rentangSiap, type Rentang } from '../laporan/b16.ts';
import {
  JUDUL_LAYAR,
  bandingRata,
  labelAlasan,
  pesanKeadaan,
  rasioTampil,
  ringkasAlasan,
  waktuTampil,
  zonaPerangkat,
  type HasilLaporan,
  type Keadaan,
} from './b21.ts';

/**
 * B-21 — Riwayat Void & Refund (`IA:§3.3`, grup PENGAWASAN).
 *
 * ## ⛔ Pengawasan, bukan Laporan — dan itu bukan selera
 *
 * `IA:171`: laporan menjawab "apa yang terjadi", pengawasan menjawab "apa yang
 * tidak wajar". Digabung, layar ini tenggelam di antara laporan rutin — dan
 * sejak keputusan 1 Agustus 2026 menghapus PIN manajer dari void, ia satu-
 * satunya kontrol yang tersisa terhadap penyalahgunaannya.
 *
 * ## ⛔ Layar ini menjawab pertanyaan yang B-18 sengaja TIDAK jawab
 *
 * Laporan Kasir melekatkan nilai pembatalan pada kasir yang **penjualannya**
 * dibatalkan — itu yang membuat jumlah seluruh kasir sama dengan Laporan
 * Penjualan. Di sini yang dilacak **siapa yang menekan tombolnya**.
 *
 * Keduanya benar untuk pertanyaan berbeda, dan keduanya dinyatakan di layar
 * masing-masing. Manajer yang membandingkan dua angka yang memang berbeda
 * tanpa penjelasan akan menyimpulkan salah satunya rusak.
 *
 * ## ⛔ Tanpa bahasa menuduh, dan ada test yang memindainya
 *
 * Tidak ada skor, tidak ada label, tidak ada baris merah. Yang ditampilkan
 * angka dan perbandingannya terhadap rata-rata periode. Kesimpulannya milik
 * manusia yang membacanya — layar ini menyediakan bahan, bukan vonis.
 *
 * ## Akses
 *
 * Endpointnya menuntut operasi `report_exception`; kasir mendarat di 403.
 * Menyembunyikan menu adalah penjaga UX, batas sebenarnya ada di server.
 */

type Baris = Record<string, unknown>;

/**
 * ⛔ Angka tidak pernah dipatahkan ke baris berikutnya.
 *
 * `.table th` di design system sudah `nowrap`, `td` tidak — dan pada lebar
 * sempit `Rp 50.000` terbelah menjadi "Rp" di satu baris dan "50.000" di baris
 * berikutnya. Ditemukan di browser, bukan di test.
 *
 * Memotongnya (`.truncate`) bukan jalan keluar: itu justru cacat yang F4
 * catat — "Rp 25.0" adalah struk yang menyebut harga salah, dan laporan yang
 * menyebut nilai salah lebih buruk lagi karena ia dipakai menilai orang.
 */
const ANGKA = { whiteSpace: 'nowrap' } as const;

export function ExceptionLayar() {
  const { api } = useSesi();
  const [rentang, setRentang] = useState<Rentang>(() => ({ dari: hariIni(), sampai: hariIni() }));
  const [outlet, setOutlet] = useState<Outlet[]>([]);
  const [outletId, setOutletId] = useState('');
  const [keadaan, setKeadaan] = useState<Keadaan>({ jenis: 'awal' });
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
      const kueri = new URLSearchParams({ from: rentang.dari, to: rentang.sampai });
      if (outletId.length > 0) kueri.set('outlet_id', outletId);
      const hasil = await api.minta<HasilLaporan>(
        `/reports/exceptions/voids?${kueri.toString()}`
      );
      setKeadaan({ jenis: 'siap', hasil });
    } catch (err) {
      setKeadaan({
        jenis: 'galat',
        pesan:
          err instanceof GalatHttp
            ? err.message
            : 'Tidak dapat menghubungi server. Layar ini butuh koneksi — datanya dihitung server.',
      });
    }
  }, [api, rentang, outletId]);

  useEffect(() => {
    void muat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const namaOutlet = (id: string | null) =>
    id === null || id === '' ? 'Semua outlet' : (outlet.find((o) => o.id === id)?.name ?? id);

  const pesan = pesanKeadaan(keadaan, namaOutlet);
  const hasil = keadaan.jenis === 'siap' ? keadaan.hasil : null;

  return (
    <div className="stack" style={{ gap: 'var(--space-4)', maxWidth: '110ch' }}>
      <div className="stack" style={{ gap: 'var(--space-1)' }}>
        <span className="t-title">{JUDUL_LAYAR}</span>
        <span className="t-caption">
          Siapa yang membatalkan, apa alasannya, dan berapa nilainya — pada rentang tanggal bisnis.
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
            catatan="Pembatalan dihitung pada tanggal bisnis pesanan aslinya."
          />
        </div>
      </Card>

      {pesan !== null ? (
        <Card>
          <div className="card-pad">
            <EmptyState
              icon={<Icon name={keadaan.jenis === 'galat' ? 'alert' : 'shield'} size={32} />}
              title={pesan.judul}
              body={pesan.badan}
              action={
                keadaan.jenis === 'galat' ? (
                  <Tombol onClick={() => void muat()}>Coba lagi</Tombol>
                ) : undefined
              }
            />
          </div>
        </Card>
      ) : null}

      {hasil !== null && pesan === null ? (
        <>
          <Card>
            <div className="card-pad">
              <div className="stack" style={{ gap: 'var(--space-4)' }}>
                <div className="row between">
                  <span className="t-body-md">Ringkasan per pelaku</span>
                  <Badge tone="neutral">{namaOutlet(hasil.outletId)}</Badge>
                </div>

                <Table
                  columns={[
                    { key: 'nama', header: 'Pelaku' },
                    { key: 'void', header: 'Void', align: 'right' },
                    { key: 'nilaiVoid', header: 'Nilai void', align: 'right' },
                    { key: 'refund', header: 'Refund', align: 'right' },
                    { key: 'nilaiRefund', header: 'Nilai refund', align: 'right' },
                    { key: 'rasio', header: 'Terhadap rata-rata', align: 'right' },
                    { key: 'alasan', header: 'Alasan' },
                  ]}
                  rows={hasil.perAktor.map<Baris>((a) => ({
                    nama: a.name,
                    void: <span className="num">{a.jumlahVoid}</span>,
                    nilaiVoid: <span className="num" style={ANGKA}>{rupiah(a.nilaiVoid)}</span>,
                    refund: <span className="num">{a.jumlahRefund}</span>,
                    nilaiRefund: <span className="num" style={ANGKA}>{rupiah(a.nilaiRefund)}</span>,
                    // ⛔ Angka DAN kalimatnya. Aturan design system #5 melarang
                    // status berupa warna saja; di layar yang menamai orang,
                    // angka telanjang punya masalah yang sama — `2,4×` tanpa
                    // penyebut tidak memberi tahu 2,4 kali apa.
                    rasio: (
                      <span className="stack" style={{ gap: 0, alignItems: 'flex-end' }}>
                        <span className="num" style={ANGKA}>{rasioTampil(a.rasio)}</span>
                        <span className="t-caption">{bandingRata(a.rasio)}</span>
                      </span>
                    ),
                    alasan: <span className="t-caption">{ringkasAlasan(a.alasan)}</span>,
                  }))}
                />
              </div>
            </div>
          </Card>

          <Card>
            <div className="card-pad">
              <div className="stack" style={{ gap: 'var(--space-4)' }}>
                <span className="t-body-md">Daftar peristiwa</span>

                <Table
                  columns={[
                    { key: 'waktu', header: 'Waktu' },
                    { key: 'pelaku', header: 'Pelaku' },
                    { key: 'jenis', header: 'Jenis' },
                    { key: 'struk', header: 'Struk' },
                    { key: 'nilai', header: 'Nilai', align: 'right' },
                    { key: 'alasan', header: 'Alasan' },
                    { key: 'penyetuju', header: 'Penyetuju' },
                  ]}
                  rows={hasil.peristiwa.map<Baris>((p) => ({
                    waktu: <span className="num" style={ANGKA}>{waktuTampil(p.occurredAt, zona)}</span>,
                    pelaku: p.aktorNama,
                    // ⛔ Jenis dibedakan lewat TEKS, bukan warna baris.
                    jenis: <Badge tone="neutral">{p.jenis === 'void' ? 'Void' : 'Refund'}</Badge>,
                    struk: <span className="num" style={ANGKA}>{p.receiptNumber}</span>,
                    nilai: <span className="num" style={ANGKA}>{rupiah(p.nilai)}</span>,
                    alasan: (
                      <span className="stack" style={{ gap: 0 }}>
                        <span>{labelAlasan(p.reasonCode)}</span>
                        {p.reasonNote !== null && p.reasonNote !== '' ? (
                          <span className="t-caption">{p.reasonNote}</span>
                        ) : null}
                      </span>
                    ),
                    // Void berjalan tanpa penyetuju sejak keputusan 1 Agustus
                    // 2026; refund selalu menuntutnya. Sel kosong di sini
                    // bermakna, jadi ia diberi tanda alih-alih dibiarkan hampa.
                    penyetuju: p.penyetujuNama ?? <span className="t-caption">—</span>,
                  }))}
                />
              </div>
            </div>
          </Card>
        </>
      ) : null}

      <span className="t-caption">
        Kolom <strong>Pelaku</strong> menunjuk orang yang menekan tombol pembatalan. Itu berbeda
        dari kolom Dibatalkan di Laporan Kasir, yang melekat pada kasir yang{' '}
        <strong>penjualannya</strong> dibatalkan supaya jumlah seluruh kasir cocok dengan Laporan
        Penjualan. Keduanya benar untuk pertanyaan yang berbeda.
      </span>

      <span className="t-caption">
        Angka <strong>Terhadap rata-rata</strong> membandingkan jumlah pembatalan orang ini dengan
        rata-rata seluruh pelaku pada rentang yang sama — bukan dengan ambang tetap. Rata-rata
        bergerak mengikuti periode, jadi angkanya tidak dapat dibandingkan antar rentang. Nilai
        uang diambil dari total pesanan aslinya.
      </span>

      <span className="t-caption">
        Jam ditampilkan menurut zona waktu perangkat Anda (<span className="num">{zona}</span>),
        bukan zona outlet — outlet di zona berbeda akan tampil bergeser. Penyaring tanggal tidak
        terpengaruh: ia memakai tanggal bisnis yang dihitung server dari zona outlet
        masing-masing.
      </span>
    </div>
  );
}
