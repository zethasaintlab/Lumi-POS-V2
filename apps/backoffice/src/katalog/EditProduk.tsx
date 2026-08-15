import { useEffect, useState } from 'react';
import { Badge, Card, EmptyState, Icon, Table } from 'ds';
import { useSesi } from '../sesi.tsx';
import { GalatHttp } from '../http.ts';
import { Tombol } from '../Tombol.tsx';
import { Bidang } from '../Bidang.tsx';
import {
  buatMuatanItem,
  buatMuatanVariationBaru,
  buatMuatanVariationUbah,
  rupiah,
  type FormItem,
  type FormVariation,
  type Item,
  type ItemVariation,
} from './produk.ts';

/**
 * B-07 — Edit Produk + Variation (`IA:§3.3`). Layar DETAIL, dicapai dari B-06.
 *
 * ## ⛔⛔ HARGA VARIAN YANG SUDAH ADA TIDAK DAPAT DISUNTING DI SINI
 *
 * `item_variation.price` **beku setelah variation dibuat**
 * (`CLAUDE.md` § keputusan katalog): ia harga AWAL, anak tangga paling bawah
 * resolusi tiga tingkat. `updateItemVariation` tidak menerima `price` sama
 * sekali.
 *
 * Karena itu harga varian lama dirender sebagai **teks**, bukan `<input>`,
 * dengan jalan menuju B-10. Field yang terlihat dapat diketik lalu diam-diam
 * tidak terkirim adalah kebohongan antarmuka — merchant mengira harganya sudah
 * naik, kasir tetap menagih harga lama, dan tidak ada satu pun error di mana
 * pun. Ini kelas kegagalan yang sama dengan "test yang hijau karena hampa".
 *
 * `IA:425` menuntut **satu aksi utama per layar**, dan di sini itu "Simpan
 * produk".
 */

interface Kategori {
  id: string;
  name: string;
  archivedAt: string | null;
}

interface Props {
  item: Item;
  kategori: Kategori[];
  onKembali: () => void;
  onBerubah: () => Promise<void>;
}

const VARIAN_KOSONG: FormVariation = {
  nama: '',
  sku: '',
  barcode: '',
  harga: '',
  stockingUnit: 'pcs',
  sellingUnit: 'pcs',
  conversionFactor: '1',
  trackStock: false,
};

