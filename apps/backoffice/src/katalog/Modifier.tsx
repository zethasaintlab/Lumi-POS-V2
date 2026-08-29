import { useCallback, useEffect, useState } from 'react';
import { Badge, Card, EmptyState, Icon, Table } from 'ds';
import { useSesi } from '../../../../packages/klien-api/src/sesi.tsx';
import { GalatHttp } from '../../../../packages/klien-api/src/http.ts';
import { Tombol } from '../Tombol.tsx';
import { Bidang } from '../Bidang.tsx';
import { rupiah } from '../../../../packages/domain/src/uang-tampilan.ts';
import {
  buatMuatanList,
  buatMuatanModifier,
  polaMencurigakan,
  ringkasPerilaku,
  type FormList,
  type FormModifier,
} from './modifier.ts';

/**
 * B-09 — Modifier (`IA:§3.3`, akses minimum Manajer Area).
 *
 * ## ⛔ FR-A5: guardrail, bukan dokumentasi
 *
 * `spec-a:138` menyebutnya sendiri: *"Kesalahan penempatan adalah jebakan #1
 * di modul ini. UI harus MENCEGAHNYA, bukan mendokumentasikannya."*
 *
 * Ukuran dan rasa hampir selalu **variation**, bukan modifier — keduanya punya
 * stok sendiri, dan modifier tidak pernah punya. Merchant yang menaruh "Ukuran
 * Gelas" sebagai modifier akan mendapati stoknya tidak pernah berkurang, dan
 * baru mengetahuinya saat opname.
 *
 * Tiga hal yang dituntut ACnya, dan ketiganya ada:
 * - Pertanyaan muncul saat MEMBUAT list baru
 * - Merchant dapat mengabaikannya dan lanjut
 * - Pertanyaan **tidak** muncul saat menyunting list yang sudah ada
 *
 * Peringatan pola **tidak memblokir** — ia teks di samping tombol simpan, dan
 * tombolnya tetap hidup.
 *
 * ## ⛔ Konfigurasi diterjemahkan ke perilaku kasir
 *
 * Merchant yang mengonfigurasi di sini tidak pernah melihat dialog kasirnya.
 * `ringkasPerilaku` menerjemahkan empat field mentah menjadi kalimat — tanpa
 * itu, yang salah dikonfigurasi baru ketahuan saat kasir tidak dapat
 * menyelesaikan pesanan di jam sibuk.
 */

interface Modifier {
  id: string;
  modifierListId: string;
  name: string;
  price: number;
  isDefault?: boolean;
  sortOrder: number;
  archivedAt: string | null;
}

interface ModifierList {
  id: string;
  name: string;
  selectionType: string;
  minSelections: number;
  maxSelections: number | null;
  allowDuplicate?: boolean;
  isRequired?: boolean;
  archivedAt: string | null;
  modifiers: Modifier[];
}

type Keadaan = { jenis: 'memuat' } | { jenis: 'siap' } | { jenis: 'galat'; pesan: string };

const LIST_KOSONG: FormList = {
  nama: '',
  selectionType: 'single',
  minSelections: '0',
  maxSelections: '',
  allowDuplicate: false,
  isRequired: false,
};

const OPSI_KOSONG: FormModifier = { nama: '', harga: '', isDefault: false };

