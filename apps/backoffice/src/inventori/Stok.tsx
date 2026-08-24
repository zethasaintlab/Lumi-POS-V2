import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Card, EmptyState, Icon, Table } from 'ds';
import { useSesi } from '../../../../packages/klien-api/src/sesi.tsx';
import { GalatHttp } from '../../../../packages/klien-api/src/http.ts';
import { Tombol } from '../Tombol.tsx';
import { Bidang } from '../Bidang.tsx';
import type { Outlet } from '../laporan/RentangTanggal.tsx';
import { SesuaikanModal } from './Sesuaikan.tsx';
import {
  AMBANG_MENIPIS_BAWAAN,
  LABEL_TINGKAT,
  labelStok,
  nadaStok,
  nadaTingkat,
  pesanKeadaan,
  ringkasStok,
  saringMenipis,
  saringStok,
  tingkatStok,
  type BarisStok,
  type Keadaan,
} from './b12.ts';

/**
 * B-12 — Daftar Stok (`IA:§3.3`, grup INVENTORI).
 *
 * ## ⛔ Saldo dihitung server, tidak pernah di sini
 *
 * `SUM(delta)` atas ledger `stock_movement`. Layar ini menampilkan apa yang
 * dikirim server dan **tidak menjumlahkan apa pun sendiri** — tempat kedua
 * yang menghitung stok adalah tempat kedua yang dapat menyimpang.
 *
 * ## ⛔ Saldo negatif ditampilkan apa adanya
 *
 * Tanpa clamp, tanpa disembunyikan. Stok negatif berarti barang terjual
 * melebihi yang tercatat masuk — dan sampai B-13 dipakai mencatat stok awal,
 * **itu keadaan normal** untuk merchant baru. Layar menyebutkannya alih-alih
 * membiarkan angka merah terlihat seperti kerusakan.
 *
 * ## Penyaringan di klien
 *
 * Endpointnya tidak berpaginasi. Pada skala kafe itu benar dan terasa
 * seketika; batasnya dicatat di `b12.ts`.
 */

type Baris = Record<string, unknown>;

const ANGKA = { whiteSpace: 'nowrap' } as const;

interface Varian {
  id: string;
  itemName: string;
  variationName: string;
  trackStock: boolean;
}

/**
 * ⛔ `bukaPanelAwal` ada karena B-13 TIDAK punya layar sendiri.
 *
 * `IA:§3.3` mendaftarkan B-13 (Penyesuaian) sebagai menu tersendiri, tapi
 * penyesuaian stok hanya masuk akal di atas daftar stok — merchant memilih
 * varian dari baris yang sedang ia lihat. Menu itu karena itu membuka layar
 * ini dengan panelnya sudah terbuka, bukan halaman kosong yang menduplikasi
 * daftar yang sama.
 *
 * Alternatifnya membiarkan menu B-13 menampilkan "belum dibangun" untuk
 * sesuatu yang sudah ada — dan itu berbohong ke arah yang berlawanan.
 */
