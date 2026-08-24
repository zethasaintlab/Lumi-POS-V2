import { useCallback, useEffect, useState } from 'react';
import { Badge, Card, EmptyState, Icon, Table } from 'ds';
import { useSesi } from '../../../../packages/klien-api/src/sesi.tsx';
import { GalatHttp } from '../../../../packages/klien-api/src/http.ts';
import { Tombol } from '../Tombol.tsx';
import { Bidang } from '../Bidang.tsx';
import type { Item } from '../katalog/produk.ts';
import {
  buatMuatanPajak,
  pisahkanTarif,
  rateKePersen,
  APPLIES_TO,
  CHANNEL,
  PHASE,
  TIPE,
  type FormPajak,
  type TarifPajak,
} from './pajak.ts';

/**
 * B-25 — Pajak (`IA:§3.3`, akses minimum Owner).
 *
 * ## ⛔ Tidak ada "Ubah", dan itu DISENGAJA — bukan batas seperti di B-23
 *
 * FR-C6 memperlakukan tarif sebagai **entitas berdata**, bukan konstanta.
 * Perubahan perda menghasilkan **record baru**; yang lama diakhiri lewat
 * `POST /tax-rates/{id}/end`, dan barisnya tidak pernah dihapus (invariant
 * #2).
 *
 * Mengubah tarif di tempat akan mengubah pajak transaksi yang **sudah
 * terjadi**. Layar ini karena itu tidak menawarkan "Ubah" sama sekali, dan
 * menjelaskan kenapa — beda dari B-23, tempat ketiadaan `PATCH` memang lubang.
 *
 * ## ⛔ Merchant mengetik PERSEN, API menerima PECAHAN string
 *
 * Konversinya menggeser koma pada string, tidak pernah membagi 100 —
 * `parseRateToScaled` menolak `number` justru supaya nilai itu tidak menyentuh
 * IEEE754 double. Ada test yang menyilangkan setiap hasil konversi dengan
 * fungsi server itu.
 *
 * ## ⛔ Ruang lingkup tiga tingkat, dan dua di antaranya pernah MATI
 *
 * `CLAUDE.md` mencatat cacat F3: tarif ber-scope item/kategori tidak pernah
 * berlaku karena `getVariationSnapshot` tidak menyeleksi idnya — dua dari tiga
 * tingkat FR-C6 mati tanpa satu pun error, dan yang menyembunyikannya adalah
 * test yang hanya menguji PEMBUATAN, bukan penerapan.
 *
 * Layar ini menolak scope kategori/produk tanpa id, dan menyebut akibatnya:
 * tarif yang tidak akan pernah berlaku.
 */

interface Kategori {
  id: string;
  name: string;
  archivedAt: string | null;
}

interface Outlet {
  id: string;
  name: string;
  archivedAt: string | null;
}

type Keadaan = { jenis: 'memuat' } | { jenis: 'siap' } | { jenis: 'galat'; pesan: string };

const KOSONG: FormPajak = {
  nama: '',
  tipe: 'pbjt',
  persen: '',
  isInclusive: false,
  phase: 'subtotal',
  channel: 'all',
  appliesTo: 'all_items',
  appliesToIds: [],
  outletId: '',
};

const LABEL_TIPE: Record<string, string> = {
  pbjt: 'PBJT',
  ppn: 'PPN',
  service_charge: 'Service charge',
  none: 'Tanpa pajak',
};
const LABEL_PHASE: Record<string, string> = {
  subtotal: 'Dari subtotal',
  total: 'Dari total',
};
const LABEL_CHANNEL: Record<string, string> = {
  all: 'Semua kanal',
  dine_in: 'Dine in',
  takeaway: 'Takeaway',
};
const LABEL_SCOPE: Record<string, string> = {
  all_items: 'Semua produk',
  category: 'Kategori tertentu',
  item: 'Produk tertentu',
};

