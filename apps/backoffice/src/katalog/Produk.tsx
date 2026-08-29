import { useCallback, useEffect, useState } from 'react';
import { Badge, Card, EmptyState, Icon, Table } from 'ds';
import { useSesi } from '../../../../packages/klien-api/src/sesi.tsx';
import { GalatHttp } from '../../../../packages/klien-api/src/http.ts';
import { Tombol } from '../Tombol.tsx';
import { Bidang } from '../Bidang.tsx';
import { EditProduk } from './EditProduk.tsx';
import { buatMuatanProdukBaru, kueriDaftarProduk, TANPA_KATEGORI, type FormVariation, type Item } from './produk.ts';
import { rupiah } from '../../../../packages/domain/src/uang-tampilan.ts';

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
  /* ⛔ Kueri yang DIKIRIM, terpisah dari yang sedang diketik. Tanpa jeda,
     setiap ketukan huruf adalah satu perjalanan pulang-pergi — dan yang
     terakhir berangkat belum tentu yang terakhir kembali. */
  const [cariDikirim, setCariDikirim] = useState('');
  const [tampilArsip, setTampilArsip] = useState(false);
  /* Kursor keyset halaman berikutnya; `null` = katalog sudah habis. */
  const [kursor, setKursor] = useState<string | null>(null);
  const [memuatLagi, setMemuatLagi] = useState(false);
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

  /* ⛔ Ukuran halaman. Server membatasi `limit` ke 200 (`BATAS_MAKS_ITEM`);
   angka di sini jauh di bawahnya supaya perjalanan pertama tetap cepat pada
   koneksi outlet, dan "Muat lebih banyak" menjadi langkah yang terlihat
   alih-alih daftar yang diam-diam terpotong. */
const BATAS_HALAMAN = 50;

/** `null` = daftar (B-06). Berisi id = detail (B-07). */
  const [buka, setBuka] = useState<string | null>(null);

  const muat = useCallback(async () => {
    setKeadaan({ jenis: 'memuat' });
    try {
      /* ⛔ SELURUH saringan dikirim ke server — `q`, `categoryId`, dan
         `includeArchived`. Memuat satu halaman lalu menyaring di klien
         menghasilkan pencarian yang hanya menemukan apa yang KEBETULAN sudah
         dimuat: merchant mengetik barcode produk ke-300, tidak ada yang
         muncul, tanpa satu pun error. */
      const [i, k] = await Promise.all([
        api.minta<{ items: Item[]; nextCursor?: string | null }>(
          kueriDaftarProduk({ kategoriId, cari: cariDikirim, tampilArsip }, { limit: BATAS_HALAMAN })
        ),
        api.minta<{ items: Kategori[] }>('/categories?includeArchived=true'),
      ]);
      setSemua(i.items);
      setKursor(i.nextCursor ?? null);
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
  }, [api, kategoriId, cariDikirim, tampilArsip]);

  useEffect(() => {
    void muat();
  }, [muat]);

  /* ⛔ Jeda ketik 300 ms. Tanpa itu, "kopi susu" adalah sembilan permintaan,
     dan urutan kembalinya tidak dijamin — hasil untuk "kop" dapat mendarat
     SESUDAH hasil untuk "kopi susu" dan menimpanya. */
  useEffect(() => {
    const t = setTimeout(() => setCariDikirim(cari), 300);
    return () => clearTimeout(t);
  }, [cari]);

  /* Halaman berikutnya. ⛔ Ia MENAMBAH, bukan mengganti — dan kursornya milik
     saringan yang sedang aktif: setiap perubahan saringan memuat ulang dari
     awal lewat `muat`, yang mengosongkan kursornya sendiri. */
  const muatLagi = useCallback(async () => {
    if (kursor === null) return;
    setMemuatLagi(true);
    try {
      const i = await api.minta<{ items: Item[]; nextCursor?: string | null }>(
        kueriDaftarProduk(
          { kategoriId, cari: cariDikirim, tampilArsip },
          { limit: BATAS_HALAMAN, after: kursor }
        )
      );
      setSemua((lama) => [...lama, ...i.items]);
      setKursor(i.nextCursor ?? null);
    } catch (err) {
      setPesan(
        err instanceof GalatHttp ? err.message : 'Tidak dapat memuat halaman berikutnya.'
      );
    } finally {
      setMemuatLagi(false);
    }
  }, [api, kursor, kategoriId, cariDikirim, tampilArsip]);

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

  /* ⛔ TIDAK disaring lagi di sini. Server sudah melakukannya, dan menyaring
     dua kali berarti dua aturan yang harus dijaga sepakat — persis kelas cacat
     yang membuat pencarian berhenti menemukan barcode. */
  const terlihat = semua;
  /* Apakah daftar sedang disaring. Dipakai membedakan "katalog kosong" dari
     "tidak ada yang cocok" — dua keadaan kosong yang mengarahkan merchant ke
     tempat yang berbeda. */
  const adaSaringan = cariDikirim.trim() !== '' || kategoriId !== null;
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
              /* ⛔ Dua keadaan kosong yang BERBEDA, dan membedakannya penting:
                 "belum ada produk" mengarahkan merchant ke impor katalog,
                 sementara "tidak ada yang cocok" mengarahkannya mengubah
                 pencarian. Satu kalimat untuk keduanya salah untuk salah
                 satunya.

                 Sejak pencarian pindah ke server, `semua.length === 0` tidak
                 lagi berarti "katalog kosong" — ia berarti "halaman ini
                 kosong". Yang membedakannya adalah ada-tidaknya saringan. */
              title={adaSaringan ? 'Tidak ada yang cocok' : 'Belum ada produk'}
              body={
                adaSaringan
                  ? 'Ubah kata pencarian atau pilih kategori lain. Produk yang diarsipkan disembunyikan kecuali toggle di atas dinyalakan.'
                  : 'Tambahkan produk satu per satu, atau impor seluruh katalog sekaligus lewat Impor katalog.'
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

          {/* ⛔ Katalog yang TERPOTONG dinyatakan, bukan didiamkan. Daftar
              yang berhenti di 50 tanpa berkata apa-apa membuat merchant
              menyimpulkan produknya hilang — dan mencarinya di tempat yang
              salah. */}
          {keadaan.jenis === 'siap' && kursor !== null && (
            <div
              className="row"
              style={{ gap: 'var(--space-3)', alignItems: 'center', marginTop: 'var(--space-4)' }}
            >
              <Tombol disabled={memuatLagi} onClick={() => void muatLagi()}>
                {memuatLagi ? 'Memuat…' : 'Muat lebih banyak'}
              </Tombol>
              <span className="t-caption">
                Menampilkan <span className="num">{terlihat.length}</span> produk pertama. Gunakan
                pencarian untuk menemukan produk tertentu — pencarian mencakup{' '}
                <strong>seluruh</strong> katalog, bukan hanya yang tampil.
              </span>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