export function StokLayar({ bukaPanelAwal = false }: { bukaPanelAwal?: boolean } = {}) {
  const { api } = useSesi();
  const [outlet, setOutlet] = useState<Outlet[]>([]);
  const [outletId, setOutletId] = useState('');
  const [cari, setCari] = useState('');
  const [tampilArsip, setTampilArsip] = useState(false);
  // ⛔ Mode "perlu diisi" adalah PENYARING TAMPILAN, bukan data. Tidak ada
  // kolom minimum di skema mana pun, dan ambang yang benar berbeda per barang
  // — lima kilogram biji kopi dan lima cangkir bukan angka yang sebanding.
  const [modeMenipis, setModeMenipis] = useState(false);
  const [ambang, setAmbang] = useState(String(AMBANG_MENIPIS_BAWAAN));
  const [keadaan, setKeadaan] = useState<Keadaan>({ jenis: 'memuat' });
  const [panelTerbuka, setPanelTerbuka] = useState(bukaPanelAwal);
  const [varianAwal, setVarianAwal] = useState<string | null>(null);

  useEffect(() => {
    let batal = false;
    void (async () => {
      try {
        const o = await api.minta<Outlet[]>('/outlets');
        if (batal) return;
        setOutlet(o);
        // ⛔ Outlet dipilih OTOMATIS bila hanya ada satu. Saldo stok bersifat
        // per outlet, dan `include_zero` menuntut satu outlet yang jelas —
        // layar yang menunggu pilihan pada merchant satu-outlet hanya
        // menampilkan kekosongan yang tidak ia mengerti.
        const aktif = o.filter((x) => x.archivedAt === null);
        if (aktif.length > 0) setOutletId((kini) => (kini === '' ? aktif[0].id : kini));
      } catch {
        setKeadaan({
          jenis: 'galat',
          pesan: 'Daftar outlet tidak dapat dimuat, jadi stok belum dapat ditampilkan.',
        });
      }
    })();
    return () => {
      batal = true;
    };
  }, [api]);

  const muat = useCallback(async () => {
    if (outletId === '') return;
    setKeadaan({ jenis: 'memuat' });
    try {
      // ⛔ `include_zero=true`: varian yang belum punya satu pun pergerakan
      // justru yang paling perlu terlihat — barang baru yang stok awalnya
      // belum dimasukkan. Nol yang hilang dari daftar terbaca sebagai
      // "tidak ada masalah".
      const hasil = await api.minta<{ items: BarisStok[] }>(
        `/reports/inventory/stocks?outlet_id=${encodeURIComponent(outletId)}&include_zero=true`
      );
      setKeadaan({ jenis: 'siap', items: hasil.items });
    } catch (err) {
      setKeadaan({
        jenis: 'galat',
        pesan:
          err instanceof GalatHttp
            ? err.message
            : 'Tidak dapat menghubungi server. Daftar stok butuh koneksi.',
      });
    }
  }, [api, outletId]);

  useEffect(() => {
    void muat();
  }, [muat]);

  // ⛔ Di-memo. Versi pertama menulisnya sebagai ekspresi inline, dan larik
  // `[]` yang lahir setiap render membuat `useMemo` di bawahnya tidak pernah
  // menahan apa pun — penyaringan dan pemetaan varian dijalankan ulang pada
  // setiap ketikan di kotak pencarian. `lint:ds` menolaknya, dan benar.
  const semua = useMemo(
    () => (keadaan.jenis === 'siap' ? keadaan.items : []),
    [keadaan]
  );
  const ambangUtuh = Number.parseInt(ambang, 10);
  // Ambang cacat diperlakukan sebagai 0 — menyaring "habis dan minus" saja,
  // bukan menyaring segalanya atau tidak menyaring apa pun.
  const ambangSah = Number.isFinite(ambangUtuh) && ambangUtuh >= 0 ? ambangUtuh : 0;

  const terlihat = useMemo(() => {
    const dasar = saringStok(semua, { cari, tampilArsip });
    return modeMenipis ? saringMenipis(dasar, ambangSah) : dasar;
  }, [semua, cari, tampilArsip, modeMenipis, ambangSah]);
  const ringkas = useMemo(() => ringkasStok(terlihat), [terlihat]);
  const pesan = pesanKeadaan(
    keadaan.jenis === 'siap' ? { jenis: 'siap', items: terlihat } : keadaan,
    cari
  );

  // Pilihan varian untuk B-13 datang dari daftar stok yang SUDAH dimuat —
  // satu sumber, dan ia sudah memuat seluruh katalog outlet ini.
  const varian: Varian[] = useMemo(
    () =>
      semua
        .filter((b) => !b.archived)
        .map((b) => ({
          id: b.variationId,
          itemName: b.itemName,
          variationName: b.variationName,
          trackStock: b.trackStock,
        })),
    [semua]
  );

  const aktif = outlet.filter((o) => o.archivedAt === null);
  const namaOutlet = aktif.find((o) => o.id === outletId)?.name ?? outletId;

  const bukaPanel = (variationId: string | null) => {
    setVarianAwal(variationId);
    setPanelTerbuka(true);
  };

  return (
    <div className="stack" style={{ gap: 'var(--space-4)', maxWidth: '104ch' }}>
      <div className="stack" style={{ gap: 'var(--space-1)' }}>
        <span className="t-title">Daftar Stok</span>
        <span className="t-caption">
          Saldo dihitung dari seluruh pergerakan stok — penjualan, pembatalan, barang masuk, dan
          koreksi.
        </span>
      </div>

      <Card>
        <div className="card-pad">
          <div className="stack" style={{ gap: 'var(--space-4)' }}>
            {aktif.length > 1 ? (
              <div className="stack" style={{ gap: 'var(--space-2)' }}>
                <span className="label">Outlet</span>
                <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
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
                {/* ⛔ Dinyatakan: stok TIDAK dijumlahkan lintas outlet. Satu
                    angka gabungan tidak dapat dipakai memutuskan pembelian
                    untuk satu cabang. */}
                <span className="t-caption">
                  Stok dihitung per outlet dan tidak dijumlahkan lintas outlet.
                </span>
              </div>
            ) : null}

            <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-end' }}>
              <div style={{ width: '32ch' }}>
                <Bidang
                  id="cari-stok"
                  label="Cari produk"
                  value={cari}
                  onChange={(v) => setCari(v)}
                />
              </div>
              <Tombol varian="primary" onClick={() => bukaPanel(null)}>
                Barang masuk / penyesuaian
              </Tombol>
              <Tombol disabled={keadaan.jenis === 'memuat'} onClick={() => void muat()}>
                {keadaan.jenis === 'memuat' ? 'Memuat…' : 'Muat ulang'}
              </Tombol>
            </div>

            <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'center' }}>
              <Tombol
                varian={modeMenipis ? 'primary' : 'secondary'}
                onClick={() => setModeMenipis((v) => !v)}
              >
                {modeMenipis ? 'Tampilkan semua' : 'Hanya yang perlu diisi'}
              </Tombol>
              <Tombol
                varian={tampilArsip ? 'primary' : 'secondary'}
                onClick={() => setTampilArsip((v) => !v)}
              >
                {tampilArsip ? 'Sembunyikan terarsip' : 'Tampilkan terarsip'}
              </Tombol>
              {keadaan.jenis === 'siap' ? (
                <span className="t-caption">
                  <span className="num">{ringkas.jumlah}</span> varian
                  {ringkas.negatif > 0 ? (
                    <>
                      {' · '}
                      <span className="num">{ringkas.negatif}</span> bersaldo minus
                    </>
                  ) : null}
                </span>
              ) : null}
            </div>

            {modeMenipis ? (
              <div className="stack" style={{ gap: 'var(--space-2)', maxWidth: '44ch' }}>
                <div style={{ width: '18ch' }}>
                  <Bidang
                    id="ambang-menipis"
                    label="Anggap perlu diisi bila ≤"
                    value={ambang}
                    onChange={(v) => setAmbang(v)}
                  />
                </div>
                {/* ⛔ Dinyatakan: angkanya BUKAN aturan sistem. Tidak ada kolom
                    minimum di skema, dan menyimpannya menuntut keputusan produk
                    — ambang yang benar berbeda per barang. */}
                <span className="t-caption">
                  Angka ini hanya menyaring tampilan dan <strong>tidak disimpan</strong>. Sistem
                  belum menyimpan batas minimum per produk, jadi tentukan sendiri berapa yang Anda
                  anggap perlu diisi ulang.
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </Card>

      <Card>
        <div className="card-pad">
          {pesan !== null ? (
            <EmptyState
              icon={<Icon name={keadaan.jenis === 'galat' ? 'alert' : 'table'} size={32} />}
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
                { key: 'produk', header: 'Produk' },
                { key: 'varian', header: 'Varian' },
                { key: 'stok', header: 'Stok saat ini', align: 'right' },
                { key: 'gerak', header: 'Pergerakan', align: 'right' },
                { key: 'aksi', header: '' },
              ]}
              rows={terlihat.map<Baris>((b) => ({
                produk: (
                  <span className="stack" style={{ gap: 0 }}>
                    <span>{b.itemName}</span>
                    {b.archived ? <span className="t-caption">Terarsip</span> : null}
                  </span>
                ),
                varian: (
                  <span className="stack" style={{ gap: 0 }}>
                    <span>{b.variationName}</span>
                    {!b.trackStock ? (
                      <span className="t-caption">Stok tidak dilacak</span>
                    ) : null}
                  </span>
                ),
                // ⛔ Angka DAN teks. Aturan design system #5: status tidak
                // pernah warna saja — dan di sini warnanya menandai angka yang
                // mustahil secara fisik.
                stok: (
                  <span className="row" style={{ gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                    <span className="num" style={ANGKA}>
                      {b.saldo}
                    </span>
                    {/* ⛔ Di mode "perlu diisi", labelnya membedakan Minus,
                        Habis, dan Menipis — tiga keadaan yang tindakannya
                        berbeda. Di luar mode itu hanya minus yang ditandai,
                        supaya daftar penuh tidak menjadi lautan lencana yang
                        berhenti dibaca orang. */}
                    {modeMenipis
                      ? LABEL_TINGKAT[tingkatStok(b.saldoMilli, ambangSah)] !== '' && (
                          <Badge tone={nadaTingkat(tingkatStok(b.saldoMilli, ambangSah))}>
                            {LABEL_TINGKAT[tingkatStok(b.saldoMilli, ambangSah)]}
                          </Badge>
                        )
                      : labelStok(b.saldoMilli) !== '' && (
                          <Badge tone={nadaStok(b.saldoMilli)}>{labelStok(b.saldoMilli)}</Badge>
                        )}
                  </span>
                ),
                gerak: <span className="num">{b.jumlahMovement}</span>,
                aksi: (
                  <Tombol varian="ghost" onClick={() => bukaPanel(b.variationId)}>
                    Sesuaikan
                  </Tombol>
                ),
              }))}
            />
          )}
        </div>
      </Card>

      <SesuaikanModal
        terbuka={panelTerbuka}
        outletId={outletId}
        namaOutlet={namaOutlet}
        varianAwal={varianAwal}
        varian={varian}
        onTutup={() => setPanelTerbuka(false)}
        // ⛔ Memuat ulang dari SERVER, bukan menambahkan delta ke angka di
        // layar. Menghitungnya di klien membuat layar ini tempat kedua yang
        // menjumlahkan stok — dan tempat kedua adalah tempat yang menyimpang.
        onSelesai={() => void muat()}
      />

      <span className="t-caption">
        Saldo minus berarti barang terjual melebihi yang tercatat masuk. Untuk merchant yang baru
        mulai, itu wajar sampai stok awal dicatat lewat <strong>Barang masuk</strong> — bukan
        tanda kerusakan.
      </span>

      <span className="t-caption">
        Setiap pergerakan dicatat permanen. Koreksi adalah baris baru, bukan perubahan atas baris
        lama, sehingga riwayatnya selalu dapat ditelusuri.
      </span>
    </div>
  );
}
