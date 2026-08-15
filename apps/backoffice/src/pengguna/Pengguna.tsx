import { useCallback, useEffect, useState } from 'react';
import { Badge, Card, EmptyState, Icon, Table } from 'ds';
import { useSesi } from '../sesi.tsx';
import { GalatHttp } from '../http.ts';
import { Tombol } from '../Tombol.tsx';
import { Bidang } from '../Bidang.tsx';
import { buatMuatanPengguna, periksaPinBaru, type FormPengguna } from './muatan.ts';
import { LABEL_PERAN, type Peran } from '../../../../packages/domain/src/rbac.ts';

/**
 * B-27 — Pengguna & Peran (`IA:§3.3`, akses minimum Manajer Outlet).
 *
 * ## ⛔ Kenapa layar ini adalah GATE F5, bukan CRUD biasa
 *
 * `POST /tenants` membuat owner dengan **password**, tanpa PIN. Login kasir
 * menuntut `pin_hash IS NOT NULL` (`apps/kasir/src/identitas/login.ts`).
 * Sampai layar ini ada, merchant yang baru mendaftar punya back-office yang
 * dapat dimasuki dan aplikasi kasir yang **tidak dapat dimasuki siapa pun** —
 * termasuk dirinya sendiri. Tidak ada jalur lain untuk menyetel PIN.
 *
 * ## ⛔ `isReset: true` untuk SETIAP PIN yang disetel dari sini
 *
 * `spec-f:420` menyalakan `pin_must_change` pada reset oleh manajer, dan
 * alasannya berlaku sama persis untuk PIN PERTAMA: yang mengetiknya di layar
 * ini bukan pemiliknya. PIN yang diketahui orang lain tidak boleh berlaku
 * selamanya, dan "pertama" tidak membuatnya kurang diketahui.
 *
 * Batasnya dinyatakan: **belum ada layar yang menghormati flag itu.** Aplikasi
 * kasir membaca `wajibGantiPin` ke dalam sesinya dan tidak melakukan apa pun
 * dengannya. Menulisnya sekarang berarti perangkat menanggungnya begitu layar
 * ganti-PIN dibangun — bukan sebaliknya, yang menuntut backfill atas kolom
 * yang tidak dapat disimpulkan ulang.
 *
 * ## PIN tidak dapat dibaca kembali
 *
 * `pin_hash` tidak pernah keluar lewat `GET /users` — hanya `hasPin`. Layar
 * ini karena itu dapat menyatakan apakah PIN sudah ada, dan tidak pernah
 * berapa nilainya. Yang lupa harus disetel ulang.
 */

interface Pengguna {
  id: string;
  name: string;
  email: string | null;
  isActive: boolean;
  hasPin: boolean;
  roles: string[];
  outletIds: string[];
}

interface Outlet {
  id: string;
  name: string;
  archivedAt: string | null;
}

type Keadaan = { jenis: 'memuat' } | { jenis: 'siap' } | { jenis: 'galat'; pesan: string };

/**
 * Urutan tampil: dari yang paling sering dibuat.
 *
 * ⛔ Terjemahannya (`LABEL_PERAN`) datang dari `packages/domain/src/rbac.ts`,
 * bukan ditulis di sini — pesan penolakan server menyebut peran yang sama
 * (`ROLE_SCOPE_TOO_WIDE`), dan layar yang menyebut "Manajer Outlet" sementara
 * penolakannya menyebut sesuatu yang lain adalah dua daftar yang menyimpang.
 */
const URUTAN_PERAN = ['cashier', 'outlet_manager', 'area_manager', 'accountant', 'owner'];

const FORM_KOSONG: FormPengguna = {
  nama: '',
  email: '',
  peran: 'cashier',
  outletIds: [],
  tanggalLahir: '',
};

