import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Card, EmptyState, Icon, Table } from 'ds';
import { useSesi } from '../sesi.tsx';
import { GalatHttp } from '../http.ts';
import { Tombol } from '../Tombol.tsx';
import { Bidang } from '../Bidang.tsx';
import { rupiah } from '../katalog/produk.ts';
import { RentangTanggal, hariIni, type Outlet } from '../laporan/RentangTanggal.tsx';
import { rentangSiap, type Rentang } from '../laporan/b16.ts';
// Formatter waktu dipakai bersama B-21. Ia tinggal di sana karena di sanalah ia
// lahir; memindahkannya ke tempat netral adalah refactor tersendiri, bukan
// bagian dari layar ini.
import { waktuTampil, zonaPerangkat } from '../pengawasan/b21.ts';
import {
  JEDA_KETIK_MS,
  LABEL_STATUS,
  SEMUA_STATUS,
  TUMPUKAN_AWAL,
  alihkanStatus,
  aturUlang,
  buatDebounce,
  kursorSekarang,
  maju,
  mundur,
  nomorHalaman,
  pesanKeadaan,
  susunKueri,
  type Halaman,
  type Status,
  type Tumpukan,
} from './b02.ts';
import { DetailTransaksiModal } from './Detail.tsx';

/**
 * B-02 — Riwayat Penjualan (`IA:§3.3`, grup PENJUALAN).
 *
 * ## ⛔ Satu baris per TRANSAKSI, dan itu tidak gratis
 *
 * Tabel `order` tidak berisi satu baris per transaksi: penjualan yang
 * dibatalkan menghasilkan DUA baris, dan yang asli tetap berstatus `open`
 * selamanya (AC FR-B7 melarang `UPDATE` padanya). Server yang menyelesaikannya
 * — layar ini hanya menampilkan apa yang dikirimnya, dan **tidak boleh**
 * menyaring atau menghitung status sendiri.
 *
 * ## Detail transaksi (B-03)
 *
 * Nomor struk membuka `DetailTransaksiModal`, yang dilayani modul `reporting`
 * — satu-satunya modul yang boleh membaca lintas domain, karena satu struk
 * menggabungkan order + pembayaran + refund + nama orang.
 *
 * ⛔ Yang dapat diklik nomor struknya, BUKAN seluruh baris. `Table` design
 * system tidak punya `onRowClick`, dan `<tr onClick>` tidak dapat dicapai
 * keyboard — baris yang hanya dapat dibuka dengan tetikus mengunci fitur ini
 * dari siapa pun yang tidak memakainya.
 *
 * ## Paginasi
 *
 * Keyset, dan kursornya buram. Tumpukan kursor dipegang di `b02.ts` beserta
 * testnya — "Sebelumnya" yang mengulang halaman yang sedang dilihat adalah
 * kegagalan yang tidak menghasilkan error.
 */

type Baris = Record<string, unknown>;

/** Angka tidak pernah dipatahkan ke baris berikutnya — sama seperti B-21. */
const ANGKA = { whiteSpace: 'nowrap' } as const;

type Keadaan =
  | { jenis: 'memuat' }
  | { jenis: 'siap'; halaman: Halaman }
  | { jenis: 'galat'; pesan: string };

