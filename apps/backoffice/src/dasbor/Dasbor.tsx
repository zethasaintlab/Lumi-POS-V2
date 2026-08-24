import { useCallback, useEffect, useState } from 'react';
import { Badge, Card, EmptyState, Icon, StatCard, Table } from 'ds';
import { useSesi } from '../../../../packages/klien-api/src/sesi.tsx';
import { GalatHttp } from '../../../../packages/klien-api/src/http.ts';
import { Tombol } from '../Tombol.tsx';
import { rupiah } from '../../../../packages/domain/src/uang-tampilan.ts';
import type { Outlet } from '../laporan/RentangTanggal.tsx';
import {
  CATATAN_BATAS,
  JUDUL_PANEL,
  pesanPanel,
  terlihatTampil,
  tertinggalTampil,
  type HargaBasi,
  type KeadaanPanel,
} from './harga-basi.ts';
import {
  LABEL_RENTANG,
  kalimatPerangkat,
  lencanaStok,
  nadaPerangkat,
  periodeKosong,
  pesanKeadaan,
  rentangDari,
  rincian,
  ringkasKalimatStok,
  type Dasbor,
  type Keadaan,
  type PilihanRentang,
} from './b01.ts';

/**
 * B-01 — Dasbor, dan halaman pertama yang merchant lihat.
 *
 * ## ⛔ Tidak ada satu angka pun yang dihitung di sini
 *
 * Seluruhnya datang dari `GET /reports/dashboard/summary`, yang menghitungnya
 * dengan fungsi yang SAMA dengan B-16, B-17, dan B-12. Dasbor yang menyebut
 * omzet berbeda dari Laporan Penjualan adalah bentuk terburuk perbedaan angka:
 * ia yang pertama dilihat setiap pagi, dan yang paling jarang diperiksa ulang.
 *
 * ## ⛔ Omzet BERSIH yang ditonjolkan, bukan kotor
 *
 * Angka besar di kartu pertama adalah omzet bersih — setelah pembatalan dan
 * refund. Kotor selalu lebih besar dan selalu lebih menyenangkan, dan dasbor
 * yang menonjolkannya memberi merchant kabar baik yang tidak sepenuhnya benar
 * setiap pagi. Kotor tetap ditampilkan, sebagai konteks di bawahnya.
 */

type Baris = Record<string, unknown>;
const ANGKA = { whiteSpace: 'nowrap' } as const;

/**
 * FR-A7 AC keempat — perangkat yang belum menerima perubahan harga terakhir.
 *
 * ⛔ Ia mengambil datanya SENDIRI, bukan ikut respons dasbor. RBAC-nya
 * `price_edit` (owner + manajer area) sementara dasbor dibaca peran yang lebih
 * luas; menggabungkannya berarti seluruh dasbor dijawab 403 untuk manajer
 * outlet, atau `price_edit` dilonggarkan demi satu panel.
 *
 * ⛔ 403 DIBEDAKAN dari gagal. "Anda tidak berhak melihat ini" dan "kami tidak
 * dapat memeriksanya" berarti hal yang sangat berbeda, dan yang kedua tidak
 * boleh terbaca seperti "semuanya baik-baik saja".
 */
