import { useCallback, useEffect, useState } from 'react';
import { Badge, Card, EmptyState, Icon, Table } from 'ds';
import { useSesi } from '../sesi.tsx';
import { GalatHttp } from '../http.ts';
import { Tombol } from '../Tombol.tsx';
import { Bidang } from '../Bidang.tsx';
import { EditProduk } from './EditProduk.tsx';
import {
  buatMuatanProdukBaru,
  rupiah,
  saringProduk,
  TANPA_KATEGORI,
  type FormVariation,
  type Item,
} from './produk.ts';

/** Nilai bawaan varian pertama. Sisanya disunting di B-07. */
const VARIAN_PERTAMA: FormVariation = {
  nama: 'Regular',
  sku: '',
  barcode: '',
  harga: '',
  stockingUnit: 'pcs',
  sellingUnit: 'pcs',
  conversionFactor: '1',
  trackStock: false,
};

/**
 * B-06 — Produk, daftar (`IA:§3.3`, akses minimum Manajer Area).
 *
 * B-07 (Edit Produk + Variation) adalah layar DETAIL yang dicapai dari sini,
 * bukan dari menu — `IA:§3.3` menaruhnya di luar sidebar justru karena itu.
 * Keduanya hidup di satu komponen induk: yang berpindah adalah isinya, bukan
 * alamatnya, mengikuti pola aplikasi ini yang memilih layar lewat keadaan.
 *
 * ## ⛔ Harga yang ditampilkan adalah harga AWAL variation
 *
 * Ia anak tangga paling bawah resolusi tiga tingkat. Harga yang benar-benar
 * ditagih kasir dapat berbeda — `price_history` per outlet menimpanya (B-10).
 * Kolomnya karena itu diberi judul "Harga awal", bukan "Harga": judul yang
 * salah di sini membuat merchant menyimpulkan harganya belum naik padahal
 * sudah.
 */

interface Kategori {
  id: string;
  name: string;
  archivedAt: string | null;
}

type Keadaan = { jenis: 'memuat' } | { jenis: 'siap' } | { jenis: 'galat'; pesan: string };