export function PajakLayar() {
  const { api } = useSesi();
  const [keadaan, setKeadaan] = useState<Keadaan>({ jenis: 'memuat' });
  const [tarif, setTarif] = useState<TarifPajak[]>([]);
  const [kategori, setKategori] = useState<Kategori[]>([]);
  const [produk, setProduk] = useState<Item[]>([]);
  const [outlet, setOutlet] = useState<Outlet[]>([]);

  const [form, setForm] = useState<FormPajak>(KOSONG);
  const [pesan, setPesan] = useState<string | null>(null);
  const [bidang, setBidang] = useState<keyof FormPajak | null>(null);
  const [sedangKirim, setSedangKirim] = useState(false);
  const [idBaru, setIdBaru] = useState(() => crypto.randomUUID());
  const [tampilSelesai, setTampilSelesai] = useState(false);

  const muat = useCallback(async () => {
    setKeadaan({ jenis: 'memuat' });
    try {
      const [t, k, p, o] = await Promise.all([
        api.minta<{ items: TarifPajak[] }>('/tax-rates'),
        api.minta<{ items: Kategori[] }>('/categories'),
        api.minta<{ items: Item[] }>('/items'),
        api.minta<Outlet[]>('/outlets'),
      ]);
      setTarif(t.items);
      setKategori(k.items);
      setProduk(p.items);
      setOutlet(o);
      setKeadaan({ jenis: 'siap' });
    } catch (err) {
      setKeadaan({
        jenis: 'galat',
        pesan:
          err instanceof GalatHttp
            ? err.message
            : 'Tidak dapat menghubungi server. Periksa koneksi lalu coba lagi.',
      });
    }
  }, [api]);

  useEffect(() => {
    void muat();
  }, [muat]);

  async function simpan() {
    setPesan(null);
    setBidang(null);

    const hasil = buatMuatanPajak(form, idBaru);
    if (!hasil.ok) {
      setBidang(hasil.bidang);
      setPesan(hasil.pesan);
      return;
    }

    setSedangKirim(true);
    try {
      await api.minta('/tax-rates', { metode: 'POST', body: hasil.muatan });
      setForm(KOSONG);
      setIdBaru(crypto.randomUUID());
      await muat();
    } catch (err) {
      setPesan(err instanceof GalatHttp ? err.message : 'Tarif tidak dapat disimpan.');
    } finally {
      setSedangKirim(false);
    }
  }

  async function akhiri(t: TarifPajak) {
    setPesan(null);
    try {
      await api.minta(`/tax-rates/${t.id}/end`, { metode: 'POST', body: {} });
      await muat();
    } catch (err) {
      setPesan(err instanceof GalatHttp ? err.message : 'Tarif tidak dapat diakhiri.');
    }
  }

  function pilihScopeId(id: string) {
    setForm((f) => ({
      ...f,
      appliesToIds: f.appliesToIds.includes(id)
        ? f.appliesToIds.filter((x) => x !== id)
        : [...f.appliesToIds, id],
    }));
    setBidang((b) => (b === 'appliesToIds' ? null : b));
    setPesan(null);
  }

  const { aktif, diakhiri } = pisahkanTarif(tarif);
  const outletAktif = outlet.filter((o) => o.archivedAt === null);
  const namaOutlet = (id: string | null) =>
    id === null ? 'Semua outlet' : (outlet.find((o) => o.id === id)?.name ?? id);
  const galat = (b: keyof FormPajak) => (bidang === b ? (pesan ?? undefined) : undefined);

  const pilihanScope =
    form.appliesTo === 'category'
      ? kategori.filter((k) => k.archivedAt === null).map((k) => ({ id: k.id, nama: k.name }))
      : form.appliesTo === 'item'
        ? produk.filter((p) => p.archivedAt === null).map((p) => ({ id: p.id, nama: p.name }))
        : [];

  function barisTarif(t: TarifPajak, sudahSelesai: boolean) {
    return {
      nama: (
        <div className="stack" style={{ gap: 'var(--space-1)' }}>
          <span>{t.name}</span>
          <span className="t-caption">
            {LABEL_TIPE[t.type] ?? t.type} · {LABEL_PHASE[t.phase] ?? t.phase} ·{' '}
            {t.isInclusive ? 'Termasuk harga' : 'Ditambahkan'}
          </span>
        </div>
      ),
      tarif: <span className="num">{rateKePersen(t.rate)}%</span>,
      lingkup: (
        <div className="stack" style={{ gap: 'var(--space-1)' }}>
          <span>{LABEL_SCOPE[t.appliesTo] ?? t.appliesTo}</span>
          {t.appliesToIds.length > 0 ? (
            <span className="t-caption num">{t.appliesToIds.length} dipilih</span>
          ) : null}
        </div>
      ),
      kanal: LABEL_CHANNEL[t.channel] ?? t.channel,
      outlet: namaOutlet(t.outletId),
      status: sudahSelesai ? (
        <Badge tone="neutral">Diakhiri</Badge>
      ) : (
        <Badge tone="success">Berlaku</Badge>
      ),
      aksi: sudahSelesai ? null : (
        <Tombol varian="danger" onClick={() => void akhiri(t)}>
          Akhiri
        </Tombol>
      ),
    };
  }

  const kolom = [
    { key: 'nama', header: 'Tarif' },
    { key: 'tarif', header: 'Besaran', align: 'right' as const },
    { key: 'lingkup', header: 'Berlaku untuk' },
    { key: 'kanal', header: 'Kanal' },
    { key: 'outlet', header: 'Outlet' },
    { key: 'status', header: 'Status' },
    { key: 'aksi', header: '', align: 'right' as const },
  ];

  return (
    <div className="stack" style={{ gap: 'var(--space-4)', maxWidth: '96ch' }}>
      <div className="stack" style={{ gap: 'var(--space-1)' }}>
        <span className="t-title">Pajak</span>
        <span className="t-caption">
          Tarif tidak pernah diubah di tempat — perubahan perda dicatat sebagai tarif baru, yang
          lama diakhiri. Itu yang membuat pajak pada struk lama tetap dapat dijelaskan.
        </span>
      </div>

      {/* --- tambah -------------------------------------------------------- */}
      <Card>
        <div className="card-pad">
          <div className="stack" style={{ gap: 'var(--space-4)' }}>
            <span className="t-body-md">Tarif baru</span>

            <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
              <div className="grow">
                <Bidang
                  id="nama-tarif"
                  label="Nama tarif"
                  value={form.nama}
                  required
                  error={galat('nama')}
                  onChange={(v) => {
                    setForm((f) => ({ ...f, nama: v }));
                    setPesan(null);
                    setBidang(null);
                  }}
                />
              </div>
              <div style={{ width: '16ch' }}>
                <Bidang
                  id="persen"
                  label="Besaran (%)"
                  value={form.persen}
                  required
                  error={galat('persen')}
                  onChange={(v) => {
                    setForm((f) => ({ ...f, persen: v }));
                    setPesan(null);
                    setBidang(null);
                  }}
                />
              </div>
              {/* ⛔ Diketik sebagai PERSEN. Merchant menulis 11, bukan 0.11 —
                  dan pengiriman ke server memakai pecahan string. */}
              <span className="t-caption grow">
                Ketik angka persennya: <span className="num">11</span> untuk 11%. Maksimal dua angka
                di belakang koma.
              </span>
            </div>

            <div className="stack" style={{ gap: 'var(--space-2)' }}>
              <span className="label">Jenis</span>
              <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                {TIPE.map((t) => (
                  <Tombol
                    key={t}
                    varian={form.tipe === t ? 'primary' : 'secondary'}
                    onClick={() => setForm((f) => ({ ...f, tipe: t }))}
                  >
                    {LABEL_TIPE[t]}
                  </Tombol>
                ))}
              </div>
            </div>

            <div className="row" style={{ gap: 'var(--space-4)', flexWrap: 'wrap' }}>
              <div className="stack" style={{ gap: 'var(--space-2)' }}>
                <span className="label">Dihitung dari</span>
                <div className="row" style={{ gap: 'var(--space-2)' }}>
                  {PHASE.map((p) => (
                    <Tombol
                      key={p}
                      varian={form.phase === p ? 'primary' : 'secondary'}
                      onClick={() => setForm((f) => ({ ...f, phase: p }))}
                    >
                      {LABEL_PHASE[p]}
                    </Tombol>
                  ))}
                </div>
              </div>

              <div className="stack" style={{ gap: 'var(--space-2)' }}>
                <span className="label">Sudah termasuk harga?</span>
                <Tombol
                  varian={form.isInclusive ? 'primary' : 'secondary'}
                  onClick={() => setForm((f) => ({ ...f, isInclusive: !f.isInclusive }))}
                >
                  {form.isInclusive ? 'Termasuk harga' : 'Ditambahkan ke harga'}
                </Tombol>
              </div>

              <div className="stack" style={{ gap: 'var(--space-2)' }}>
                <span className="label">Kanal</span>
                <div className="row" style={{ gap: 'var(--space-2)' }}>
                  {CHANNEL.map((c) => (
                    <Tombol
                      key={c}
                      varian={form.channel === c ? 'primary' : 'secondary'}
                      onClick={() => setForm((f) => ({ ...f, channel: c }))}
                    >
                      {LABEL_CHANNEL[c]}
                    </Tombol>
                  ))}
                </div>
              </div>
            </div>

            {/* --- ruang lingkup --------------------------------------------- */}
            <div className="stack" style={{ gap: 'var(--space-2)' }}>
              <span className="label">Berlaku untuk</span>
              <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                {APPLIES_TO.map((a) => (
                  <Tombol
                    key={a}
                    varian={form.appliesTo === a ? 'primary' : 'secondary'}
                    onClick={() => {
                      // Pindah lingkup MENGOSONGKAN pilihan sebelumnya — id
                      // kategori yang tertinggal saat lingkup berubah ke produk
                      // adalah id yang server tolak 404, dan pesannya tidak
                      // menyebut bahwa penyebabnya adalah pilihan lama.
                      setForm((f) => ({ ...f, appliesTo: a, appliesToIds: [] }));
                      setPesan(null);
                      setBidang(null);
                    }}
                  >
                    {LABEL_SCOPE[a]}
                  </Tombol>
                ))}
              </div>

              {form.appliesTo !== 'all_items' ? (
                <div className="stack" style={{ gap: 'var(--space-2)' }}>
                  {pilihanScope.length === 0 ? (
                    <span className="t-caption">
                      Belum ada {form.appliesTo === 'category' ? 'kategori' : 'produk'} aktif untuk
                      dipilih.
                    </span>
                  ) : (
                    <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                      {pilihanScope.map((p) => (
                        <Tombol
                          key={p.id}
                          varian={form.appliesToIds.includes(p.id) ? 'primary' : 'secondary'}
                          onClick={() => pilihScopeId(p.id)}
                        >
                          {p.nama}
                        </Tombol>
                      ))}
                    </div>
                  )}
                  {bidang === 'appliesToIds' && pesan ? (
                    <span className="field-error">{pesan}</span>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="stack" style={{ gap: 'var(--space-2)' }}>
              <span className="label">Outlet</span>
              <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                <Tombol
                  varian={form.outletId === '' ? 'primary' : 'secondary'}
                  onClick={() => setForm((f) => ({ ...f, outletId: '' }))}
                >
                  Semua outlet
                </Tombol>
                {outletAktif.map((o) => (
                  <Tombol
                    key={o.id}
                    varian={form.outletId === o.id ? 'primary' : 'secondary'}
                    onClick={() => setForm((f) => ({ ...f, outletId: o.id }))}
                  >
                    {o.name}
                  </Tombol>
                ))}
              </div>
            </div>

            <div className="row" style={{ gap: 'var(--space-3)' }}>
              <Tombol varian="primary" disabled={sedangKirim} onClick={() => void simpan()}>
                {sedangKirim ? 'Menyimpan…' : 'Buat tarif'}
              </Tombol>
              {pesan && bidang === null ? (
                <span className="t-caption" style={{ color: 'var(--danger)' }} role="alert">
                  {pesan}
                </span>
              ) : null}
            </div>

            {/* ⛔ Waktu berlaku dari jam SERVER — sama seperti B-10. */}
            <span className="t-caption">
              Tarif berlaku sejak disimpan, memakai jam server. Tarif tidak dapat diubah setelah
              dibuat — buat tarif baru dan akhiri yang lama.
            </span>
          </div>
        </div>
      </Card>

      {/* --- berlaku -------------------------------------------------------- */}
      <Card>
        <div className="card-pad">
          {keadaan.jenis === 'galat' ? (
            <EmptyState
              icon={<Icon name="alert" size={32} />}
              title="Daftar tarif tidak dapat dimuat"
              body={keadaan.pesan}
              action={<Tombol onClick={() => void muat()}>Coba lagi</Tombol>}
            />
          ) : aktif.length === 0 && keadaan.jenis === 'siap' ? (
            <EmptyState
              icon={<Icon name="file" size={32} />}
              title="Belum ada tarif berlaku"
              body="Tanpa tarif, setiap transaksi dihitung tanpa pajak. Buat satu tarif bila outlet Anda memungut PBJT atau PPN."
            />
          ) : (
            <div className="stack" style={{ gap: 'var(--space-3)' }}>
              <span className="t-body-md">Tarif berlaku</span>
              <Table columns={kolom} rows={aktif.map((t) => barisTarif(t, false))} />
            </div>
          )}
        </div>
      </Card>

      {/* --- diakhiri -------------------------------------------------------- */}
      {diakhiri.length > 0 ? (
        <Card>
          <div className="card-pad">
            <div className="stack" style={{ gap: 'var(--space-3)' }}>
              <div className="row between">
                <span className="t-body-md">
                  Tarif yang sudah diakhiri <span className="num">({diakhiri.length})</span>
                </span>
                <Tombol onClick={() => setTampilSelesai((v) => !v)}>
                  {tampilSelesai ? 'Sembunyikan' : 'Tampilkan'}
                </Tombol>
              </div>
              {tampilSelesai ? (
                <Table columns={kolom} rows={diakhiri.map((t) => barisTarif(t, true))} />
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}

      <span className="t-caption">
        Tarif yang diakhiri tidak pernah dihapus. Transaksi lama menyimpan tarifnya sendiri di
        setiap baris pesanan, dan barisan ini yang menjelaskan angka pajak di struk yang sudah
        tercetak.
      </span>
    </div>
  );
}