function PanelHargaBasi({ outletId }: { outletId: string }) {
  const { api } = useSesi();
  const [keadaan, setKeadaan] = useState<KeadaanPanel>('memuat');
  const [hasil, setHasil] = useState<HargaBasi | null>(null);

  useEffect(() => {
    let hidup = true;
    setKeadaan('memuat');
    const q = outletId === '' ? '' : `?outlet_id=${encodeURIComponent(outletId)}`;
    void api
      .minta<HargaBasi>(`/reports/stale-price-devices${q}`)
      .then((h) => {
        if (!hidup) return;
        setHasil(h);
        setKeadaan(h.perangkat.length === 0 ? 'kosong' : 'siap');
      })
      .catch((e: unknown) => {
        if (!hidup) return;
        setKeadaan(e instanceof GalatHttp && e.status === 403 ? 'tidak-berhak' : 'gagal');
      });
    return () => {
      hidup = false;
    };
  }, [api, outletId]);

  const pesan = pesanPanel(keadaan, hasil?.jumlahDiperiksa ?? 0);
  const sekarang = new Date();

  return (
    <Card>
      <div className="card-pad">
        <div className="stack" style={{ gap: 'var(--space-3)' }}>
          <span className="t-body-md">{JUDUL_PANEL}</span>

          {pesan !== null ? (
            <span className="t-caption">{pesan}</span>
          ) : (
            <Table
              columns={[
                { key: 'perangkat', header: 'Perangkat' },
                { key: 'outlet', header: 'Outlet' },
                { key: 'terlihat', header: 'Terakhir terhubung' },
                { key: 'tertinggal', header: 'Tertinggal', align: 'right' },
              ]}
              rows={(hasil?.perangkat ?? []).map((p) => ({
                perangkat: p.kode,
                outlet: p.outletNama ?? '—',
                terlihat: terlihatTampil(p.lastSeenAt, sekarang),
                tertinggal: tertinggalTampil(p.perubahanTertinggal),
              }))}
            />
          )}

          {/* ⛔ Kalimat batas SELALU tampil, juga saat daftarnya kosong.
              "Belum menerima" dapat dibuktikan; "sudah menerima" tidak. */}
          <span className="t-caption">{CATATAN_BATAS}</span>
        </div>
      </div>
    </Card>
  );
}