export function EditProduk({ item, kategori, onKembali, onBerubah }: Props) {
  const { api } = useSesi();

  // ⛔ Dimuat dengan `includeArchived=true`, dan yang terarsip TIDAK disaring.
  //
  // `Item.modifierLists` sendiri tidak menyaringnya — kontraknya menyatakan
  // itu eksplisit: list terarsip "membawa `archivedAt` sendiri, bukan
  // menghilang dari array". Kalau layar ini menyaringnya, kaitan yang sudah
  // tidak berlaku menjadi MUSTAHIL DILEPAS: ia tetap terkirim ke perangkat,
  // dan merchant tidak punya tombol untuk menghapusnya.
  const [daftarModifier, setDaftarModifier] = useState<
    { id: string; name: string; archivedAt: string | null }[]
  >([]);
  const [pesanKaitan, setPesanKaitan] = useState<string | null>(null);

  useEffect(() => {
    let batal = false;
    void (async () => {
      try {
        const hasil = await api.minta<{
          items: { id: string; name: string; archivedAt: string | null }[];
        }>('/modifier-lists?includeArchived=true');
        if (!batal) setDaftarModifier(hasil.items);
      } catch {
        // Kegagalan memuat daftar modifier TIDAK menjatuhkan layar produk.
        // Yang hilang hanya kemampuan mengaitkan; nama, kategori, dan varian
        // tetap dapat disunting.
      }
    })();
    return () => {
      batal = true;
    };
  }, [api]);

  async function ubahKaitan(modifierListId: string, sedangTerkait: boolean) {
    setPesanKaitan(null);
    try {
      const jalur = `/items/${item.id}/modifier-lists/${modifierListId}`;
      // ⛔ `DELETE` menjawab 204 TANPA SYARAT — ada atau tidak, milik tenant
      // ini atau bukan. Kontraknya menyebut alasannya: supaya ia tidak menjadi
      // oracle keberadaan lintas tenant. Jadi "berhasil" di sini tidak
      // membuktikan kaitannya pernah ada, dan layar memuat ulang alih-alih
      // menyimpulkan sendiri.
      await api.minta(jalur, sedangTerkait ? { metode: 'DELETE' } : { metode: 'POST', body: {} });
      await onBerubah();
    } catch (err) {
      setPesanKaitan(err instanceof GalatHttp ? err.message : 'Kaitan modifier tidak dapat diubah.');
    }
  }

  const [formItem, setFormItem] = useState<FormItem>({
    nama: item.name,
    categoryId: item.categoryId ?? '',
    deskripsi: item.description ?? '',
    sortOrder: String(item.sortOrder),
  });
  const [pesanItem, setPesanItem] = useState<string | null>(null);
  const [bidangItem, setBidangItem] = useState<keyof FormItem | null>(null);
  const [simpanItem, setSimpanItem] = useState(false);

  const [varian, setVarian] = useState<FormVariation>(VARIAN_KOSONG);
  const [ubahId, setUbahId] = useState<string | null>(null);
  const [pesanVarian, setPesanVarian] = useState<string | null>(null);
  const [bidangVarian, setBidangVarian] = useState<keyof FormVariation | null>(null);

  // Id varian dibuat sekali per form — `POST .../variations` menjawab 409
  // untuk id yang sama, dan itu yang menahan percobaan ulang jadi varian kedua.
  const [idVarian, setIdVarian] = useState(() => crypto.randomUUID());

  async function simpanProduk() {
    setPesanItem(null);
    setBidangItem(null);

    const hasil = buatMuatanItem(formItem, item.id);
    if (!hasil.ok) {
      setBidangItem(hasil.bidang);
      setPesanItem(hasil.pesan);
      return;
    }

    setSimpanItem(true);
    try {
      // `id` tidak dikirim pada PATCH — ia sudah ada di jalur.
      const { id: _id, ...tanpaId } = hasil.muatan;
      await api.minta(`/items/${item.id}`, { metode: 'PATCH', body: tanpaId });
      await onBerubah();
      setPesanItem('Tersimpan.');
    } catch (err) {
      setPesanItem(err instanceof GalatHttp ? err.message : 'Produk tidak dapat disimpan.');
    } finally {
      setSimpanItem(false);
    }
  }

  async function simpanVarian() {
    setPesanVarian(null);
    setBidangVarian(null);

    const hasil =
      ubahId === null
        ? buatMuatanVariationBaru(varian, idVarian)
        : buatMuatanVariationUbah(varian);

    if (!hasil.ok) {
      setBidangVarian(hasil.bidang);
      setPesanVarian(hasil.pesan);
      return;
    }

    try {
      if (ubahId === null) {
        await api.minta(`/items/${item.id}/variations`, { metode: 'POST', body: hasil.muatan });
        setIdVarian(crypto.randomUUID());
      } else {
        await api.minta(`/items/${item.id}/variations/${ubahId}`, {
          metode: 'PATCH',
          body: hasil.muatan,
        });
      }
      setVarian(VARIAN_KOSONG);
      setUbahId(null);
      await onBerubah();
    } catch (err) {
      // `BARCODE_DUPLICATE` dan batas 250 varian keduanya mendarat di sini.
      setPesanVarian(err instanceof GalatHttp ? err.message : 'Varian tidak dapat disimpan.');
    }
  }

  async function ubahArsipVarian(v: ItemVariation) {
    setPesanVarian(null);
    try {
      const jalur = v.archivedAt ? 'restore' : 'archive';
      await api.minta(`/items/${item.id}/variations/${v.id}/${jalur}`, {
        metode: 'POST',
        body: {},
      });
      setUbahId((k) => (k === v.id ? null : k));
      await onBerubah();
    } catch (err) {
      setPesanVarian(err instanceof GalatHttp ? err.message : 'Status varian tidak dapat diubah.');
    }
  }

  async function ubahArsipProduk() {
    setPesanItem(null);
    try {
      const jalur = item.archivedAt ? 'restore' : 'archive';
      await api.minta(`/items/${item.id}/${jalur}`, { metode: 'POST', body: {} });
      await onBerubah();
    } catch (err) {
      setPesanItem(err instanceof GalatHttp ? err.message : 'Status produk tidak dapat diubah.');
    }
  }

  const galatItem = (b: keyof FormItem) => (bidangItem === b ? (pesanItem ?? undefined) : undefined);
  const galatVarian = (b: keyof FormVariation) =>
    bidangVarian === b ? (pesanVarian ?? undefined) : undefined;

  return (
    <div className="stack" style={{ gap: 'var(--space-4)', maxWidth: '96ch' }}>
      <div className="row between">
        <div className="stack" style={{ gap: 'var(--space-1)' }}>
          <span className="t-title">{item.name}</span>
          <span className="t-caption">Produk · {item.variations.length} varian</span>
        </div>
        <Tombol onClick={onKembali}>← Kembali ke daftar</Tombol>
      </div>

      {/* --- produk --------------------------------------------------------- */}
      <Card>
        <div className="card-pad">
          <div className="stack" style={{ gap: 'var(--space-4)' }}>
            <span className="t-body-md">Detail produk</span>

            <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
              <div className="grow">
                <Bidang
                  id="nama-produk"
                  label="Nama"
                  value={formItem.nama}
                  required
                  error={galatItem('nama')}
                  onChange={(v) => {
                    setFormItem((f) => ({ ...f, nama: v }));
                    setPesanItem(null);
                  }}
                />
              </div>
              <div style={{ width: '12ch' }}>
                <Bidang
                  id="urutan-produk"
                  label="Urutan"
                  value={formItem.sortOrder}
                  error={galatItem('sortOrder')}
                  onChange={(v) => {
                    setFormItem((f) => ({ ...f, sortOrder: v.replace(/\D/g, '') }));
                    setPesanItem(null);
                  }}
                />
              </div>
            </div>

            <Bidang
              id="deskripsi"
              label="Deskripsi (opsional)"
              value={formItem.deskripsi}
              onChange={(v) => setFormItem((f) => ({ ...f, deskripsi: v }))}
            />

            <div className="stack" style={{ gap: 'var(--space-2)' }}>
              <span className="label">Kategori</span>
              <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                <Tombol
                  varian={formItem.categoryId === '' ? 'primary' : 'secondary'}
                  onClick={() => setFormItem((f) => ({ ...f, categoryId: '' }))}
                >
                  Tanpa kategori
                </Tombol>
                {kategori
                  .filter((k) => k.archivedAt === null)
                  .map((k) => (
                    <Tombol
                      key={k.id}
                      varian={formItem.categoryId === k.id ? 'primary' : 'secondary'}
                      onClick={() => setFormItem((f) => ({ ...f, categoryId: k.id }))}
                    >
                      {k.name}
                    </Tombol>
                  ))}
              </div>
            </div>

            {/* ⛔ Modifier dikaitkan ke ITEM, bukan ke varian.
                `attachModifierList` ber-URL `/items/{itemId}/modifier-lists/
                {modifierListId}` — tidak ada variationId di dalamnya sama
                sekali. Menaruh tombolnya di baris varian akan menjanjikan
                cakupan yang tidak dimiliki endpointnya: kasir melihat modifier
                yang sama untuk SETIAP varian produk ini. */}
            <div className="stack" style={{ gap: 'var(--space-2)' }}>
              <span className="label">Modifier</span>
              {daftarModifier.length === 0 ? (
                <span className="t-caption">
                  Belum ada daftar modifier. Buat dulu di layar Modifier, lalu kaitkan dari sini.
                </span>
              ) : (
                <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  {daftarModifier.map((m) => {
                    const terkait = item.modifierLists.some((x) => x.id === m.id);
                    return (
                      <Tombol
                        key={m.id}
                        varian={terkait ? 'primary' : 'secondary'}
                        onClick={() => void ubahKaitan(m.id, terkait)}
                      >
                        {terkait ? '✓ ' : ''}
                        {m.name}
                        {m.archivedAt ? ' (diarsipkan)' : ''}
                      </Tombol>
                    );
                  })}
                </div>
              )}
              <span className="t-caption">
                Berlaku untuk seluruh varian produk ini — modifier menempel pada produk, bukan pada
                varian.
              </span>
              {pesanKaitan ? (
                <span className="t-caption" style={{ color: 'var(--danger)' }} role="alert">
                  {pesanKaitan}
                </span>
              ) : null}
            </div>

            <div className="row" style={{ gap: 'var(--space-3)' }}>
              {/* `IA:425` — satu aksi utama per layar. */}
              <Tombol varian="primary" disabled={simpanItem} onClick={() => void simpanProduk()}>
                {simpanItem ? 'Menyimpan…' : 'Simpan produk'}
              </Tombol>
              <Tombol
                varian={item.archivedAt ? 'secondary' : 'danger'}
                onClick={() => void ubahArsipProduk()}
              >
                {item.archivedAt ? 'Pulihkan produk' : 'Arsipkan produk'}
              </Tombol>
              {pesanItem && bidangItem === null ? (
                <span className="t-caption" role="status">
                  {pesanItem}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </Card>

      {/* --- varian --------------------------------------------------------- */}
      <Card>
        <div className="card-pad">
          <div className="stack" style={{ gap: 'var(--space-4)' }}>
            <span className="t-body-md">
              {ubahId === null ? 'Tambah varian' : 'Ubah varian'}
            </span>

            <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
              <div className="grow">
                <Bidang
                  id="nama-varian"
                  label="Nama varian"
                  value={varian.nama}
                  required
                  error={galatVarian('nama')}
                  onChange={(v) => {
                    setVarian((f) => ({ ...f, nama: v }));
                    setPesanVarian(null);
                  }}
                />
              </div>
              <div style={{ width: '16ch' }}>
                <Bidang
                  id="sku"
                  label="SKU"
                  value={varian.sku}
                  onChange={(v) => setVarian((f) => ({ ...f, sku: v }))}
                />
              </div>
              <div style={{ width: '18ch' }}>
                <Bidang
                  id="barcode"
                  label="Barcode"
                  value={varian.barcode}
                  onChange={(v) => setVarian((f) => ({ ...f, barcode: v }))}
                />
              </div>
            </div>

            {/* ⛔⛔ HARGA: field HANYA saat membuat. Saat mengubah, ia TEKS. */}
            {ubahId === null ? (
              <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
                <div style={{ width: '20ch' }}>
                  <Bidang
                    id="harga"
                    label="Harga awal"
                    value={varian.harga}
                    required
                    error={galatVarian('harga')}
                    onChange={(v) => {
                      setVarian((f) => ({ ...f, harga: v }));
                      setPesanVarian(null);
                    }}
                  />
                </div>
                <span className="t-caption grow">
                  Rupiah utuh, tanpa desimal. Harga ini <strong>tidak dapat diubah lagi</strong>{' '}
                  setelah varian dibuat — perubahan berikutnya dicatat sebagai riwayat harga per
                  outlet di layar Harga.
                </span>
              </div>
            ) : (
              <div className="stack" style={{ gap: 'var(--space-1)' }}>
                <span className="label">Harga awal</span>
                {/* Teks, bukan input. Lihat catatan di kepala berkas. */}
                <span className="t-body-md num">{varian.harga}</span>
                <span className="t-caption">
                  Harga awal beku setelah varian dibuat. Untuk menyesuaikan harga jual, buka layar{' '}
                  <strong>Harga</strong> (B-10) — perubahannya dicatat per outlet beserta tanggal
                  berlakunya, dan transaksi lama tetap memakai harga yang berlaku saat itu.
                </span>
              </div>
            )}

            <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
              <div style={{ width: '14ch' }}>
                <Bidang
                  id="unit-stok"
                  label="Satuan stok"
                  value={varian.stockingUnit}
                  onChange={(v) => setVarian((f) => ({ ...f, stockingUnit: v }))}
                />
              </div>
              <div style={{ width: '14ch' }}>
                <Bidang
                  id="unit-jual"
                  label="Satuan jual"
                  value={varian.sellingUnit}
                  onChange={(v) => setVarian((f) => ({ ...f, sellingUnit: v }))}
                />
              </div>
              <div style={{ width: '14ch' }}>
                <Bidang
                  id="konversi"
                  label="Konversi"
                  value={varian.conversionFactor}
                  error={galatVarian('conversionFactor')}
                  onChange={(v) => {
                    setVarian((f) => ({ ...f, conversionFactor: v }));
                    setPesanVarian(null);
                  }}
                />
              </div>
              <span className="t-caption grow">
                Berapa satuan jual dalam satu satuan stok. Isi <span className="num">1</span> bila
                keduanya sama. Tidak boleh nol.
              </span>
            </div>

            <div className="row" style={{ gap: 'var(--space-2)' }}>
              <Tombol
                varian={varian.trackStock ? 'primary' : 'secondary'}
                onClick={() => setVarian((f) => ({ ...f, trackStock: !f.trackStock }))}
              >
                {varian.trackStock ? 'Stok dilacak' : 'Stok tidak dilacak'}
              </Tombol>
            </div>

            <div className="row" style={{ gap: 'var(--space-3)' }}>
              <Tombol varian="primary" onClick={() => void simpanVarian()}>
                {ubahId === null ? 'Tambah varian' : 'Simpan varian'}
              </Tombol>
              {ubahId !== null ? (
                <Tombol
                  onClick={() => {
                    setUbahId(null);
                    setVarian(VARIAN_KOSONG);
                    setPesanVarian(null);
                  }}
                >
                  Batal
                </Tombol>
              ) : null}
              {pesanVarian && bidangVarian === null ? (
                <span className="t-caption" style={{ color: 'var(--danger)' }} role="alert">
                  {pesanVarian}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </Card>

      {/* --- daftar varian --------------------------------------------------- */}
      <Card>
        <div className="card-pad">
          {item.variations.length === 0 ? (
            <EmptyState
              icon={<Icon name="layers" size={32} />}
              title="Belum ada varian"
              body="Produk tanpa varian tidak muncul di grid kasir sama sekali — yang dijual adalah variannya, bukan produknya. Tambahkan minimal satu."
            />
          ) : (
            <Table
              columns={[
                { key: 'nama', header: 'Varian' },
                { key: 'sku', header: 'SKU / Barcode' },
                { key: 'harga', header: 'Harga awal', align: 'right' },
                { key: 'stok', header: 'Stok' },
                { key: 'status', header: 'Status' },
                { key: 'aksi', header: '', align: 'right' },
              ]}
              rows={item.variations.map((v) => ({
                nama: v.name,
                sku: [v.sku, v.barcode].filter(Boolean).join(' · ') || '—',
                harga: <span className="num">{rupiah(v.price)}</span>,
                stok: v.trackStock ? (
                  <Badge tone="success">Dilacak</Badge>
                ) : (
                  <Badge tone="neutral">Tidak dilacak</Badge>
                ),
                status: v.archivedAt ? (
                  <Badge tone="neutral">Diarsipkan</Badge>
                ) : (
                  <Badge tone="success">Aktif</Badge>
                ),
                aksi: (
                  <div className="row" style={{ gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                    {v.archivedAt ? null : (
                      <Tombol
                        onClick={() => {
                          setUbahId(v.id);
                          setPesanVarian(null);
                          setVarian({
                            nama: v.name,
                            sku: v.sku ?? '',
                            barcode: v.barcode ?? '',
                            // Ditampilkan sebagai TEKS terformat, bukan diketik
                            // ulang — ia tidak akan pernah dikirim.
                            harga: rupiah(v.price),
                            stockingUnit: v.stockingUnit ?? 'pcs',
                            sellingUnit: v.sellingUnit ?? 'pcs',
                            conversionFactor: String(v.conversionFactor ?? 1),
                            trackStock: v.trackStock === true,
                          });
                        }}
                      >
                        Ubah
                      </Tombol>
                    )}
                    <Tombol
                      varian={v.archivedAt ? 'secondary' : 'danger'}
                      onClick={() => void ubahArsipVarian(v)}
                    >
                      {v.archivedAt ? 'Pulihkan' : 'Arsipkan'}
                    </Tombol>
                  </div>
                ),
              }))}
            />
          )}
        </div>
      </Card>

      <span className="t-caption">
        Produk dan varian tidak pernah dihapus, hanya diarsipkan. Riwayat penjualan menunjuknya, dan
        struk lama harus tetap dapat menyebut nama yang dipakai saat transaksi terjadi.
      </span>
    </div>
  );
}
