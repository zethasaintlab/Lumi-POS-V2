import { useCallback, useEffect, useState } from 'react';
import { Badge, Card, EmptyState, Icon, Table } from 'ds';
import { useSesi } from '../../../../packages/klien-api/src/sesi.tsx';
import { GalatHttp } from '../../../../packages/klien-api/src/http.ts';
import { Tombol } from '../Tombol.tsx';
import { Bidang } from '../Bidang.tsx';
import { susunPohon, indukYangBoleh, type Kategori } from './pohon.ts';

/**
 * B-08 — Kategori (`IA:§3.3`, akses minimum Manajer Area).
 *
 * ## ⛔ "Arsipkan", bukan "Hapus"
 *
 * Invariant #2: katalog tidak pernah di-`DELETE`, hanya `archived_at`. Kata
 * "Hapus" di tombol adalah janji yang tidak ditepati kode — dan merchant yang
 * mengiranya permanen akan terkejut menemukan kategorinya masih menempel di
 * riwayat penjualan.
 *
 * Yang terarsip tetap dapat dilihat (toggle) dan dipulihkan.
 *
 * ## ⛔ Dua tingkat, ditolak sebelum dikirim
 *
 * Server menjawab `409` untuk tingkat ketiga. Pemilih induk di sini hanya
 * menawarkan yang benar-benar dapat diterima (`indukYangBoleh`), dan saat
 * daftarnya kosong ia menjelaskan alasannya alih-alih menampilkan pemilih yang
 * setiap pilihannya gagal.
 */

type Keadaan = { jenis: 'memuat' } | { jenis: 'siap' } | { jenis: 'galat'; pesan: string };

interface Sunting {
  id: string | null;
  name: string;
  parentId: string | null;
  sortOrder: string;
}

const BARU: Sunting = { id: null, name: '', parentId: null, sortOrder: '0' };