export function DasborLayar({ onBuka }: { onBuka?: (layar: string) => void } = {}) {
  const { api } = useSesi();
  const [pilihan, setPilihan] = useState<PilihanRentang>('hari-ini');
  const [outlet, setOutlet] = useState<Outlet[]>([]);
  const [outletId, setOutletId] = useState('');
  const [outletSiap, setOutletSiap] = useState(false);
  const [putaran, setPutaran] = useState(0);
  const [keadaan, setKeadaan] = useState<Keadaan>({ jenis: 'memuat' });

  const muatOutlet = useCallback(async () => {
    try {
      const o = await api.minta<Outlet[]>('/outlets');
      setOutlet(o);
      // Outlet dipilih otomatis bila hanya ada satu — ringkasan stok hanya
      // dapat dibentuk untuk satu outlet, dan merchant satu-outlet tidak
      // perlu memilih apa pun untuk melihatnya.
      const hidup = o.filter((x) => x.archivedAt === null);
      if (hidup.length === 1) setOutletId((k) => (k === '' ? hidup[0].id : k));
    } catch {
      // Penyaring outlet hilang; ringkasan penjualan tetap dapat dimuat.
    } finally {
      // ⛔ Ditandai siap juga saat GAGAL. Kalau hanya jalur sukses yang
      // menandainya, kegagalan memuat daftar outlet menahan dasbor di
      // "memuat…" selamanya — layar kosong permanen karena penyaring yang
      // sebenarnya opsional.
      setOutletSiap(true);
      // ⛔ Dinaikkan di sini, BUKAN di `cobaLagi` setelah `await`. Ketiga
      // `setState` ini berada di kelanjutan sinkron yang sama, jadi React
      // menggabungkannya menjadi satu render — dan efek di bawah berjalan
      // sekali. Menaikkannya setelah `await` di pemanggil memisahkannya ke
      // tick lain, dan "Coba lagi" akan menembak server dua kali.
      setPutaran((n) => n + 1);
    }
  }, [api]);

  useEffect(() => {
    void muatOutlet();
  }, [muatOutlet]);

  const muat = useCallback(async () => {
    setKeadaan({ jenis: 'memuat' });
    try {
      const r = rentangDari(pilihan, new Date());
      const q = new URLSearchParams({ from: r.dari, to: r.sampai });
      if (outletId.length > 0) q.set('outlet_id', outletId);
      const dasbor = await api.minta<Dasbor>(`/reports/dashboard/summary?${q.toString()}`);
      setKeadaan({ jenis: 'siap', dasbor });
    } catch (err) {
      setKeadaan({
        jenis: 'galat',
        pesan:
          err instanceof GalatHttp
            ? err.message
            : 'Tidak dapat menghubungi server. Ringkasan ini butuh koneksi.',
      });
    }
  }, [api, pilihan, outletId]);

  // ⛔ Menunggu daftar outlet SEBELUM permintaan pertama.
  //
  // Tanpa penjagaan ini dasbor menembak server DUA kali setiap kali dibuka:
  // sekali tanpa `outlet_id` (daftar outlet belum tiba), lalu sekali lagi
  // setelah outlet tunggal terpilih sendiri. Terlihat di panel network, bukan
  // di test — keduanya menjawab 200 dan layarnya terlihat benar.
  //
  // Yang kedua lebih dari sekadar boros: permintaan pertama menjawab
  // `stok: null`, jadi kartu stok berkedip "Pilih satu outlet" di setiap
  // pembukaan — instruksi untuk sesuatu yang tidak perlu dilakukan siapa pun.
  useEffect(() => {
    if (!outletSiap) return;
    void muat();
    // `putaran` sengaja ada di daftar ini: ia yang membuat "Coba lagi"
    // memuat ulang ringkasan walau tidak ada satu pun nilai lain berubah.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muat, outletSiap, putaran]);

  const pesan = pesanKeadaan(keadaan);
  const d = keadaan.jenis === 'siap' ? keadaan.dasbor : null;
  const aktif = outlet.filter((o) => o.archivedAt === null);
  const lencana = lencanaStok(d === null ? null : d.stok);

  return (
    <div className="stack" style={{ gap: 'var(--space-4)', maxWidth: '104ch' }}>
      <div className="stack" style={{ gap: 'var(--space-1)' }}>
        <span className="t-title">Ringkasan</span>
        <span className="t-caption">
          Angka di sini dihitung dengan cara yang sama persis dengan layar Laporan — kalau berbeda,
          salah satunya salah.
        </span>
      </div>

      <Card>
        <div className="card-pad">
          <div className="stack" style={{ gap: 'var(--space-3)' }}>
            <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              {(['hari-ini', 'minggu-ini', 'bulan-ini'] as PilihanRentang[]).map((p) => (
                <Tombol
                  key={p}
                  varian={pilihan === p ? 'primary' : 'secondary'}
                  onClick={() => setPilihan(p)}
                >
                  {LABEL_RENTANG[p]}
                </Tombol>
              ))}
            </div>

            {aktif.length > 1 ? (
              <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                <Tombol
                  varian={outletId === '' ? 'primary' : 'secondary'}
                  onClick={() => setOutletId('')}
                >
                  Semua outlet
                </Tombol>
                {aktif.map((o) => (
                  <Tombol
                    key={o.id}
                    varian={outletId === o.id ? 'primary' : 'secondary'}
                    onClick={() => setOutletId(o.id)}
                  >
                    {o.name}
                  </Tombol>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </Card>

      {pesan !== null ? (
        <Card>
          <div className="card-pad">
            <EmptyState
              icon={<Icon name={keadaan.jenis === 'galat' ? 'alert' : 'dashboard'} size={32} />}
              title={pesan.judul}
              body={pesan.badan}
              action={
                keadaan.jenis === 'galat' ? (
                  // ⛔ Yang dipanggil `muatOutlet`, BUKAN `muat`.
                  //
                  // Kegagalan yang menjatuhkan ringkasan menjatuhkan
                  // `/outlets` juga — server mati adalah persis keadaan yang
                  // membuat merchant menekan tombol ini. Mengulang ringkasan
                  // saja membuat outlet tidak pernah terpilih, jadi kartu stok
                  // tetap berbunyi "Pilih satu outlet" walau seluruh angka
                  // lain sudah kembali, dan merchant satu-outlet tidak punya
                  // tombol outlet untuk menebusnya. `muatOutlet` menaikkan
                  // `putaran`, dan itu yang menarik ringkasan ikut.
                  <Tombol onClick={() => void muatOutlet()}>Coba lagi</Tombol>
                ) : undefined
              }
            />
          </div>
        </Card>
      ) : d !== null ? (
        <>
          <div className="row" style={{ gap: 'var(--space-4)', flexWrap: 'wrap' }}>
            {/* ⛔ BERSIH yang ditonjolkan. Kotor selalu lebih besar dan selalu
                lebih menyenangkan — dasbor yang menonjolkannya memberi kabar
                baik yang tidak sepenuhnya benar setiap pagi. */}
            <StatCard label="Omzet bersih" value={rupiah(d.penjualan.omzetBersih)} />
            <StatCard label="Transaksi" value={String(d.penjualan.jumlahTransaksi)} />
            <StatCard
              label="Rata-rata per transaksi"
              value={rupiah(d.penjualan.rataRataPerTransaksi)}
            />
          </div>

          <Card>
            <div className="card-pad">
              <div className="stack" style={{ gap: 'var(--space-1)' }}>
                {rincian(d).map((b) => (
                  <div className="row between" key={b.judul}>
                    <span className="t-caption">{b.judul}</span>
                    <span className="t-caption num" style={ANGKA}>
                      {b.pengurang ? '− ' : ''}
                      {rupiah(b.nilai)}
                    </span>
                  </div>
                ))}
                <span className="t-caption">
                  Omzet bersih = kotor − dibatalkan − refund. Pajak sudah termasuk di dalam angka
                  yang pelanggan bayar.
                </span>
              </div>
            </div>
          </Card>

          {/* --- FR-H8 sisi owner: perangkat yang berhenti menyapa ---

               ⛔ Kartunya HANYA muncul bila ada yang perlu ditindaklanjuti.
               Kartu yang selalu ada dengan tulisan "semua sehat" berhenti
               dibaca, dan ketika ia akhirnya berubah tidak ada yang
               memperhatikan.

               Ditempatkan DI ATAS stok karena akibatnya lebih besar: stok
               yang salah membuat satu keputusan pembelian meleset, sementara
               perangkat yang belum terhubung berarti PENJUALANNYA belum
               masuk angka mana pun di layar ini — termasuk angka besar di
               atas. */}
          {kalimatPerangkat(d.perangkat) !== null ? (
            <Card>
              <div className="card-pad">
                <div className="stack" style={{ gap: 'var(--space-3)' }}>
                  <div className="row between">
                    <span className="t-body-md">Perangkat belum terhubung</span>
                    <Badge tone={nadaPerangkat(d.perangkat)}>
                      {d.perangkat.menua.length} perangkat
                    </Badge>
                  </div>
                  <span className="t-caption">{kalimatPerangkat(d.perangkat)}</span>
                </div>
              </div>
            </Card>
          ) : null}

          {/* --- stok yang perlu perhatian --- */}
          <Card>
            <div className="card-pad">
              <div className="stack" style={{ gap: 'var(--space-3)' }}>
                <div className="row between">
                  <span className="t-body-md">Stok perlu perhatian</span>
                  {/* ⛔ Nada DAN teks datang dari `lencanaStok`, bukan
                      diturunkan di sini dari angka. Tanpa outlet, jawabannya
                      bukan "Aman" melainkan "Belum diperiksa" — lihat
                      alasannya di `b01.ts`. */}
                  <Badge tone={lencana.nada}>{lencana.teks}</Badge>
                </div>
                <span className="t-caption">{ringkasKalimatStok(d.stok)}</span>

                {d.stok !== null && d.stok.contoh.length > 0 ? (
                  <div className="stack" style={{ gap: 'var(--space-1)' }}>
                    {d.stok.contoh.map((c) => (
                      <div className="row between" key={c.variationId}>
                        <span className="t-caption">
                          {c.itemName} — {c.variationName}
                        </span>
                        <span className="t-caption num" style={ANGKA}>
                          {c.saldo}
                        </span>
                      </div>
                    ))}
                    {onBuka !== undefined ? (
                      <div className="row">
                        <Tombol varian="ghost" onClick={() => onBuka('B-12')}>
                          Buka Daftar Stok
                        </Tombol>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </Card>

          {/* --- FR-A7 — perangkat berharga basi ---

              ⛔ Panelnya SELALU dirender, juga saat daftarnya kosong dan juga
              saat pemakainya tidak berhak. Panel yang hilang tidak dapat
              dibedakan dari panel yang berkata "semua mutakhir", dan yang
              kedua adalah kesimpulan yang datanya tidak dukung. */}
          <PanelHargaBasi outletId={outletId} />

          {/* --- produk terlaris --- */}
          <Card>
            <div className="card-pad">
              <div className="stack" style={{ gap: 'var(--space-3)' }}>
                <span className="t-body-md">Produk terlaris</span>

                {d.terlaris.length === 0 ? (
                  <EmptyState
                    icon={<Icon name="package" size={32} />}
                    title={periodeKosong(d) ? 'Belum ada penjualan' : 'Belum ada barang terjual'}
                    body={
                      periodeKosong(d)
                        ? 'Belum ada transaksi pada periode ini. Angka di sini akan terisi sendiri begitu kasir mulai menjual dan perangkatnya tersinkronisasi.'
                        : 'Ada transaksi pada periode ini, tetapi belum ada baris barang yang tercatat.'
                    }
                  />
                ) : (
                  <Table
                    columns={[
                      { key: 'produk', header: 'Produk' },
                      { key: 'terjual', header: 'Terjual', align: 'right' },
                      { key: 'nilai', header: 'Nilai', align: 'right' },
                    ]}
                    rows={d.terlaris.map<Baris>((p) => ({
                      produk: (
                        <span className="stack" style={{ gap: 0 }}>
                          <span>{p.itemName}</span>
                          <span className="t-caption">{p.variationName}</span>
                        </span>
                      ),
                      terjual: (
                        <span className="num" style={ANGKA}>
                          {p.kuantitasTampil}×
                        </span>
                      ),
                      nilai: (
                        <span className="num" style={ANGKA}>
                          {rupiah(p.nilaiKotor)}
                        </span>
                      ),
                    }))}
                  />
                )}

                {/* ⛔ Kalimat ini diperbaiki setelah datanya dilihat, bukan
                    setelah kodenya dibaca. Versi pertama berbunyi "sebelum
                    pembatalan dan refund" — dan itu salah pada separuhnya:
                    `ambilProduk` MENGELUARKAN pesanan yang dibatalkan dan
                    MEMPERTAHANKAN yang direfund. Terlihat di E2E, saat Roti
                    Bakar yang dijual 5 + dibatalkan 2 muncul sebagai 5. */}
                {/* Hanya saat ada barisnya. Penjelasan basis di bawah daftar
                    KOSONG menerangkan angka yang tidak ada. */}
                {d.terlaris.length > 0 ? (
                  <span className="t-caption">
                    Jumlah barang yang keluar, bukan uang yang tinggal. Pesanan yang dibatalkan
                    tidak dihitung; yang direfund tetap dihitung — refund uang tidak selalu
                    mengembalikan barangnya.
                  </span>
                ) : null}
              </div>
            </div>
          </Card>
        </>
      ) : null}

      <span className="t-caption">
        Periode memakai <strong>tanggal bisnis</strong>: hari berakhir saat tutup shift, bukan
        tengah malam. Perangkat kasir yang belum tersinkronisasi belum terhitung di sini.
      </span>
    </div>
  );
}