export function ProdukLayar() {
  const { api } = useSesi();
  const [keadaan, setKeadaan] = useState<Keadaan>({ jenis: 'memuat' });
  const [semua, setSemua] = useState<Item[]>([]);
  const [kategori, setKategori] = useState<Kategori[]>([]);
  const [kategoriId, setKategoriId] = useState<string | null>(null);
  const [cari, setCari] = useState('');
  const [tampilArsip, setTampilArsip] = useState(false);
  const [pesan, setPesan] = useState<string | null>(null);

  const [namaBaru, setNamaBaru] = useState('');
  const [namaVarianBaru, setNamaVarianBaru] = useState('');
  const [hargaBaru, setHargaBaru] = useState('');
  const [bidangBaru, setBidangBaru] = useState<string | null>(null);
  // Id dibuat sekali per form — `POST /items` menjawab 409 untuk id yang sama,
  // dan itu yang menahan percobaan ulang jadi produk kedua bernama sama.
  const [idBaru, setIdBaru] = useState(() => ({
    item: crypto.randomUUID(),
    varian: crypto.randomUUID(),
  }));

  /** `null` = daftar (B-06). Berisi id = detail (B-07). */
  const [buka, setBuka] = useState<string | null>(null);

  const muat = useCallback(async () => {
    setKeadaan({ jenis: 'memuat' });
    try {
      const [i, k] = await Promise.all([
        // includeArchived: penyaringan terarsip dilakukan di klien supaya
        // toggle tidak menuntut perjalanan pulang-pergi, dan supaya produk
        // terarsip tetap dapat dibuka lewat tautannya.
        api.minta<{ items: Item[] }>('/items?includeArchived=true'),
        api.minta<{ items: Kategori[] }>('/categories?includeArchived=true'),
      ]);
      setSemua(i.items);
      setKategori(k.items);
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

  async function tambahProduk() {
    setPesan(null);
    setBidangBaru(null);

    // ⛔ Varian pertama IKUT, bukan menyusul.
    //
    // `POST /items` menolak item tanpa variation (`ITEM_NO_VARIATION`) —
    // ditemukan dengan menjalankannya, bukan dengan membaca. Alasannya produk,
    // bukan teknis: yang dijual kasir adalah varian, jadi produk tanpa varian
    // tidak dapat dijual siapa pun.
    //
    // Harga di form ini adalah harga varian BARU, jadi ia memang boleh
    // diketik. Yang tidak boleh diketik adalah harga varian yang sudah ada —
    // lihat `EditProduk.tsx`.
    const hasil = buatMuatanProdukBaru(
      {
        nama: namaBaru,
        categoryId: kategoriId === null || kategoriId === TANPA_KATEGORI ? '' : kategoriId,
        deskripsi: '',
        sortOrder: '0',
      },
      { ...VARIAN_PERTAMA, nama: namaVarianBaru.trim() || 'Regular', harga: hargaBaru },
      { itemId: idBaru.item, variationId: idBaru.varian }
    );
    if (!hasil.ok) {
      setBidangBaru(hasil.bidang);
      setPesan(hasil.pesan);
      return;
    }

    try {
      await api.minta('/items', { metode: 'POST', body: hasil.muatan });
      setNamaBaru('');
      setNamaVarianBaru('');
      setHargaBaru('');
      setIdBaru({ item: crypto.randomUUID(), varian: crypto.randomUUID() });
      await muat();
      setBuka(hasil.muatan.id);
    } catch (err) {
      // Penolakan kuota `max_products` mendarat di sini, dan pesan server
      // MEMBAWA ANGKANYA (terpakai/batas).
      setPesan(err instanceof GalatHttp ? err.message : 'Produk tidak dapat dibuat.');
    }
  }

  if (buka !== null) {
    const item = semua.find((i) => i.id === buka);
    if (item) {
      return (
        <EditProduk
          item={item}
          kategori={kategori}
          onKembali={() => {
            setBuka(null);
            void muat();
          }}
          onBerubah={muat}
        />
      );
    }
    // Produknya hilang dari daftar (diarsipkan di tab lain, atau daftar dimuat
    // ulang tanpa yang terarsip). Kembali, bukan layar kosong tanpa jalan.
    setBuka(null);
  }

  const terlihat = saringProduk(semua, { kategoriId, cari, tampilArsip });
  const namaKategori = (id: string | null) =>
    id === null ? '—' : (kategori.find((k) => k.id === id)?.name ?? id);

  return (
    <div className="stack" style={{ gap: 'var(--space-4)', maxWidth: '96ch' }}>
      <div className="stack" style={{ gap: 'var(--space-1)' }}>
        <span className="t-title">Produk</span>
        <span className="t-caption">
          Setiap produk punya satu atau lebih varian. Yang muncul di grid kasir adalah variannya.
        </span>
      </div>

      {/* --- saringan ------------------------------------------------------ */}
      <Card>
        <div className="card-pad">
          <div className="stack" style={{ gap: 'var(--space-4)' }}>
            <Bidang
              id="cari"
              label="Cari nama, SKU, atau barcode"
              value={cari}
              onChange={setCari}
            />

            <div className="stack" style={{ gap: 'var(--space-2)' }}>
              <span className="label">Kategori</span>
              <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                <Tombol
                  varian={kategoriId === null ? 'primary' : 'secondary'}
                  onClick={() => setKategoriId(null)}
                >
                  Semua
                </Tombol>
                <Tombol
                  varian={kategoriId === TANPA_KATEGORI ? 'primary' : 'secondary'}
                  onClick={() => setKategoriId(TANPA_KATEGORI)}
                >
                  Tanpa kategori
                </Tombol>
                {kategori
                  .filter((k) => k.archivedAt === null)
                  .map((k) => (
                    <Tombol
                      key={k.id}
                      varian={kategoriId === k.id ? 'primary' : 'secondary'}
                      onClick={() => setKategoriId(k.id)}
                    >
                      {k.name}
                    </Tombol>
                  ))}
              </div>
            </div>

            <Tombol onClick={() => setTampilArsip((v) => !v)}>
              {tampilArsip ? 'Sembunyikan yang diarsipkan' : 'Tampilkan yang diarsipkan'}
            </Tombol>
          </div>
        </div>
      </Card>

      {/* --- tambah produk -------------------------------------------------- */}
      <Card>
        <div className="card-pad">
          <div className="stack" style={{ gap: 'var(--space-4)' }}>
            <span className="t-body-md">Tambah produk</span>
            {/* ⛔ Varian pertama diminta di sini, bukan menyusul. Produk tanpa
                varian tidak dapat dijual siapa pun, dan server menolaknya
                (`ITEM_NO_VARIATION`). */}
            <span className="t-caption">
              Yang muncul di grid kasir adalah varian, bukan produknya. Varian pertama karena itu
              diisi sekarang — sisanya dapat ditambahkan setelah produk terbuka.
            </span>

            <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
              <div className="grow">
                <Bidang
                  id="nama-baru"
                  label="Nama produk"
                  value={namaBaru}
                  required
                  error={bidangBaru === 'nama' ? (pesan ?? undefined) : undefined}
                  onChange={(v) => {
                    setNamaBaru(v);
                    setPesan(null);
                    setBidangBaru(null);
                  }}
                />
              </div>
              <div style={{ width: '18ch' }}>
                <Bidang
                  id="nama-varian-baru"
                  label="Varian pertama"
                  value={namaVarianBaru}
                  onChange={setNamaVarianBaru}
                />
              </div>
              <div style={{ width: '18ch' }}>
                <Bidang
                  id="harga-baru"
                  label="Harga awal"
                  value={hargaBaru}
                  required
                  error={bidangBaru === 'harga' ? (pesan ?? undefined) : undefined}
                  onChange={(v) => {
                    setHargaBaru(v);
                    setPesan(null);
                    setBidangBaru(null);
                  }}
                />
              </div>
            </div>

            <div className="row" style={{ gap: 'var(--space-3)' }}>
              <Tombol varian="primary" onClick={() => void tambahProduk()}>
                Tambah produk
              </Tombol>
              <span className="t-caption grow">
                Kosongkan nama varian untuk memakai &ldquo;Regular&rdquo;.
              </span>
              {pesan && bidangBaru === null ? (
                <span className="t-caption" style={{ color: 'var(--danger)' }} role="alert">
                  {pesan}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </Card>

      {/* --- daftar --------------------------------------------------------- */}
      <Card>
        <div className="card-pad">
          {keadaan.jenis === 'galat' ? (
            <EmptyState
              icon={<Icon name="alert" size={32} />}
              title="Daftar produk tidak dapat dimuat"
              body={keadaan.pesan}
              action={<Tombol onClick={() => void muat()}>Coba lagi</Tombol>}
            />
          ) : terlihat.length === 0 && keadaan.jenis === 'siap' ? (
            <EmptyState
              icon={<Icon name="package" size={32} />}
              title={semua.length === 0 ? 'Belum ada produk' : 'Tidak ada yang cocok'}
              body={
                semua.length === 0
                  ? 'Tambahkan produk satu per satu, atau impor seluruh katalog sekaligus lewat Impor katalog.'
                  : 'Ubah kata pencarian atau pilih kategori lain. Produk yang diarsipkan disembunyikan kecuali toggle di atas dinyalakan.'
              }
            />
          ) : (
            <Table
              columns={[
                { key: 'nama', header: 'Produk' },
                { key: 'kategori', header: 'Kategori' },
                { key: 'varian', header: 'Varian', align: 'right' },
                // ⛔ "Harga awal", bukan "Harga". Yang ditagih kasir dapat
                // berbeda — `price_history` per outlet menimpanya (B-10).
                { key: 'harga', header: 'Harga awal', align: 'right' },
                { key: 'status', header: 'Status' },
                { key: 'aksi', header: '', align: 'right' },
              ]}
              rows={terlihat.map((item) => {
                const aktif = item.variations.filter((v) => v.archivedAt === null);
                const harga = aktif.map((v) => Number(v.price));
                const rentang =
                  harga.length === 0
                    ? '—'
                    : Math.min(...harga) === Math.max(...harga)
                      ? rupiah(Math.min(...harga))
                      : `${rupiah(Math.min(...harga))} – ${rupiah(Math.max(...harga))}`;

                return {
                  nama: item.name,
                  kategori: namaKategori(item.categoryId),
                  varian: <span className="num">{aktif.length}</span>,
                  harga: <span className="num">{rentang}</span>,
                  status: item.archivedAt ? (
                    <Badge tone="neutral">Diarsipkan</Badge>
                  ) : aktif.length === 0 ? (
                    // ⛔ Produk tanpa varian aktif TIDAK DAPAT DIJUAL — ia
                    // tidak muncul di grid kasir sama sekali. Tanpa penanda
                    // ini, merchant melihat produknya terdaftar dan menyimpulkan
                    // kasir seharusnya dapat menjualnya.
                    <Badge tone="warning">Tanpa varian aktif</Badge>
                  ) : (
                    <Badge tone="success">Aktif</Badge>
                  ),
                  aksi: <Tombol onClick={() => setBuka(item.id)}>Buka</Tombol>,
                };
              })}
            />
          )}
        </div>
      </Card>
    </div>
  );
}
