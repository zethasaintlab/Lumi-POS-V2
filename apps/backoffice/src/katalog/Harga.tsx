import { useCallback, useEffect, useState } from 'react';
import { Badge, Card, EmptyState, Icon, Table } from 'ds';
import { useSesi } from '../sesi.tsx';
import { GalatHttp } from '../http.ts';
import { Tombol } from '../Tombol.tsx';
import { Bidang } from '../Bidang.tsx';
import { rupiah, type Item } from './produk.ts';
import {
  buatMuatanHarga,
  ringkasRiwayat,
  type BarisHarga,
  type FormHarga,
  type StatusHarga,
} from './harga.ts';

/**
 * B-10 — Harga & Riwayat (`IA:§3.3`, akses minimum Manajer Area).
 *
 * ## Layar ini adalah SATU-SATUNYA jalan mengubah harga
 *
 * `item_variation.price` beku setelah varian dibuat (B-07), dan
 * `updateItemVariation` tidak menerima `price`. Setiap perubahan hidup di
 * `price_history` — dan `price_history` hanya dapat ditulis dari sini.
 *
 * ## ⛔ Anak tangga yang dipakai DITAMPILKAN
 *
 * `getResolvedPrice` mengembalikan `source`: `outlet` · `tenant` ·
 * `variation`. Kontraknya menyebut alasannya sendiri — *"diagnosabilitas di
 * lapangan tanpa membaca database langsung"*. Menyembunyikannya membuat
 * "kenapa harganya segini" hanya dapat dijawab lewat SQL.
 *
 * ## ⛔ Dua jawaban, dan bedanya dinyatakan
 *
 * Kartu atas memakai jam **database** (otoritatif). Kolom Status di tabel
 * riwayat dihitung dari jam **browser** — ia penafsiran, dan layar
 * mengatakannya. Menyamakan keduanya berarti mengklaim kepastian yang tidak
 * dimiliki klien.
 */

interface Outlet {
  id: string;
  name: string;
  archivedAt: string | null;
}

interface Terselesaikan {
  price: number;
  source: 'outlet' | 'tenant' | 'variation';
  outletId: string | null;
  at: string;
}

type Keadaan = { jenis: 'memuat' } | { jenis: 'siap' } | { jenis: 'galat'; pesan: string };

const FORM_KOSONG: FormHarga = {
  harga: '',
  outletId: '',
  berlaku: 'sekarang',
  tanggal: '',
  jam: '',
  alasan: '',
};

const LABEL_TANGGA: Record<Terselesaikan['source'], string> = {
  outlet: 'Harga khusus outlet ini',
  tenant: 'Harga umum semua outlet',
  variation: 'Harga awal varian (belum pernah diubah)',
};

const LABEL_STATUS: Record<StatusHarga, string> = {
  berlaku: 'Berlaku',
  terjadwal: 'Terjadwal',
  lampau: 'Lampau',
};

