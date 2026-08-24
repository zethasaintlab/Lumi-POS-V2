import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Card, EmptyState, Icon, Table } from 'ds';
import { useSesi } from '../../../../packages/klien-api/src/sesi.tsx';
import { GalatHttp } from '../../../../packages/klien-api/src/http.ts';
import { Tombol } from '../Tombol.tsx';
import { Bidang } from '../Bidang.tsx';
import type { Outlet } from '../laporan/RentangTanggal.tsx';
import { waktuTampil, zonaPerangkat } from '../pengawasan/b21.ts';
import { kuantitasTampil, saringStok, type BarisStok } from './b12.ts';
import {
  LABEL_SELISIH_STOK,
  arahSelisihStok,
  labelStatusOpname,
  nadaSelisihStok,
  nadaStatusOpname,
  ringkasHitungan,
  selisihTampil,
  susunBarisHitung,
  type DetailOpname,
  type RingkasOpname,
} from './b14.ts';

/**
 * B-14 — Opname (`IA:§3.3`, grup INVENTORI).
 *
 * ## ⛔ Penjualan tetap berjalan selama opname
 *
 * `spec-e` FR-E7 menuntutnya, dan itu yang membuat layar ini tidak boleh
 * menghitung selisih sendiri. `expectedQty` datang dari server sebagai saldo
 * pada **waktu T** yang dibekukan saat opname dimulai; daftar stok yang tampil
 * di layar lain memuat saldo SEKARANG, dan keduanya sengaja berbeda.
 *
 * ## ⛔ Petugas memilih barang yang ingin dihitung
 *
 * Bukan seluruh katalog sekaligus. Opname nyata dilakukan per rak, per
 * kategori, atau per barang yang dicurigai — memaksa seluruh katalog
 * menghasilkan daftar yang tidak pernah selesai, dan opname yang tidak pernah
 * selesai tidak menghasilkan koreksi apa pun.
 */

type Baris = Record<string, unknown>;
const ANGKA = { whiteSpace: 'nowrap' } as const;

type Layar = 'daftar' | 'hitung';