export function RiwayatLayar() {
  const { api } = useSesi();
  const [rentang, setRentang] = useState<Rentang>(() => ({ dari: hariIni(), sampai: hariIni() }));
  const [outlet, setOutlet] = useState<Outlet[]>([]);
  const [outletId, setOutletId] = useState('');
  const [status, setStatus] = useState<readonly Status[]>([]);
  const [cari, setCari] = useState('');
  const [tumpukan, setTumpukan] = useState<Tumpukan>(TUMPUKAN_AWAL);
  const [keadaan, setKeadaan] = useState<Keadaan>({ jenis: 'memuat' });
  const [zona] = useState(() => zonaPerangkat());
  const [namaUser, setNamaUser] = useState<Record<string, string>>({});
  // ⛔ Id, bukan objek transaksi: panel memuat detailnya sendiri dari
  // server. Menyalin baris daftar ke panel akan menampilkan angka yang
  // lebih sedikit — daftar tidak punya baris barang maupun pembayaran.
  const [detailId, setDetailId] = useState<string | null>(null);

  useEffect(() => {
    let batal = false;
    void (async () => {
      try {
        const o = await api.minta<Outlet[]>('/outlets');
        if (!batal) setOutlet(o);
      } catch {
        // Penyaring outlet hilang; riwayat seluruh tenant tetap terbuka.
      }
      try {
        // ⛔ Nama kasir diresolusi DI SINI, bukan di-JOIN server. `"user"`
        // milik modul identity, dan `ordering` tidak menjangkaunya
        // (invariant #4). Sama seperti nama outlet.
        const u = await api.minta<{ id: string; name: string }[]>('/users');
        if (!batal) setNamaUser(Object.fromEntries(u.map((x) => [x.id, x.name])));
      } catch {
        // Tanpa nama, kolomnya menampilkan id — bukan sel kosong.
      }
    })();
    return () => {
      batal = true;
    };
  }, [api]);

  const muat = useCallback(
    async (t: Tumpukan, cariSekarang: string) => {
      if (!rentangSiap(rentang)) return;
      setKeadaan({ jenis: 'memuat' });
      try {
        const q = susunKueri({
          rentang,
          outletId,
          status,
          cari: cariSekarang,
          cursor: kursorSekarang(t),
        });
        const halaman = await api.minta<Halaman>(`/orders?${q}`);
        setKeadaan({ jenis: 'siap', halaman });
      } catch (err) {
        setKeadaan({
          jenis: 'galat',
          pesan:
            err instanceof GalatHttp
              ? err.message
              : 'Tidak dapat menghubungi server. Riwayat ini butuh koneksi.',
        });
      }
    },
    [api, rentang, outletId, status]
  );

  // ⛔ Penyaring berubah → paginasi diatur ulang. Kursor milik penyaring lama
  // menunjuk posisi di urutan yang sudah berubah, dan halaman yang
  // dihasilkannya melewatkan transaksi tanpa satu pun error.
  const muatDariAwal = useCallback(
    (cariSekarang: string) => {
      const t = aturUlang(TUMPUKAN_AWAL);
      setTumpukan(t);
      void muat(t, cariSekarang);
    },
    [muat]
  );

  // Debounce hanya untuk kotak pencarian. Tombol dan penyaring lain bertindak
  // seketika — menundanya membuat aplikasi terasa tidak merespons.
  const cariRef = useRef(cari);
  cariRef.current = cari;
  const muatRef = useRef(muatDariAwal);
  muatRef.current = muatDariAwal;

  const tunda = useMemo(
    () =>
      buatDebounce(() => muatRef.current(cariRef.current), JEDA_KETIK_MS, {
        setTimer: (fn, ms) => window.setTimeout(fn, ms),
        clearTimer: (h) => window.clearTimeout(h as number),
      }),
    []
  );

  // ⛔ Dibatalkan saat layar dilepas. Permintaan yang berangkat setelah itu
  // men-set state pada komponen yang sudah tidak ada.
  useEffect(() => () => tunda.batal(), [tunda]);

  useEffect(() => {
    void muat(TUMPUKAN_AWAL, '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const halaman = keadaan.jenis === 'siap' ? keadaan.halaman : null;
  const pesan = pesanKeadaan(
    keadaan.jenis === 'siap' ? { jenis: 'siap', items: keadaan.halaman.items } : keadaan
  );

  const namaOutlet = (id: string | null) =>
    id === null || id === '' ? 'Semua outlet' : (outlet.find((o) => o.id === id)?.name ?? id);

  const nada = (s: Status) => (s === 'terjual' ? 'success' : 'warning');

  return (
    <div className="stack" style={{ gap: 'var(--space-4)', maxWidth: '104ch' }}>
      <div className="stack" style={{ gap: 'var(--space-1)' }}>
        <span className="t-title">Riwayat Penjualan</span>
        <span className="t-caption">
          Satu baris per transaksi. Cari nomor struk saat pelanggan datang membawa struknya.
        </span>
      </div>

      <Card>
        <div className="card-pad">
          <div className="stack" style={{ gap: 'var(--space-4)' }}>
            <RentangTanggal
              rentang={rentang}
              onRentang={(r) => setRentang(r)}
              outlet={outlet}
              outletId={outletId}
              onOutlet={(id) => setOutletId(id)}
              sedangMuat={keadaan.jenis === 'memuat'}
              onTampilkan={() => muatDariAwal(cari)}
              catatan="Pesanan yang belum dibayar tidak ditampilkan di sini."
            />

            <div className="stack" style={{ gap: 'var(--space-2)' }}>
              <span className="label">Status</span>
              <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                {SEMUA_STATUS.map((s) => (
                  <Tombol
                    key={s}
                    varian={status.includes(s) ? 'primary' : 'secondary'}
                    onClick={() => setStatus((kini) => alihkanStatus(kini, s))}
                  >
                    {LABEL_STATUS[s]}
                  </Tombol>
                ))}
              </div>
              <span className="t-caption">
                Tanpa pilihan berarti semua status ditampilkan. Pesanan yang belum dibayar tidak
                pernah muncul — ia belum menjadi transaksi.
              </span>
            </div>

            <div className="stack" style={{ gap: 'var(--space-2)', maxWidth: '32ch' }}>
              <Bidang
                id="cari-struk"
                label="Cari nomor struk"
                value={cari}
                onChange={(v) => {
                  setCari(v);
                  // Ditunda: setiap huruf yang dikirim adalah satu permintaan.
                  tunda();
                }}
              />
              <span className="t-caption">
                Cocok sebagian — mengetik <span className="num">0007</span> menemukan{' '}
                <span className="num">K1-20260810-0007</span>.
              </span>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <div className="card-pad">
          {pesan !== null ? (
            <EmptyState
              icon={<Icon name={keadaan.jenis === 'galat' ? 'alert' : 'receipt'} size={32} />}
              title={pesan.judul}
              body={pesan.badan}
              action={
                keadaan.jenis === 'galat' ? (
                  <Tombol onClick={() => muatDariAwal(cari)}>Coba lagi</Tombol>
                ) : undefined
              }
            />
          ) : halaman !== null ? (
            <div className="stack" style={{ gap: 'var(--space-4)' }}>
              <div className="row between">
                <span className="t-body-md">
                  {halaman.from === halaman.to ? halaman.from : `${halaman.from} – ${halaman.to}`}
                </span>
                <Badge tone="neutral">{namaOutlet(halaman.outletId)}</Badge>
              </div>

              <Table
                columns={[
                  { key: 'waktu', header: 'Waktu' },
                  { key: 'struk', header: 'Nomor struk' },
                  { key: 'kasir', header: 'Kasir' },
                  { key: 'status', header: 'Status' },
                  { key: 'total', header: 'Total', align: 'right' },
                ]}
                rows={halaman.items.map<Baris>((t) => ({
                  waktu: (
                    <span className="num" style={ANGKA}>
                      {waktuTampil(t.occurredAt, zona)}
                    </span>
                  ),
                  // ⛔ Yang dapat diklik adalah NOMOR STRUK, bukan seluruh
                  // baris `<tr>`. Dua alasan, keduanya bukan selera:
                  //
                  // 1. `Table` design system tidak punya `onRowClick`, dan
                  //    menambahkannya berarti menyunting `/ds-bundle` yang
                  //    `CLAUDE.md` nyatakan final.
                  // 2. `<tr onClick>` tidak dapat dicapai keyboard. Baris yang
                  //    hanya dapat dibuka dengan tetikus mengunci fitur ini
                  //    dari siapa pun yang tidak memakainya.
                  //
                  // Nomor struk juga kebetulan hal yang benar untuk diklik: ia
                  // yang dibaca merchant dari struk pelanggan.
                  struk: (
                    <span style={ANGKA}>
                      <Tombol varian="ghost" onClick={() => setDetailId(t.id)}>
                        <span className="num">{t.receiptNumber}</span>
                      </Tombol>
                    </span>
                  ),
                  // Nama diresolusi klien; id ditampilkan bila namanya belum ada.
                  kasir: namaUser[t.createdBy] ?? t.createdBy,
                  // Status membawa TEKS, tidak pernah warna saja (aturan DS #5).
                  status: (
                    <span className="stack" style={{ gap: 0 }}>
                      <Badge tone={nada(t.status)}>{LABEL_STATUS[t.status]}</Badge>
                      {t.status === 'direfund' && t.nilaiRefund !== '0' ? (
                        <span className="t-caption num">− {rupiah(t.nilaiRefund)}</span>
                      ) : null}
                    </span>
                  ),
                  total: (
                    <span className="num" style={ANGKA}>
                      {rupiah(t.total)}
                    </span>
                  ),
                }))}
              />

              {/* ⛔ Keyset: hanya maju-mundur, tanpa nomor halaman langsung.
                  Melompat ke halaman 7 menuntut OFFSET, dan OFFSET melewatkan
                  transaksi saat order dari perangkat offline menyisip. */}
              <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'center' }}>
                <Tombol
                  varian="secondary"
                  disabled={nomorHalaman(tumpukan) === 1 || keadaan.jenis === 'memuat'}
                  onClick={() => {
                    const t = mundur(tumpukan);
                    setTumpukan(t);
                    void muat(t, cari);
                  }}
                >
                  Sebelumnya
                </Tombol>
                <span className="t-caption num">Halaman {nomorHalaman(tumpukan)}</span>
                <Tombol
                  varian="secondary"
                  disabled={halaman.cursorBerikut === null || keadaan.jenis === 'memuat'}
                  onClick={() => {
                    if (halaman.cursorBerikut === null) return;
                    const t = maju(tumpukan, halaman.cursorBerikut);
                    setTumpukan(t);
                    void muat(t, cari);
                  }}
                >
                  Berikutnya
                </Tombol>
              </div>
            </div>
          ) : null}
        </div>
      </Card>

      <span className="t-caption">
        Tekan <strong>nomor struk</strong> untuk melihat rincian barang, pembayaran, dan refund
        transaksi itu.
      </span>

      <DetailTransaksiModal orderId={detailId} onTutup={() => setDetailId(null)} />

      <span className="t-caption">
        Jam ditampilkan menurut zona waktu perangkat Anda (<span className="num">{zona}</span>),
        bukan zona outlet. Penyaring tanggal tidak terpengaruh: ia memakai tanggal bisnis yang
        dihitung server dari zona outlet masing-masing.
      </span>
    </div>
  );
}