export function ModifierLayar() {
  const { api } = useSesi();
  const [keadaan, setKeadaan] = useState<Keadaan>({ jenis: 'memuat' });
  const [daftar, setDaftar] = useState<ModifierList[]>([]);
  const [tampilArsip, setTampilArsip] = useState(false);

  const [form, setForm] = useState<FormList>(LIST_KOSONG);
  const [ubahId, setUbahId] = useState<string | null>(null);
  const [pesan, setPesan] = useState<string | null>(null);
  const [bidang, setBidang] = useState<keyof FormList | null>(null);
  const [idList, setIdList] = useState(() => crypto.randomUUID());

  // ⛔ Jawaban guardrail hanya untuk list BARU. AC `spec-a:165`: pertanyaan
  // tidak muncul saat menyunting yang sudah ada.
  const [jawabGuardrail, setJawabGuardrail] = useState<'belum' | 'stok' | 'biaya'>('belum');

  const [bukaId, setBukaId] = useState<string | null>(null);
  const [opsi, setOpsi] = useState<FormModifier>(OPSI_KOSONG);
  const [ubahOpsiId, setUbahOpsiId] = useState<string | null>(null);
  const [pesanOpsi, setPesanOpsi] = useState<string | null>(null);
  const [idOpsi, setIdOpsi] = useState(() => crypto.randomUUID());

  const muat = useCallback(async () => {
    setKeadaan({ jenis: 'memuat' });
    try {
      // ⛔ SELALU termasuk yang terarsip. Penyaringan di klien — list terarsip
      // yang masih terkait ke produk tetap harus dapat dilihat dan dilepas.
      const hasil = await api.minta<{ items: ModifierList[] }>('/modifier-lists?includeArchived=true');
      setDaftar(hasil.items);
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

  async function simpanList() {
    setPesan(null);
    setBidang(null);

    const hasil = buatMuatanList(form, idList);
    if (!hasil.ok) {
      setBidang(hasil.bidang);
      setPesan(hasil.pesan);
      return;
    }

    try {
      if (ubahId === null) {
        await api.minta('/modifier-lists', { metode: 'POST', body: hasil.muatan });
        setIdList(crypto.randomUUID());
      } else {
        const { id: _id, ...tanpaId } = hasil.muatan;
        await api.minta(`/modifier-lists/${ubahId}`, { metode: 'PATCH', body: tanpaId });
      }
      setForm(LIST_KOSONG);
      setUbahId(null);
      setJawabGuardrail('belum');
      await muat();
    } catch (err) {
      setPesan(err instanceof GalatHttp ? err.message : 'Daftar tidak dapat disimpan.');
    }
  }

  async function ubahArsipList(l: ModifierList) {
    setPesan(null);
    try {
      await api.minta(`/modifier-lists/${l.id}/${l.archivedAt ? 'restore' : 'archive'}`, {
        metode: 'POST',
        body: {},
      });
      setUbahId((k) => (k === l.id ? null : k));
      await muat();
    } catch (err) {
      setPesan(err instanceof GalatHttp ? err.message : 'Status daftar tidak dapat diubah.');
    }
  }

  async function simpanOpsi(listId: string) {
    setPesanOpsi(null);
    const hasil = buatMuatanModifier(opsi, idOpsi);
    if (!hasil.ok) {
      setPesanOpsi(hasil.pesan);
      return;
    }

    try {
      if (ubahOpsiId === null) {
        await api.minta(`/modifier-lists/${listId}/modifiers`, { metode: 'POST', body: hasil.muatan });
        setIdOpsi(crypto.randomUUID());
      } else {
        const { id: _id, ...tanpaId } = hasil.muatan;
        await api.minta(`/modifier-lists/${listId}/modifiers/${ubahOpsiId}`, {
          metode: 'PATCH',
          body: tanpaId,
        });
      }
      setOpsi(OPSI_KOSONG);
      setUbahOpsiId(null);
      await muat();
    } catch (err) {
      setPesanOpsi(err instanceof GalatHttp ? err.message : 'Pilihan tidak dapat disimpan.');
    }
  }

  async function ubahArsipOpsi(listId: string, m: Modifier) {
    setPesanOpsi(null);
    try {
      await api.minta(
        `/modifier-lists/${listId}/modifiers/${m.id}/${m.archivedAt ? 'restore' : 'archive'}`,
        { metode: 'POST', body: {} }
      );
      await muat();
    } catch (err) {
      setPesanOpsi(err instanceof GalatHttp ? err.message : 'Status pilihan tidak dapat diubah.');
    }
  }

  const terlihat = tampilArsip ? daftar : daftar.filter((l) => l.archivedAt === null);
  const buka = daftar.find((l) => l.id === bukaId) ?? null;
  const galat = (b: keyof FormList) => (bidang === b ? (pesan ?? undefined) : undefined);

  // Peringatan dihitung dari isian SAAT INI plus opsi yang sudah ada bila
  // sedang menyunting. Ia tidak pernah menghalangi tombol simpan.
  const peringatan = polaMencurigakan(
    form.nama,
    ubahId !== null ? (daftar.find((l) => l.id === ubahId)?.modifiers ?? []) : []
  );

  return (
    <div className="stack" style={{ gap: 'var(--space-4)', maxWidth: '96ch' }}>
      <div className="stack" style={{ gap: 'var(--space-1)' }}>
        <span className="t-title">Modifier</span>
        <span className="t-caption">
          Tambahan pada produk yang <strong>tidak</strong> punya stok sendiri — tingkat gula, extra
          shot, tanpa es. Yang punya stok sendiri adalah varian, bukan modifier.
        </span>
      </div>

      {/* --- form daftar ---------------------------------------------------- */}
      <Card>
        <div className="card-pad">
          <div className="stack" style={{ gap: 'var(--space-4)' }}>
            <span className="t-body-md">
              {ubahId === null ? 'Buat daftar modifier' : `Ubah "${daftar.find((l) => l.id === ubahId)?.name}"`}
            </span>

            <Bidang
              id="nama-list"
              label="Nama daftar"
              value={form.nama}
              required
              error={galat('nama')}
              onChange={(v) => {
                setForm((f) => ({ ...f, nama: v }));
                setPesan(null);
                setBidang(null);
              }}
            />

            {/* ⛔ FR-A5 — hanya saat MEMBUAT, tidak saat menyunting. */}
            {ubahId === null ? (
              <div className="stack" style={{ gap: 'var(--space-2)' }}>
                <span className="label">Apakah pilihan ini perlu dilacak stoknya secara terpisah?</span>
                <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  <Tombol
                    varian={jawabGuardrail === 'stok' ? 'primary' : 'secondary'}
                    onClick={() => setJawabGuardrail('stok')}
                  >
                    Ya, stoknya berbeda
                  </Tombol>
                  <Tombol
                    varian={jawabGuardrail === 'biaya' ? 'primary' : 'secondary'}
                    onClick={() => setJawabGuardrail('biaya')}
                  >
                    Tidak, hanya menambah biaya
                  </Tombol>
                </div>
                {jawabGuardrail === 'stok' ? (
                  // Satu kalimat konsekuensi, dan merchant tetap dapat lanjut
                  // — AC `spec-a:162`.
                  <span className="t-caption">
                    Kalau stoknya berbeda, yang Anda butuhkan adalah <strong>varian</strong> di layar
                    Produk: modifier tidak pernah mengurangi stok, jadi selisihnya baru terlihat saat
                    opname. Anda tetap dapat melanjutkan sebagai modifier bila memang itu yang
                    dimaksud.
                  </span>
                ) : null}
              </div>
            ) : null}

            <div className="stack" style={{ gap: 'var(--space-2)' }}>
              <span className="label">Kasir memilih</span>
              <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                <Tombol
                  varian={form.selectionType === 'single' ? 'primary' : 'secondary'}
                  onClick={() => setForm((f) => ({ ...f, selectionType: 'single' }))}
                >
                  Satu pilihan
                </Tombol>
                <Tombol
                  varian={form.selectionType === 'multi' ? 'primary' : 'secondary'}
                  onClick={() => setForm((f) => ({ ...f, selectionType: 'multi' }))}
                >
                  Beberapa pilihan
                </Tombol>
                <Tombol
                  varian={form.isRequired ? 'primary' : 'secondary'}
                  onClick={() => setForm((f) => ({ ...f, isRequired: !f.isRequired }))}
                >
                  {form.isRequired ? 'Wajib dipilih' : 'Tidak wajib'}
                </Tombol>
                <Tombol
                  varian={form.allowDuplicate ? 'primary' : 'secondary'}
                  onClick={() => setForm((f) => ({ ...f, allowDuplicate: !f.allowDuplicate }))}
                >
                  {form.allowDuplicate ? 'Boleh berulang' : 'Tidak berulang'}
                </Tombol>
              </div>
            </div>

            <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
              <div style={{ width: '14ch' }}>
                <Bidang
                  id="min-pilih"
                  label="Minimal"
                  value={form.minSelections}
                  error={galat('minSelections')}
                  onChange={(v) => {
                    setForm((f) => ({ ...f, minSelections: v.replace(/\D/g, '') }));
                    setPesan(null);
                    setBidang(null);
                  }}
                />
              </div>
              <div style={{ width: '14ch' }}>
                <Bidang
                  id="max-pilih"
                  label="Maksimal"
                  value={form.maxSelections}
                  error={galat('maxSelections')}
                  onChange={(v) => {
                    setForm((f) => ({ ...f, maxSelections: v.replace(/\D/g, '') }));
                    setPesan(null);
                    setBidang(null);
                  }}
                />
              </div>
              <span className="t-caption grow">Kosongkan Maksimal untuk tanpa batas atas.</span>
            </div>

            {/* ⛔ Terjemahan konfigurasi ke perilaku kasir. */}
            <div className="stack" style={{ gap: 'var(--space-1)' }}>
              <span className="label">Di layar kasir</span>
              <span className="t-caption">
                {ringkasPerilaku({
                  selectionType: form.selectionType,
                  isRequired: form.isRequired,
                  minSelections: Number.parseInt(form.minSelections || '0', 10) || 0,
                  maxSelections:
                    form.maxSelections.trim().length === 0
                      ? null
                      : Number.parseInt(form.maxSelections, 10),
                  allowDuplicate: form.allowDuplicate,
                })}
              </span>
            </div>

            {/* ⛔ Peringatan pola — TIDAK memblokir. Tombol simpan tetap hidup. */}
            {peringatan.length > 0 ? (
              <div className="stack" style={{ gap: 'var(--space-1)' }}>
                {peringatan.map((p) => (
                  <span key={p} className="t-caption" role="status">
                    ⚠ {p}
                  </span>
                ))}
              </div>
            ) : null}

            <div className="row" style={{ gap: 'var(--space-3)' }}>
              <Tombol varian="primary" onClick={() => void simpanList()}>
                {ubahId === null ? 'Buat daftar' : 'Simpan'}
              </Tombol>
              {ubahId !== null ? (
                <Tombol
                  onClick={() => {
                    setUbahId(null);
                    setForm(LIST_KOSONG);
                    setPesan(null);
                  }}
                >
                  Batal
                </Tombol>
              ) : null}
              {pesan && bidang === null ? (
                <span className="t-caption" style={{ color: 'var(--danger)' }} role="alert">
                  {pesan}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </Card>

      {/* --- daftar list ----------------------------------------------------- */}
      <Card>
        <div className="card-pad">
          <div className="stack" style={{ gap: 'var(--space-3)' }}>
            <div className="row between">
              <span className="t-body-md">Daftar modifier</span>
              <Tombol onClick={() => setTampilArsip((v) => !v)}>
                {tampilArsip ? 'Sembunyikan yang diarsipkan' : 'Tampilkan yang diarsipkan'}
              </Tombol>
            </div>

            {keadaan.jenis === 'galat' ? (
              <EmptyState
                icon={<Icon name="alert" size={32} />}
                title="Daftar modifier tidak dapat dimuat"
                body={keadaan.pesan}
                action={<Tombol onClick={() => void muat()}>Coba lagi</Tombol>}
              />
            ) : terlihat.length === 0 && keadaan.jenis === 'siap' ? (
              <EmptyState
                icon={<Icon name="sliders" size={32} />}
                title="Belum ada daftar modifier"
                body="Modifier adalah tambahan pada produk yang tidak punya stok sendiri — tingkat gula, extra shot, tanpa es. Buat satu daftar, lalu kaitkan ke produk dari layar Produk."
              />
            ) : (
              <Table
                columns={[
                  { key: 'nama', header: 'Daftar' },
                  { key: 'aturan', header: 'Aturan' },
                  { key: 'opsi', header: 'Pilihan', align: 'right' },
                  { key: 'status', header: 'Status' },
                  { key: 'aksi', header: '', align: 'right' },
                ]}
                rows={terlihat.map((l) => ({
                  nama: l.name,
                  aturan: `${l.selectionType === 'single' ? 'Satu' : 'Beberapa'}${l.isRequired ? ' · wajib' : ''}${l.maxSelections !== null ? ` · maks ${l.maxSelections}` : ''}${l.allowDuplicate ? ' · boleh berulang' : ''}`,
                  opsi: (
                    <span className="num">{l.modifiers.filter((m) => m.archivedAt === null).length}</span>
                  ),
                  status: l.archivedAt ? (
                    <Badge tone="neutral">Diarsipkan</Badge>
                  ) : (
                    <Badge tone="success">Aktif</Badge>
                  ),
                  aksi: (
                    <div className="row" style={{ gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                      <Tombol
                        onClick={() => {
                          setBukaId(bukaId === l.id ? null : l.id);
                          setOpsi(OPSI_KOSONG);
                          setUbahOpsiId(null);
                          setPesanOpsi(null);
                        }}
                      >
                        {bukaId === l.id ? 'Tutup' : 'Pilihan'}
                      </Tombol>
                      {l.archivedAt ? null : (
                        <Tombol
                          onClick={() => {
                            setUbahId(l.id);
                            setPesan(null);
                            setForm({
                              nama: l.name,
                              selectionType: l.selectionType,
                              minSelections: String(l.minSelections),
                              maxSelections: l.maxSelections === null ? '' : String(l.maxSelections),
                              allowDuplicate: l.allowDuplicate === true,
                              isRequired: l.isRequired === true,
                            });
                          }}
                        >
                          Ubah
                        </Tombol>
                      )}
                      <Tombol
                        varian={l.archivedAt ? 'secondary' : 'danger'}
                        onClick={() => void ubahArsipList(l)}
                      >
                        {l.archivedAt ? 'Pulihkan' : 'Arsipkan'}
                      </Tombol>
                    </div>
                  ),
                }))}
              />
            )}
          </div>
        </div>
      </Card>

      {/* --- pilihan di dalam satu daftar ------------------------------------ */}
      {buka ? (
        <Card>
          <div className="card-pad">
            <div className="stack" style={{ gap: 'var(--space-4)' }}>
              <span className="t-body-md">Pilihan dalam &ldquo;{buka.name}&rdquo;</span>

              <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
                <div className="grow">
                  <Bidang
                    id="nama-opsi"
                    label="Nama pilihan"
                    value={opsi.nama}
                    required
                    onChange={(v) => {
                      setOpsi((o) => ({ ...o, nama: v }));
                      setPesanOpsi(null);
                    }}
                  />
                </div>
                <div style={{ width: '18ch' }}>
                  <Bidang
                    id="harga-opsi"
                    label="Tambahan harga"
                    value={opsi.harga}
                    error={pesanOpsi ?? undefined}
                    onChange={(v) => {
                      setOpsi((o) => ({ ...o, harga: v }));
                      setPesanOpsi(null);
                    }}
                  />
                </div>
                <Tombol
                  varian={opsi.isDefault ? 'primary' : 'secondary'}
                  onClick={() => setOpsi((o) => ({ ...o, isDefault: !o.isDefault }))}
                >
                  {opsi.isDefault ? 'Terpilih otomatis' : 'Tidak otomatis'}
                </Tombol>
              </div>

              {/* AC FR-A3: Rp 0 tetap tercetak di struk. */}
              <span className="t-caption">
                Kosongkan harga untuk Rp 0. Pilihan tanpa biaya tetap tercetak di struk — ia
                mengubah pesanan meski tidak mengubah harga.
              </span>

              <div className="row" style={{ gap: 'var(--space-3)' }}>
                <Tombol varian="primary" onClick={() => void simpanOpsi(buka.id)}>
                  {ubahOpsiId === null ? 'Tambah pilihan' : 'Simpan pilihan'}
                </Tombol>
                {ubahOpsiId !== null ? (
                  <Tombol
                    onClick={() => {
                      setUbahOpsiId(null);
                      setOpsi(OPSI_KOSONG);
                    }}
                  >
                    Batal
                  </Tombol>
                ) : null}
              </div>

              {buka.modifiers.length === 0 ? (
                <EmptyState
                  icon={<Icon name="sliders" size={32} />}
                  title="Belum ada pilihan"
                  body="Daftar tanpa pilihan tidak menampilkan apa pun di layar kasir."
                />
              ) : (
                <Table
                  columns={[
                    { key: 'nama', header: 'Pilihan' },
                    { key: 'harga', header: 'Tambahan', align: 'right' },
                    { key: 'bawaan', header: 'Otomatis' },
                    { key: 'status', header: 'Status' },
                    { key: 'aksi', header: '', align: 'right' },
                  ]}
                  rows={buka.modifiers.map((m) => ({
                    nama: m.name,
                    harga: <span className="num">{rupiah(m.price)}</span>,
                    bawaan: m.isDefault ? <Badge tone="success">Ya</Badge> : '—',
                    status: m.archivedAt ? (
                      <Badge tone="neutral">Diarsipkan</Badge>
                    ) : (
                      <Badge tone="success">Aktif</Badge>
                    ),
                    aksi: (
                      <div className="row" style={{ gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                        {m.archivedAt ? null : (
                          <Tombol
                            onClick={() => {
                              setUbahOpsiId(m.id);
                              setPesanOpsi(null);
                              setOpsi({
                                nama: m.name,
                                harga: String(m.price),
                                isDefault: m.isDefault === true,
                              });
                            }}
                          >
                            Ubah
                          </Tombol>
                        )}
                        <Tombol
                          varian={m.archivedAt ? 'secondary' : 'danger'}
                          onClick={() => void ubahArsipOpsi(buka.id, m)}
                        >
                          {m.archivedAt ? 'Pulihkan' : 'Arsipkan'}
                        </Tombol>
                      </div>
                    ),
                  }))}
                />
              )}
            </div>
          </div>
        </Card>
      ) : null}

      <span className="t-caption">
        Daftar dan pilihan tidak pernah dihapus, hanya diarsipkan — struk lama menyebut namanya, dan
        laporan harus tetap dapat membacanya.
      </span>
    </div>
  );
}