export function OpnameLayar() {
  const { api } = useSesi();
  const [outlet, setOutlet] = useState<Outlet[]>([]);
  const [outletId, setOutletId] = useState('');
  const [layar, setLayar] = useState<Layar>('daftar');
  const [riwayat, setRiwayat] = useState<RingkasOpname[]>([]);
  const [aktif, setAktif] = useState<DetailOpname | null>(null);
  const [stok, setStok] = useState<BarisStok[]>([]);
  const [cari, setCari] = useState('');
  const [hitungan, setHitungan] = useState<Record<string, string>>({});
  const [pesan, setPesan] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [zona] = useState(() => zonaPerangkat());

  useEffect(() => {
    let batal = false;
    void (async () => {
      try {
        const o = await api.minta<Outlet[]>('/outlets');
        if (batal) return;
        setOutlet(o);
        const hidup = o.filter((x) => x.archivedAt === null);
        if (hidup.length > 0) setOutletId((k) => (k === '' ? hidup[0].id : k));
      } catch {
        setPesan('Daftar outlet tidak dapat dimuat.');
      }
    })();
    return () => {
      batal = true;
    };
  }, [api]);

  const muatRiwayat = useCallback(async () => {
    if (outletId === '') return;
    try {
      const r = await api.minta<{ items: RingkasOpname[] }>(
        `/inventory/stocktakes?outlet_id=${encodeURIComponent(outletId)}`
      );
      setRiwayat(r.items);
    } catch (err) {
      setPesan(err instanceof GalatHttp ? err.message : 'Riwayat opname tidak dapat dimuat.');
    }
  }, [api, outletId]);

  useEffect(() => {
    void muatRiwayat();
  }, [muatRiwayat]);

  const bukaOpname = useCallback(
    async (id: string) => {
      setSibuk(true);
      setPesan(null);
      try {
        const [detail, daftarStok] = await Promise.all([
          api.minta<DetailOpname>(`/inventory/stocktakes/${encodeURIComponent(id)}`),
          api.minta<{ items: BarisStok[] }>(
            `/reports/inventory/stocks?outlet_id=${encodeURIComponent(outletId)}&include_zero=true`
          ),
        ]);
        setAktif(detail);
        setStok(daftarStok.items.filter((b) => b.trackStock && !b.archived));
        // Hitungan yang sudah tersimpan dimuat kembali — FR-E7: opname dapat
        // dijeda dan dilanjutkan tanpa kehilangan data.
        const awal: Record<string, string> = {};
        for (const l of detail.lines) {
          if (l.countedQty !== null) awal[l.variationId] = kuantitasTampil(BigInt(l.countedQty));
        }
        setHitungan(awal);
        setLayar('hitung');
      } catch (err) {
        setPesan(err instanceof GalatHttp ? err.message : 'Opname tidak dapat dibuka.');
      } finally {
        setSibuk(false);
      }
    },
    [api, outletId]
  );

  const mulaiBaru = async () => {
    setSibuk(true);
    setPesan(null);
    try {
      const baru = await api.minta<{ id: string }>('/inventory/stocktakes', {
        metode: 'POST',
        body: { outletId },
      });
      await muatRiwayat();
      await bukaOpname(baru.id);
    } catch (err) {
      setPesan(err instanceof GalatHttp ? err.message : 'Opname baru tidak dapat dimulai.');
      setSibuk(false);
    }
  };

  const simpanHitungan = async () => {
    if (aktif === null) return;
    const { lines, galat } = susunBarisHitung(
      Object.entries(hitungan).map(([variationId, teks]) => ({ variationId, teks }))
    );
    if (galat.length > 0) {
      setPesan(`${galat.length} baris belum benar: ${galat[0].pesan}`);
      return;
    }
    if (lines.length === 0) {
      setPesan('Belum ada hitungan yang diisi.');
      return;
    }
    setSibuk(true);
    setPesan(null);
    try {
      await api.minta(`/inventory/stocktakes/${encodeURIComponent(aktif.id)}/lines`, {
        metode: 'PUT',
        body: { lines },
      });
      // Dimuat ulang dari server supaya selisihnya datang dari `expectedQty`
      // milik server, bukan dihitung di layar.
      await bukaOpname(aktif.id);
      setPesan(`${lines.length} baris tersimpan.`);
    } catch (err) {
      setPesan(err instanceof GalatHttp ? err.message : 'Hitungan belum tersimpan.');
    } finally {
      setSibuk(false);
    }
  };

  const selesaikan = async () => {
    if (aktif === null) return;
    setSibuk(true);
    setPesan(null);
    try {
      const hasil = await api.minta<{ movementDitulis: number; jumlahBerselisih: number }>(
        `/inventory/stocktakes/${encodeURIComponent(aktif.id)}/complete`,
        { metode: 'POST' }
      );
      await muatRiwayat();
      setLayar('daftar');
      setAktif(null);
      setPesan(
        `Opname selesai. ${hasil.jumlahBerselisih} barang berselisih, ${hasil.movementDitulis} koreksi stok dicatat.`
      );
    } catch (err) {
      setPesan(err instanceof GalatHttp ? err.message : 'Opname belum dapat diselesaikan.');
    } finally {
      setSibuk(false);
    }
  };

  const aktifLines = useMemo(
    () => new Map((aktif?.lines ?? []).map((l) => [l.variationId, l])),
    [aktif]
  );
  const ringkas = useMemo(() => ringkasHitungan(aktif?.lines ?? []), [aktif]);
  const terlihat = useMemo(() => saringStok(stok, { cari }), [stok, cari]);
  const aktifOutlet = outlet.filter((o) => o.archivedAt === null);

  // --- layar daftar ---------------------------------------------------------
  if (layar === 'daftar') {
    return (
      <div className="stack" style={{ gap: 'var(--space-4)', maxWidth: '104ch' }}>
        <div className="stack" style={{ gap: 'var(--space-1)' }}>
          <span className="t-title">Opname</span>
          <span className="t-caption">
            Menghitung barang secara fisik dan mencatat selisihnya terhadap catatan sistem.
          </span>
        </div>

        <Card>
          <div className="card-pad">
            <div className="stack" style={{ gap: 'var(--space-4)' }}>
              {aktifOutlet.length > 1 ? (
                <div className="stack" style={{ gap: 'var(--space-2)' }}>
                  <span className="label">Outlet</span>
                  <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                    {aktifOutlet.map((o) => (
                      <Tombol
                        key={o.id}
                        varian={outletId === o.id ? 'primary' : 'secondary'}
                        onClick={() => setOutletId(o.id)}
                      >
                        {o.name}
                      </Tombol>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="row" style={{ gap: 'var(--space-3)' }}>
                <Tombol varian="primary" disabled={sibuk || outletId === ''} onClick={() => void mulaiBaru()}>
                  {sibuk ? 'Menyiapkan…' : 'Mulai opname baru'}
                </Tombol>
              </div>
              {pesan !== null ? (
                <span className="t-caption" role="status">
                  {pesan}
                </span>
              ) : null}
              {/* ⛔ Dinyatakan: penjualan TIDAK dihentikan. Merchant yang
                  mengira harus menutup toko untuk opname tidak akan pernah
                  melakukannya. */}
              <span className="t-caption">
                Penjualan tetap berjalan selama opname. Sistem membekukan angka sistem saat opname
                dimulai, jadi barang yang terjual sambil Anda menghitung tidak membuat selisihnya
                salah.
              </span>
            </div>
          </div>
        </Card>

        <Card>
          <div className="card-pad">
            {riwayat.length === 0 ? (
              <EmptyState
                icon={<Icon name="clipboard" size={32} />}
                title="Belum pernah ada opname"
                body="Tekan Mulai opname baru untuk menghitung fisik barang di outlet ini. Anda dapat menghitung sebagian barang saja, lalu melanjutkannya nanti."
              />
            ) : (
              <Table
                columns={[
                  { key: 'waktu', header: 'Dimulai' },
                  { key: 'oleh', header: 'Oleh' },
                  { key: 'status', header: 'Status' },
                  { key: 'hitung', header: 'Dihitung', align: 'right' },
                  { key: 'selisih', header: 'Berselisih', align: 'right' },
                  { key: 'aksi', header: '' },
                ]}
                rows={riwayat.map<Baris>((o) => ({
                  waktu: (
                    <span className="num" style={ANGKA}>
                      {o.snapshotAt === null ? '—' : waktuTampil(o.snapshotAt, zona)}
                    </span>
                  ),
                  oleh: (
                    <span className="stack" style={{ gap: 0 }}>
                      <span>{o.startedByNama}</span>
                      {o.approvedByNama !== null ? (
                        <span className="t-caption">disetujui {o.approvedByNama}</span>
                      ) : null}
                    </span>
                  ),
                  status: (
                    <Badge tone={nadaStatusOpname(o.status)}>{labelStatusOpname(o.status)}</Badge>
                  ),
                  hitung: <span className="num">{o.jumlahDihitung}</span>,
                  selisih: <span className="num">{o.jumlahBerselisih}</span>,
                  aksi: (
                    <Tombol varian="ghost" disabled={sibuk} onClick={() => void bukaOpname(o.id)}>
                      {o.status === 'approved' ? 'Lihat' : 'Lanjutkan'}
                    </Tombol>
                  ),
                }))}
              />
            )}
          </div>
        </Card>
      </div>
    );
  }

  // --- layar hitung ---------------------------------------------------------
  const selesai = aktif?.status === 'approved';

  return (
    <div className="stack" style={{ gap: 'var(--space-4)', maxWidth: '104ch' }}>
      <div className="stack" style={{ gap: 'var(--space-1)' }}>
        <span className="t-title">{selesai ? 'Hasil opname' : 'Menghitung fisik'}</span>
        <span className="t-caption">
          {aktif?.snapshotAt !== null && aktif !== null
            ? `Angka sistem dibekukan pada ${waktuTampil(aktif.snapshotAt as string, zona)}.`
            : ''}{' '}
          Isi jumlah fisik hanya untuk barang yang Anda hitung — sisanya dibiarkan kosong.
        </span>
      </div>

      <Card>
        <div className="card-pad">
          <div className="stack" style={{ gap: 'var(--space-4)' }}>
            <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-end' }}>
              <div style={{ width: '32ch' }}>
                <Bidang id="cari-opname" label="Cari produk" value={cari} onChange={setCari} />
              </div>
              <Tombol onClick={() => { setLayar('daftar'); setAktif(null); setPesan(null); }}>
                Kembali
              </Tombol>
              {!selesai ? (
                <>
                  <Tombol varian="primary" disabled={sibuk} onClick={() => void simpanHitungan()}>
                    {sibuk ? 'Menyimpan…' : 'Simpan hitungan'}
                  </Tombol>
                  <Tombol
                    disabled={sibuk || ringkas.dihitung === 0}
                    onClick={() => void selesaikan()}
                  >
                    Selesaikan opname
                  </Tombol>
                </>
              ) : null}
            </div>

            <span className="t-caption">
              <span className="num">{ringkas.dihitung}</span> barang sudah dihitung ·{' '}
              <span className="num">{ringkas.berselisih}</span> berselisih
              {!selesai && ringkas.dihitung === 0
                ? ' — simpan hitungan dulu sebelum menyelesaikan.'
                : ''}
            </span>

            {pesan !== null ? (
              <span className="t-caption" role="status">
                {pesan}
              </span>
            ) : null}
          </div>
        </div>
      </Card>

      <Card>
        <div className="card-pad">
          {terlihat.length === 0 ? (
            <EmptyState
              icon={<Icon name="clipboard" size={32} />}
              title={cari.trim() === '' ? 'Tidak ada produk berstok terlacak' : 'Tidak ada produk yang cocok'}
              body={
                cari.trim() === ''
                  ? 'Outlet ini belum punya varian yang stoknya dilacak.'
                  : `Tidak ada produk yang namanya memuat "${cari.trim()}".`
              }
            />
          ) : (
            <Table
              columns={[
                { key: 'produk', header: 'Produk' },
                { key: 'sistem', header: 'Menurut sistem', align: 'right' },
                { key: 'fisik', header: 'Hitungan fisik', align: 'right' },
                { key: 'selisih', header: 'Selisih', align: 'right' },
              ]}
              rows={terlihat.map<Baris>((b) => {
                const baris = aktifLines.get(b.variationId);
                const arah = arahSelisihStok(baris?.selisih ?? null);
                return {
                  produk: (
                    <span className="stack" style={{ gap: 0 }}>
                      <span>{b.itemName}</span>
                      <span className="t-caption">{b.variationName}</span>
                    </span>
                  ),
                  // ⛔ Yang ditampilkan `expectedQty` dari SERVER bila barisnya
                  // sudah tersimpan — saldo pada waktu T. Saldo sekarang
                  // (`b.saldo`) hanya dipakai sebelum baris pertama disimpan,
                  // dan keduanya sengaja dapat berbeda.
                  sistem: (
                    <span className="num" style={ANGKA}>
                      {baris !== undefined
                        ? kuantitasTampil(BigInt(baris.expectedQty))
                        : b.saldo}
                    </span>
                  ),
                  fisik: selesai ? (
                    <span className="num" style={ANGKA}>
                      {baris?.countedQty === null || baris === undefined
                        ? '—'
                        : kuantitasTampil(BigInt(baris.countedQty))}
                    </span>
                  ) : (
                    <div style={{ width: '12ch', marginLeft: 'auto' }}>
                      <Bidang
                        id={`hitung-${b.variationId}`}
                        label=""
                        value={hitungan[b.variationId] ?? ''}
                        onChange={(v) => setHitungan((k) => ({ ...k, [b.variationId]: v }))}
                      />
                    </div>
                  ),
                  selisih: (
                    <span className="row" style={{ gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                      <span className="num" style={ANGKA}>
                        {selisihTampil(baris?.selisih ?? null)}
                      </span>
                      {baris?.selisih !== undefined && baris.selisih !== null ? (
                        <Badge tone={nadaSelisihStok(arah)}>{LABEL_SELISIH_STOK[arah]}</Badge>
                      ) : null}
                    </span>
                  ),
                };
              })}
            />
          )}
        </div>
      </Card>

      <span className="t-caption">
        Kolom <strong>Menurut sistem</strong> adalah angka yang dibekukan saat opname dimulai —
        bukan stok saat ini. Barang yang terjual selama Anda menghitung tetap terhitung sebagai
        penjualan, dan tidak muncul sebagai selisih.
      </span>

      <span className="t-caption">
        Menyelesaikan opname mencatat koreksi stok permanen untuk setiap barang yang berselisih.
        Barang yang dibiarkan kosong tidak diubah sama sekali.
      </span>
    </div>
  );
}