export function PenggunaLayar() {
  const { api, sesi } = useSesi();
  const [keadaan, setKeadaan] = useState<Keadaan>({ jenis: 'memuat' });
  const [daftar, setDaftar] = useState<Pengguna[]>([]);
  const [outlet, setOutlet] = useState<Outlet[]>([]);

  const [form, setForm] = useState<FormPengguna>(FORM_KOSONG);
  const [pesanForm, setPesanForm] = useState<string | null>(null);
  const [bidangGalat, setBidangGalat] = useState<keyof FormPengguna | null>(null);
  const [sedangKirim, setSedangKirim] = useState(false);

  // ⛔ Dibuat sekali per form, bukan per penekanan tombol. `POST /users`
  // menjawab 409 ID_ALREADY_EXISTS untuk id yang sama — itu yang membuat
  // percobaan ulang setelah respons hilang tidak menghasilkan pengguna kedua.
  const [userId, setUserId] = useState(() => crypto.randomUUID());

  const [pinUntuk, setPinUntuk] = useState<Pengguna | null>(null);
  const [pin, setPin] = useState('');
  const [lihatPin, setLihatPin] = useState(false);
  const [pesanPin, setPesanPin] = useState<string | null>(null);
  const [kabar, setKabar] = useState<string | null>(null);

  const muat = useCallback(async () => {
    setKeadaan({ jenis: 'memuat' });
    try {
      const [p, o] = await Promise.all([
        api.minta<Pengguna[]>('/users'),
        api.minta<Outlet[]>('/outlets'),
      ]);
      setDaftar(p);
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

  const ubah = (bidang: keyof FormPengguna) => (nilai: string) => {
    setForm((f) => ({ ...f, [bidang]: nilai }));
    setBidangGalat((b) => (b === bidang ? null : b));
    setPesanForm(null);
  };

  function pilihOutlet(id: string) {
    setForm((f) => ({
      ...f,
      outletIds: f.outletIds.includes(id)
        ? f.outletIds.filter((o) => o !== id)
        : [...f.outletIds, id],
    }));
    setBidangGalat((b) => (b === 'outletIds' ? null : b));
    setPesanForm(null);
  }

  async function tambah() {
    setPesanForm(null);
    setBidangGalat(null);
    setKabar(null);

    const hasil = buatMuatanPengguna(form, { tenantId: sesi?.tenantId ?? '', userId });
    if (!hasil.ok) {
      setBidangGalat(hasil.bidang);
      setPesanForm(hasil.pesan);
      return;
    }

    setSedangKirim(true);
    try {
      const dibuat = await api.minta<Pengguna>('/users', { metode: 'POST', body: hasil.muatan });
      setForm(FORM_KOSONG);
      // Id baru HANYA setelah yang lama benar-benar terpakai.
      setUserId(crypto.randomUUID());
      await muat();
      // ⛔ Langsung membuka blok PIN. Pengguna tanpa PIN tidak dapat membuka
      // aplikasi kasir sama sekali, dan itu satu-satunya alasan layar ini
      // memblokir gate F5 — menyerahkannya sebagai langkah terpisah yang harus
      // diingat merchant mengembalikan tepat kebuntuan yang sama.
      setPinUntuk({ ...dibuat, hasPin: false });
      setPin('');
      setPesanPin(null);
    } catch (err) {
      // Penolakan peran (`FORBIDDEN_ROLE_MANAGEMENT`) dan kuota keduanya
      // mendarat di sini, dan pesan server MEMBAWA KONTEKSNYA — "Anda tidak
      // berhak mengelola pengguna berperan owner" menyebut peran mana.
      setPesanForm(err instanceof GalatHttp ? err.message : 'Pengguna tidak dapat dibuat.');
    } finally {
      setSedangKirim(false);
    }
  }

  async function simpanPin() {
    setPesanPin(null);
    if (!pinUntuk) return;

    // Pra-periksa memakai aturan yang sama dengan server; ia menghilangkan
    // perjalanan pulang-pergi, bukan menggantikan penegakan.
    const periksa = periksaPinBaru(pin, {});
    if (!periksa.ok) {
      setPesanPin(periksa.pesan);
      return;
    }

    try {
      await api.minta(`/users/${pinUntuk.id}/pin`, {
        metode: 'PUT',
        // `isReset: true` — lihat catatan di kepala berkas. Yang mengetik PIN
        // di layar ini bukan pemiliknya, dan itu berlaku untuk PIN pertama
        // sama seperti untuk penggantian.
        body: { pin, isReset: true },
      });
      setKabar(
        `PIN untuk ${pinUntuk.name} tersimpan. Sampaikan langsung kepadanya — PIN tidak dapat dibaca lagi dari layar mana pun.`
      );
      setPinUntuk(null);
      setPin('');
      await muat();
    } catch (err) {
      // `PIN_TAKEN` mendarat di sini, dan pesannya SENGAJA tidak menyebut
      // siapa pemakainya — menyebutnya berarti memberi tahu pengetik PIN siapa
      // yang baru saja ia tebak.
      setPesanPin(err instanceof GalatHttp ? err.message : 'PIN tidak dapat disimpan.');
    }
  }

  async function ubahAktif(p: Pengguna) {
    setPesanForm(null);
    setKabar(null);
    try {
      await api.minta(`/users/${p.id}`, {
        metode: 'PATCH',
        body: { isActive: !p.isActive },
      });
      await muat();
    } catch (err) {
      // `LAST_OWNER` mendarat di sini (`spec-f:425`), dan pesannya menjelaskan
      // apa yang harus dilakukan lebih dulu.
      setPesanForm(err instanceof GalatHttp ? err.message : 'Status pengguna tidak dapat diubah.');
    }
  }

  const outletAktif = outlet.filter((o) => !o.archivedAt);
  const namaOutlet = (id: string) => outlet.find((o) => o.id === id)?.name ?? id;
  const galatUntuk = (bidang: keyof FormPengguna) =>
    bidangGalat === bidang ? (pesanForm ?? undefined) : undefined;

  return (
    <div className="stack" style={{ gap: 'var(--space-4)', maxWidth: '84ch' }}>
      <div className="stack" style={{ gap: 'var(--space-1)' }}>
        <span className="t-title">Pengguna &amp; Peran</span>
        <span className="t-caption">
          Kasir masuk ke tablet dengan PIN, bukan password. Tanpa PIN, ia tidak dapat membuka
          aplikasi kasir sama sekali.
        </span>
      </div>

      {kabar ? (
        // Status membawa TEKS, tidak pernah warna saja (aturan DS #5).
        <Card>
          <div className="card-pad">
            <span className="t-body-md" role="status">
              {kabar}
            </span>
          </div>
        </Card>
      ) : null}

      {/* --- setel PIN ---------------------------------------------------- */}
      {pinUntuk ? (
        <Card>
          <div className="card-pad">
            <div className="stack" style={{ gap: 'var(--space-4)' }}>
              <div className="row between">
                <span className="t-body-md">PIN untuk {pinUntuk.name}</span>
                <Badge tone="warning">Tidak dapat dibaca lagi</Badge>
              </div>
              <span className="t-caption">
                Enam digit. Tidak boleh berulang (000000), berurutan (123456), atau sama dengan PIN
                orang lain di outlet yang sama. Yang tersimpan di server hanya sidik jarinya.
              </span>

              <div style={{ width: '16ch' }}>
                <Bidang
                  id="pin"
                  label="PIN baru"
                  type={lihatPin ? 'text' : 'password'}
                  value={pin}
                  required
                  autoComplete="off"
                  error={pesanPin ?? undefined}
                  onChange={(v) => {
                    // Hanya digit, dipotong di enam. Field yang menerima huruf
                    // lalu ditolak server membuat pengetiknya menebak aturan
                    // yang sudah diketahui layar.
                    setPin(v.replace(/\D/g, '').slice(0, 6));
                    setPesanPin(null);
                  }}
                />
              </div>

              <div className="row" style={{ gap: 'var(--space-3)' }}>
                <Tombol varian="primary" disabled={pin.length !== 6} onClick={() => void simpanPin()}>
                  Simpan PIN
                </Tombol>
                <Tombol varian="ghost" onClick={() => setLihatPin((v) => !v)}>
                  {lihatPin ? 'Sembunyikan' : 'Perlihatkan'}
                </Tombol>
                <Tombol
                  onClick={() => {
                    setPinUntuk(null);
                    setPin('');
                    setPesanPin(null);
                  }}
                >
                  Nanti saja
                </Tombol>
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {/* --- tambah ------------------------------------------------------- */}
      <Card>
        <div className="card-pad">
          <div className="stack" style={{ gap: 'var(--space-4)' }}>
            <span className="t-body-md">Tambah pengguna</span>

            <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
              <div className="grow">
                <Bidang
                  id="nama"
                  label="Nama"
                  value={form.nama}
                  required
                  error={galatUntuk('nama')}
                  onChange={ubah('nama')}
                />
              </div>
              <div className="grow">
                <Bidang
                  id="email-pengguna"
                  label="Email (hanya untuk back-office)"
                  type="email"
                  value={form.email}
                  onChange={ubah('email')}
                />
              </div>
            </div>

            <div className="stack" style={{ gap: 'var(--space-2)' }}>
              <span className="label">Peran</span>
              <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                {URUTAN_PERAN.map((p) => (
                  <Tombol
                    key={p}
                    varian={form.peran === p ? 'primary' : 'secondary'}
                    onClick={() => ubah('peran')(p)}
                  >
                    {LABEL_PERAN[p as Peran]}
                  </Tombol>
                ))}
              </div>
              {bidangGalat === 'peran' && pesanForm ? (
                <span className="field-error">{pesanForm}</span>
              ) : null}
            </div>

            <div className="stack" style={{ gap: 'var(--space-2)' }}>
              <span className="label">Outlet</span>
              {outletAktif.length === 0 ? (
                <span className="t-caption">Belum ada outlet aktif.</span>
              ) : (
                <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  {outletAktif.map((o) => (
                    <Tombol
                      key={o.id}
                      varian={form.outletIds.includes(o.id) ? 'primary' : 'secondary'}
                      onClick={() => pilihOutlet(o.id)}
                    >
                      {o.name}
                    </Tombol>
                  ))}
                </div>
              )}
              {bidangGalat === 'outletIds' && pesanForm ? (
                <span className="field-error">{pesanForm}</span>
              ) : null}
            </div>

            <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-end' }}>
              <div style={{ width: '20ch' }}>
                <Bidang
                  id="lahir"
                  label="Tanggal lahir (opsional)"
                  value={form.tanggalLahir}
                  onChange={ubah('tanggalLahir')}
                />
              </div>
              {/* ⛔ Bukan basa-basi data diri. `spec-f:135` menolak PIN berupa
                  tanggal lahir, dan aturan itu BERSYARAT — tanpa nilai ini ia
                  tidak berjalan sama sekali. */}
              <span className="t-caption grow">
                YYYY-MM-DD. Dipakai menolak PIN berupa tanggal lahir sendiri.
              </span>
            </div>

            <div className="row" style={{ gap: 'var(--space-3)' }}>
              <Tombol varian="primary" disabled={sedangKirim} onClick={() => void tambah()}>
                {sedangKirim ? 'Menyimpan…' : 'Tambah pengguna'}
              </Tombol>
              {pesanForm && bidangGalat === null ? (
                <span className="t-caption" style={{ color: 'var(--danger)' }} role="alert">
                  {pesanForm}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </Card>

      {/* --- daftar ------------------------------------------------------- */}
      <Card>
        <div className="card-pad">
          {keadaan.jenis === 'galat' ? (
            <EmptyState
              icon={<Icon name="alert" size={32} />}
              title="Daftar pengguna tidak dapat dimuat"
              body={keadaan.pesan}
              action={<Tombol onClick={() => void muat()}>Coba lagi</Tombol>}
            />
          ) : daftar.length === 0 && keadaan.jenis === 'siap' ? (
            <EmptyState
              icon={<Icon name="user" size={32} />}
              title="Belum ada pengguna"
              body="Tambahkan satu kasir untuk setiap orang yang mengoperasikan tablet. Setiap transaksi dicatat atas namanya, dan itu yang membuat laporan per kasir berarti."
            />
          ) : (
            <Table
              columns={[
                { key: 'nama', header: 'Nama' },
                { key: 'peran', header: 'Peran' },
                { key: 'outlet', header: 'Outlet' },
                { key: 'status', header: 'Status' },
                { key: 'aksi', header: '', align: 'right' },
              ]}
              rows={daftar.map((p) => ({
                nama: (
                  <div className="stack" style={{ gap: 'var(--space-1)' }}>
                    <span>{p.name}</span>
                    {p.email ? <span className="t-caption">{p.email}</span> : null}
                  </div>
                ),
                peran: p.roles.length === 0 ? '—' : [...new Set(p.roles)].map((r) => LABEL_PERAN[r as Peran] ?? r).join(', '),
                outlet: p.outletIds.length === 0 ? '—' : p.outletIds.map(namaOutlet).join(', '),
                // ⛔ Status membawa teks, tidak pernah warna saja (aturan DS #5).
                status: !p.isActive ? (
                  <Badge tone="neutral">Nonaktif</Badge>
                ) : p.hasPin ? (
                  <Badge tone="success">PIN sudah disetel</Badge>
                ) : (
                  <Badge tone="warning">Belum ada PIN</Badge>
                ),
                aksi: (
                  <div className="row" style={{ gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                    {p.isActive ? (
                      <Tombol
                        onClick={() => {
                          setPinUntuk(p);
                          setPin('');
                          setPesanPin(null);
                          setKabar(null);
                        }}
                      >
                        {p.hasPin ? 'Ganti PIN' : 'Setel PIN'}
                      </Tombol>
                    ) : null}
                    <Tombol varian={p.isActive ? 'danger' : 'secondary'} onClick={() => void ubahAktif(p)}>
                      {p.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                    </Tombol>
                  </div>
                ),
              }))}
            />
          )}
        </div>
      </Card>

      <span className="t-caption">
        Pengguna yang dinonaktifkan tetap terlihat di sini. Ia tidak pernah dihapus — setiap
        transaksi, void, dan penyetujuan menunjuk namanya, dan menghapusnya memutus atribusi
        seluruh riwayat yang pernah ia buat.
      </span>
    </div>
  );
}