export function HargaLayar() {
  const { api } = useSesi();
  const [keadaan, setKeadaan] = useState<Keadaan>({ jenis: 'memuat' });
  const [items, setItems] = useState<Item[]>([]);
  const [outlet, setOutlet] = useState<Outlet[]>([]);

  const [itemId, setItemId] = useState<string | null>(null);
  const [variationId, setVariationId] = useState<string | null>(null);
  const [outletLihat, setOutletLihat] = useState<string>('');

  const [riwayat, setRiwayat] = useState<BarisHarga[]>([]);
  const [terselesaikan, setTerselesaikan] = useState<Terselesaikan | null>(null);
  const [form, setForm] = useState<FormHarga>(FORM_KOSONG);
  const [pesan, setPesan] = useState<string | null>(null);
  const [bidang, setBidang] = useState<keyof FormHarga | null>(null);
  const [idBaru, setIdBaru] = useState(() => crypto.randomUUID());

  const muat = useCallback(async () => {
    setKeadaan({ jenis: 'memuat' });
    try {
      const [i, o] = await Promise.all([
        api.minta<{ items: Item[] }>('/items'),
        api.minta<Outlet[]>('/outlets'),
      ]);
      setItems(i.items);
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

  const muatHarga = useCallback(async () => {
    if (itemId === null || variationId === null) return;
    setPesan(null);
    try {
      const jalurDasar = `/items/${itemId}/variations/${variationId}`;
      const kueri = outletLihat.length > 0 ? `?outletId=${encodeURIComponent(outletLihat)}` : '';
      const [r, t] = await Promise.all([
        api.minta<{ items: BarisHarga[] }>(`${jalurDasar}/prices`),
        // ⛔ Otoritatif: jam DATABASE, dan ia menyebut anak tangganya.
        api.minta<Terselesaikan>(`${jalurDasar}/price${kueri}`),
      ]);
      setRiwayat(r.items);
      setTerselesaikan(t);
    } catch (err) {
      setPesan(err instanceof GalatHttp ? err.message : 'Riwayat harga tidak dapat dimuat.');
    }
  }, [api, itemId, variationId, outletLihat]);

  useEffect(() => {
    void muatHarga();
  }, [muatHarga]);

  async function simpan() {
    setPesan(null);
    setBidang(null);
    if (itemId === null || variationId === null) return;

    const hasil = buatMuatanHarga(form, idBaru);
    if (!hasil.ok) {
      setBidang(hasil.bidang);
      setPesan(hasil.pesan);
      return;
    }

    try {
      await api.minta(`/items/${itemId}/variations/${variationId}/prices`, {
        metode: 'POST',
        body: hasil.muatan,
      });
      setForm(FORM_KOSONG);
      setIdBaru(crypto.randomUUID());
      await muatHarga();
    } catch (err) {
      setPesan(err instanceof GalatHttp ? err.message : 'Harga tidak dapat disimpan.');
    }
  }

  const item = items.find((i) => i.id === itemId) ?? null;
  const varian = item?.variations.find((v) => v.id === variationId) ?? null;
  const outletAktif = outlet.filter((o) => o.archivedAt === null);
  const namaOutlet = (id: string | null) =>
    id === null ? 'Semua outlet' : (outlet.find((o) => o.id === id)?.name ?? id);
  const galat = (b: keyof FormHarga) => (bidang === b ? (pesan ?? undefined) : undefined);

  // ⛔ Jam BROWSER, dan itu disebut apa adanya di layar.
  const baris = ringkasRiwayat(riwayat, Date.now());

  return (
    <div className="stack" style={{ gap: 'var(--space-4)', maxWidth: '96ch' }}>
      <div className="stack" style={{ gap: 'var(--space-1)' }}>
        <span className="t-title">Harga &amp; Riwayat</span>
        <span className="t-caption">
          Harga awal varian beku setelah dibuat. Setiap penyesuaian dicatat di sini — per outlet,
          beserta tanggal berlaku dan siapa yang mengubahnya.
        </span>
      </div>

      {/* --- pilih varian ---------------------------------------------------- */}
      <Card>
        <div className="card-pad">
          {keadaan.jenis === 'galat' ? (
            <EmptyState
              icon={<Icon name="alert" size={32} />}
              title="Katalog tidak dapat dimuat"
              body={keadaan.pesan}
              action={<Tombol onClick={() => void muat()}>Coba lagi</Tombol>}
            />
          ) : items.length === 0 && keadaan.jenis === 'siap' ? (
            <EmptyState
              icon={<Icon name="tag" size={32} />}
              title="Belum ada produk"
              body="Harga menempel pada varian produk. Tambahkan produk lebih dulu di layar Produk."
            />
          ) : (
            <div className="stack" style={{ gap: 'var(--space-4)' }}>
              <div className="stack" style={{ gap: 'var(--space-2)' }}>
                <span className="label">Produk</span>
                <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  {items.map((i) => (
                    <Tombol
                      key={i.id}
                      varian={itemId === i.id ? 'primary' : 'secondary'}
                      onClick={() => {
                        setItemId(i.id);
                        // Varian pertama yang aktif dipilih otomatis — layar
                        // yang menuntut dua klik sebelum menampilkan apa pun
                        // terbaca seperti layar yang belum dimuat.
                        setVariationId(i.variations.find((v) => v.archivedAt === null)?.id ?? null);
                        setRiwayat([]);
                        setTerselesaikan(null);
                      }}
                    >
                      {i.name}
                    </Tombol>
                  ))}
                </div>
              </div>

              {item ? (
                <div className="stack" style={{ gap: 'var(--space-2)' }}>
                  <span className="label">Varian</span>
                  <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                    {item.variations
                      .filter((v) => v.archivedAt === null)
                      .map((v) => (
                        <Tombol
                          key={v.id}
                          varian={variationId === v.id ? 'primary' : 'secondary'}
                          onClick={() => setVariationId(v.id)}
                        >
                          {v.name}
                        </Tombol>
                      ))}
                  </div>
                </div>
              ) : null}

              {varian ? (
                <div className="stack" style={{ gap: 'var(--space-2)' }}>
                  <span className="label">Lihat harga untuk outlet</span>
                  <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                    <Tombol
                      varian={outletLihat === '' ? 'primary' : 'secondary'}
                      onClick={() => setOutletLihat('')}
                    >
                      Tanpa outlet tertentu
                    </Tombol>
                    {outletAktif.map((o) => (
                      <Tombol
                        key={o.id}
                        varian={outletLihat === o.id ? 'primary' : 'secondary'}
                        onClick={() => setOutletLihat(o.id)}
                      >
                        {o.name}
                      </Tombol>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </Card>

      {varian ? (
        <>
          {/* --- harga yang benar-benar berlaku ----------------------------- */}
          <Card>
            <div className="card-pad">
              <div className="stack" style={{ gap: 'var(--space-2)' }}>
                <div className="row between">
                  <span className="t-body-md">
                    Harga berlaku · {item?.name} {varian.name}
                  </span>
                  {terselesaikan ? (
                    // ⛔ Anak tangga ditampilkan, dan ia membawa TEKS — bukan
                    // warna saja (aturan DS #5).
                    <Badge tone={terselesaikan.source === 'variation' ? 'neutral' : 'success'}>
                      {LABEL_TANGGA[terselesaikan.source]}
                    </Badge>
                  ) : null}
                </div>

                <span className="t-display num">
                  {terselesaikan ? rupiah(terselesaikan.price) : '—'}
                </span>

                <span className="t-caption">
                  {outletLihat === ''
                    ? 'Tanpa memilih outlet, yang ditampilkan adalah harga umum tenant.'
                    : `Untuk outlet ${namaOutlet(outletLihat)}.`}{' '}
                  Angka ini dihitung server dengan jam database — ia yang benar-benar dipakai kasir.
                </span>
              </div>
            </div>
          </Card>

          {/* --- tambah harga ---------------------------------------------- */}
          <Card>
            <div className="card-pad">
              <div className="stack" style={{ gap: 'var(--space-4)' }}>
                <span className="t-body-md">Ubah harga</span>

                <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
                  <div style={{ width: '20ch' }}>
                    <Bidang
                      id="harga-baru"
                      label="Harga baru"
                      value={form.harga}
                      required
                      error={galat('harga')}
                      onChange={(v) => {
                        setForm((f) => ({ ...f, harga: v }));
                        setPesan(null);
                        setBidang(null);
                      }}
                    />
                  </div>
                  <div className="grow">
                    <Bidang
                      id="alasan"
                      label="Alasan (opsional)"
                      value={form.alasan}
                      onChange={(v) => setForm((f) => ({ ...f, alasan: v }))}
                    />
                  </div>
                </div>

                <div className="stack" style={{ gap: 'var(--space-2)' }}>
                  <span className="label">Berlaku untuk</span>
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
                  <span className="t-caption">
                    Harga khusus outlet menimpa harga semua-outlet di outlet itu saja.
                  </span>
                </div>

                <div className="stack" style={{ gap: 'var(--space-2)' }}>
                  <span className="label">Mulai berlaku</span>
                  <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                    <Tombol
                      varian={form.berlaku === 'sekarang' ? 'primary' : 'secondary'}
                      onClick={() => setForm((f) => ({ ...f, berlaku: 'sekarang' }))}
                    >
                      Sekarang
                    </Tombol>
                    <Tombol
                      varian={form.berlaku === 'terjadwal' ? 'primary' : 'secondary'}
                      onClick={() => setForm((f) => ({ ...f, berlaku: 'terjadwal' }))}
                    >
                      Terjadwal
                    </Tombol>
                  </div>
                  {form.berlaku === 'terjadwal' ? (
                    <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
                      <div style={{ width: '18ch' }}>
                        <Bidang
                          id="tanggal"
                          label="Tanggal (YYYY-MM-DD)"
                          value={form.tanggal}
                          required
                          error={galat('tanggal')}
                          onChange={(v) => {
                            setForm((f) => ({ ...f, tanggal: v }));
                            setPesan(null);
                            setBidang(null);
                          }}
                        />
                      </div>
                      <div style={{ width: '14ch' }}>
                        <Bidang
                          id="jam"
                          label="Jam (HH:MM)"
                          value={form.jam}
                          onChange={(v) => setForm((f) => ({ ...f, jam: v }))}
                        />
                      </div>
                      <span className="t-caption grow">
                        Jam perangkat ini. Kosongkan untuk tengah malam.
                      </span>
                    </div>
                  ) : (
                    // ⛔ Dinyatakan: "sekarang" berarti jam SERVER, dan itu
                    // bukan detail implementasi — ia yang membuat harga baru
                    // langsung dipakai kasir alih-alih tertunda oleh selisih
                    // jam perangkat.
                    <span className="t-caption">
                      Waktu berlaku diambil dari jam server, bukan jam perangkat ini.
                    </span>
                  )}
                </div>

                <div className="row" style={{ gap: 'var(--space-3)' }}>
                  <Tombol varian="primary" onClick={() => void simpan()}>
                    Simpan harga
                  </Tombol>
                  {pesan && bidang === null ? (
                    <span className="t-caption" style={{ color: 'var(--danger)' }} role="alert">
                      {pesan}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </Card>

          {/* --- riwayat ---------------------------------------------------- */}
          <Card>
            <div className="card-pad">
              {baris.length === 0 ? (
                <EmptyState
                  icon={<Icon name="clock" size={32} />}
                  title="Belum pernah diubah"
                  body={`Varian ini masih memakai harga awalnya, ${rupiah(varian.price)}. Perubahan pertama akan muncul di sini beserta siapa yang melakukannya.`}
                />
              ) : (
                <Table
                  columns={[
                    { key: 'harga', header: 'Harga', align: 'right' },
                    { key: 'outlet', header: 'Berlaku untuk' },
                    { key: 'mulai', header: 'Mulai' },
                    { key: 'status', header: 'Status' },
                    { key: 'oleh', header: 'Diubah oleh' },
                    { key: 'alasan', header: 'Alasan' },
                  ]}
                  rows={baris.map((b) => ({
                    harga: <span className="num">{rupiah(b.price)}</span>,
                    outlet: namaOutlet(b.outletId),
                    mulai: <span className="num">{new Date(b.effectiveFrom).toLocaleString('id-ID')}</span>,
                    status: (
                      <Badge
                        tone={
                          b.status === 'berlaku'
                            ? 'success'
                            : b.status === 'terjadwal'
                              ? 'warning'
                              : 'neutral'
                        }
                      >
                        {LABEL_STATUS[b.status]}
                      </Badge>
                    ),
                    // ⛔ `changed_by` adalah `text NOT NULL` TANPA FK ke
                    // `"user"` (`CLAUDE.md`) — yang menjaganya hanya
                    // `assertUserVisible` di server. Ditampilkan apa adanya;
                    // menerjemahkannya ke nama menuntut pencarian yang dapat
                    // gagal diam-diam untuk baris lama.
                    oleh: b.changedBy,
                    alasan: b.reason ?? '—',
                  }))}
                />
              )}
            </div>
          </Card>

          <span className="t-caption">
            Kolom Status dihitung dari jam perangkat ini, jadi ia perkiraan. Yang menentukan harga
            mana yang benar-benar dipakai kasir adalah angka di kartu paling atas — ia dihitung
            server dengan jam database.
          </span>
        </>
      ) : null}
    </div>
  );
}