export function KategoriLayar() {
  const { api } = useSesi();
  const [keadaan, setKeadaan] = useState<Keadaan>({ jenis: 'memuat' });
  const [semua, setSemua] = useState<Kategori[]>([]);
  const [tampilArsip, setTampilArsip] = useState(false);
  const [sunting, setSunting] = useState<Sunting>(BARU);
  const [pesan, setPesan] = useState<string | null>(null);
  const [sedangKirim, setSedangKirim] = useState(false);

  // ⛔ Id dibuat sekali per form, bukan per penekanan tombol. `POST
  // /categories` menjawab 409 ID_ALREADY_EXISTS untuk id yang sama — itu yang
  // membuat percobaan ulang setelah respons hilang tidak menghasilkan kategori
  // kedua bernama sama.
  const [idBaru, setIdBaru] = useState(() => crypto.randomUUID());

  const muat = useCallback(async () => {
    setKeadaan({ jenis: 'memuat' });
    try {
      // ⛔ SELALU memuat yang terarsip juga. Toggle di bawah hanya menyaring
      // tampilan — kalau server yang menyaring, kategori terarsip yang menjadi
      // induk kategori aktif hilang dari daftar, dan anaknya melompat jadi
      // akar tanpa penjelasan.
      const hasil = await api.minta<{ items: Kategori[] }>('/categories?includeArchived=true');
      setSemua(hasil.items);
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
    const nama = sunting.name.trim();
    if (nama.length === 0) {
      setPesan('Nama kategori wajib diisi.');
      return;
    }

    const urutan = Number.parseInt(sunting.sortOrder, 10);
    if (!Number.isFinite(urutan) || urutan < 0) {
      setPesan('Urutan harus angka 0 atau lebih.');
      return;
    }

    setSedangKirim(true);
    try {
      if (sunting.id === null) {
        await api.minta('/categories', {
          metode: 'POST',
          body: { id: idBaru, name: nama, parentId: sunting.parentId, sortOrder: urutan },
        });
        setIdBaru(crypto.randomUUID());
      } else {
        await api.minta(`/categories/${sunting.id}`, {
          metode: 'PATCH',
          body: { name: nama, parentId: sunting.parentId, sortOrder: urutan },
        });
      }
      setSunting(BARU);
      await muat();
    } catch (err) {
      // Penolakan tingkat ketiga (`409`) dan kuota keduanya mendarat di sini,
      // dan pesan server membawa konteksnya.
      setPesan(err instanceof GalatHttp ? err.message : 'Kategori tidak dapat disimpan.');
    } finally {
      setSedangKirim(false);
    }
  }

  async function ubahArsip(k: Kategori) {
    setPesan(null);
    try {
      const jalur = k.archivedAt ? 'restore' : 'archive';
      await api.minta(`/categories/${k.id}/${jalur}`, { metode: 'POST', body: {} });
      // Kategori yang sedang disunting lalu diarsipkan tidak boleh tertinggal
      // di form — menyimpannya kembali akan memulihkannya tanpa diminta.
      setSunting((s) => (s.id === k.id ? BARU : s));
      await muat();
    } catch (err) {
      setPesan(err instanceof GalatHttp ? err.message : 'Status kategori tidak dapat diubah.');
    }
  }

  const pohon = susunPohon(tampilArsip ? semua : semua.filter((k) => k.archivedAt === null));
  const bolehJadiInduk = indukYangBoleh(semua, sunting.id);
  const namaKategori = (id: string | null) =>
    id === null ? '—' : (semua.find((k) => k.id === id)?.name ?? id);

  const baris: { k: Kategori; tingkat: number }[] = [];
  for (const simpul of pohon) {
    baris.push({ k: simpul.kategori, tingkat: 0 });
    for (const anak of simpul.anak) baris.push({ k: anak, tingkat: 1 });
  }

  return (
    <div className="stack" style={{ gap: 'var(--space-4)', maxWidth: '84ch' }}>
      <div className="stack" style={{ gap: 'var(--space-1)' }}>
        <span className="t-title">Kategori</span>
        <span className="t-caption">
          Mengelompokkan produk di grid kasir. Maksimal dua tingkat — kategori dan sub-kategori.
        </span>
      </div>

      {/* --- form ---------------------------------------------------------- */}
      <Card>
        <div className="card-pad">
          <div className="stack" style={{ gap: 'var(--space-4)' }}>
            <span className="t-body-md">
              {sunting.id === null ? 'Tambah kategori' : `Ubah "${namaKategori(sunting.id)}"`}
            </span>

            <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
              <div className="grow">
                <Bidang
                  id="nama-kategori"
                  label="Nama"
                  value={sunting.name}
                  required
                  onChange={(v) => {
                    setSunting((s) => ({ ...s, name: v }));
                    setPesan(null);
                  }}
                />
              </div>
              <div style={{ width: '12ch' }}>
                <Bidang
                  id="urutan"
                  label="Urutan"
                  value={sunting.sortOrder}
                  onChange={(v) => {
                    setSunting((s) => ({ ...s, sortOrder: v.replace(/\D/g, '') }));
                    setPesan(null);
                  }}
                />
              </div>
            </div>

            <div className="stack" style={{ gap: 'var(--space-2)' }}>
              <span className="label">Induk</span>
              {bolehJadiInduk.length === 0 && sunting.id !== null ? (
                // ⛔ Menjelaskan, bukan menampilkan pemilih kosong. Kategori
                // yang punya anak tidak dapat dipindahkan ke mana pun —
                // anaknya akan menjadi tingkat ketiga.
                <span className="t-caption">
                  Kategori ini punya sub-kategori, jadi ia harus tetap di tingkat teratas.
                  Pindahkan sub-kategorinya lebih dulu bila ingin mengubah ini.
                </span>
              ) : (
                <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  <Tombol
                    varian={sunting.parentId === null ? 'primary' : 'secondary'}
                    onClick={() => setSunting((s) => ({ ...s, parentId: null }))}
                  >
                    Tanpa induk
                  </Tombol>
                  {bolehJadiInduk.map((k) => (
                    <Tombol
                      key={k.id}
                      varian={sunting.parentId === k.id ? 'primary' : 'secondary'}
                      onClick={() => setSunting((s) => ({ ...s, parentId: k.id }))}
                    >
                      {k.name}
                    </Tombol>
                  ))}
                </div>
              )}
            </div>

            <div className="row" style={{ gap: 'var(--space-3)' }}>
              <Tombol varian="primary" disabled={sedangKirim} onClick={() => void simpan()}>
                {sedangKirim ? 'Menyimpan…' : sunting.id === null ? 'Tambah' : 'Simpan'}
              </Tombol>
              {sunting.id !== null ? (
                <Tombol onClick={() => setSunting(BARU)}>Batal</Tombol>
              ) : null}
              {pesan ? (
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
          <div className="stack" style={{ gap: 'var(--space-3)' }}>
            <div className="row between">
              <span className="t-body-md">Daftar kategori</span>
              <Tombol onClick={() => setTampilArsip((v) => !v)}>
                {tampilArsip ? 'Sembunyikan yang diarsipkan' : 'Tampilkan yang diarsipkan'}
              </Tombol>
            </div>

            {keadaan.jenis === 'galat' ? (
              <EmptyState
                icon={<Icon name="alert" size={32} />}
                title="Daftar kategori tidak dapat dimuat"
                body={keadaan.pesan}
                action={<Tombol onClick={() => void muat()}>Coba lagi</Tombol>}
              />
            ) : baris.length === 0 && keadaan.jenis === 'siap' ? (
              <EmptyState
                icon={<Icon name="layers" size={32} />}
                title="Belum ada kategori"
                body="Kategori mengelompokkan produk di grid kasir. Tanpa kategori, semua produk muncul dalam satu daftar panjang — dan kasir kehilangan waktu di setiap pesanan."
              />
            ) : (
              <Table
                columns={[
                  { key: 'nama', header: 'Nama' },
                  { key: 'urutan', header: 'Urutan', align: 'right' },
                  { key: 'status', header: 'Status' },
                  { key: 'aksi', header: '', align: 'right' },
                ]}
                rows={baris.map(({ k, tingkat }) => ({
                  nama: (
                    // Indentasi lewat token spasi, bukan angka piksel
                    // (aturan DS #6).
                    <span style={{ paddingLeft: tingkat === 1 ? 'var(--space-5)' : undefined }}>
                      {tingkat === 1 ? '↳ ' : ''}
                      {k.name}
                    </span>
                  ),
                  urutan: <span className="num">{k.sortOrder}</span>,
                  // ⛔ Status membawa TEKS, tidak pernah warna saja (DS #5).
                  status: k.archivedAt ? (
                    <Badge tone="neutral">Diarsipkan</Badge>
                  ) : (
                    <Badge tone="success">Aktif</Badge>
                  ),
                  aksi: (
                    <div className="row" style={{ gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                      {k.archivedAt ? null : (
                        <Tombol
                          onClick={() =>
                            setSunting({
                              id: k.id,
                              name: k.name,
                              parentId: k.parentId,
                              sortOrder: String(k.sortOrder),
                            })
                          }
                        >
                          Ubah
                        </Tombol>
                      )}
                      <Tombol
                        varian={k.archivedAt ? 'secondary' : 'danger'}
                        onClick={() => void ubahArsip(k)}
                      >
                        {k.archivedAt ? 'Pulihkan' : 'Arsipkan'}
                      </Tombol>
                    </div>
                  ),
                }))}
              />
            )}
          </div>
        </div>
      </Card>

      <span className="t-caption">
        Kategori tidak pernah dihapus, hanya diarsipkan. Riwayat penjualan menunjuknya, dan
        laporan per kategori harus tetap dapat menyebut nama yang dipakai saat transaksi terjadi.
      </span>
    </div>
  );
}
