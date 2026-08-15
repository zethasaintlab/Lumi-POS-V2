import { useCallback, useEffect, useState } from 'react';
import { Badge, Card, EmptyState, Icon, Table } from 'ds';
import { useSesi } from '../sesi.tsx';
import { GalatHttp } from '../http.ts';
import { Tombol } from '../Tombol.tsx';
import { Bidang } from '../Bidang.tsx';
import { bungkusKodePemasangan, type KonfigPemasangan } from './kode-pemasangan.ts';

/**
 * B-28 — Perangkat (`IA:§3.3`, akses minimum Manajer Outlet).
 *
 * Menutup kaki ketiga gate F5: merchant harus dapat menghubungkan tablet
 * kasirnya sendiri, tanpa bantuan.
 *
 * ## ⛔ Kredensial hanya dapat dibaca SEKALI
 *
 * `POST /devices/{id}/credentials` mengembalikan secret satu kali; yang
 * tersimpan di server hanya SHA-256-nya. Menerbitkan ulang MENGGANTI yang
 * lama — perangkat yang sudah memakainya berhenti dapat menukar token, dan
 * ia baru mengetahuinya saat sinkronisasi berikutnya.
 *
 * Karena itu secret dan kode pemasangan ditampilkan di blok yang menyatakan
 * batas itu, dan hilang begitu layar berpindah. Tidak ada tempat lain di
 * aplikasi ini yang dapat menampilkannya lagi.
 *
 * ## ⛔ Enam nilai, bukan satu PIN
 *
 * Perangkat butuh `deviceId`, `deviceCode`, `tenantId`, `outletId`,
 * `baseUrl`, dan `tokenSecret`. Keenamnya ditampilkan satu per satu — itu
 * yang layar K-15 kasir terima HARI INI — dan sekaligus dibungkus jadi satu
 * baris kode pemasangan untuk saat K-15 diberi kotak tempel.
 */

interface Perangkat {
  id: string;
  outletId: string;
  code: string;
  name: string | null;
  platform: string | null;
  revokedAt: string | null;
  lastSeenAt: string | null;
  adaKredensial: boolean;
  credentialsExpireAt: string | null;
}

interface Outlet {
  id: string;
  name: string;
  archivedAt: string | null;
}

interface Kredensial {
  deviceId: string;
  secret: string;
  expiresAt: string;
}

type Keadaan =
  | { jenis: 'memuat' }
  | { jenis: 'siap' }
  | { jenis: 'galat'; pesan: string };

function idBaru() {
  return crypto.randomUUID();
}

export function PerangkatLayar() {
  const { api, sesi, baseUrl } = useSesi();
  const [keadaan, setKeadaan] = useState<Keadaan>({ jenis: 'memuat' });
  const [daftar, setDaftar] = useState<Perangkat[]>([]);
  const [outlet, setOutlet] = useState<Outlet[]>([]);
  const [kode, setKode] = useState('');
  const [nama, setNama] = useState('');
  const [outletId, setOutletId] = useState('');
  const [pesanForm, setPesanForm] = useState<string | null>(null);
  const [terbit, setTerbit] = useState<{ perangkat: Perangkat; kredensial: Kredensial } | null>(
    null
  );

  const muat = useCallback(async () => {
    setKeadaan({ jenis: 'memuat' });
    try {
      const [p, o] = await Promise.all([
        api.minta<Perangkat[]>('/devices'),
        api.minta<Outlet[]>('/outlets'),
      ]);
      setDaftar(p);
      setOutlet(o);
      setOutletId((kini) => kini || o.find((x) => !x.archivedAt)?.id || '');
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

  async function tambah() {
    setPesanForm(null);
    if (kode.trim().length === 0 || outletId.length === 0) return;
    try {
      await api.minta('/devices', {
        metode: 'POST',
        // Id di-generate KLIEN, mengikuti konvensi repo. Retry dengan id yang
        // sama dijawab 409 ID_ALREADY_EXISTS, bukan perangkat kedua.
        body: { id: idBaru(), outletId, code: kode.trim(), name: nama.trim() || null },
      });
      setKode('');
      setNama('');
      await muat();
    } catch (err) {
      // Penolakan kuota dan kode ganda keduanya mendarat di sini, dan pesan
      // server MEMBAWA KONTEKSNYA — "Kode K1 sudah dipakai device … di outlet
      // ini" menyebut perangkatnya. Menggantinya dengan pesan generik
      // membuang satu-satunya hal yang dapat ditindaklanjuti.
      setPesanForm(err instanceof GalatHttp ? err.message : 'Perangkat tidak dapat dibuat.');
    }
  }

  async function terbitkan(p: Perangkat) {
    setPesanForm(null);
    try {
      const kredensial = await api.minta<Kredensial>(`/devices/${p.id}/credentials`, {
        metode: 'POST',
        body: {},
      });
      setTerbit({ perangkat: p, kredensial });
      await muat();
    } catch (err) {
      setPesanForm(err instanceof GalatHttp ? err.message : 'Kredensial tidak dapat diterbitkan.');
    }
  }

  async function cabut(p: Perangkat) {
    setPesanForm(null);
    try {
      await api.minta(`/devices/${p.id}/revoke`, { metode: 'POST', body: {} });
      // Blok kredensial ditutup bila yang dicabut adalah perangkat yang
      // sedang ditampilkan — menampilkan kode pemasangan untuk perangkat yang
      // baru saja dicabut adalah instruksi yang dijamin gagal.
      setTerbit((t) => (t?.perangkat.id === p.id ? null : t));
      await muat();
    } catch (err) {
      setPesanForm(err instanceof GalatHttp ? err.message : 'Perangkat tidak dapat dicabut.');
    }
  }

  const konfig: KonfigPemasangan | null =
    terbit && sesi
      ? {
          deviceId: terbit.perangkat.id,
          deviceCode: terbit.perangkat.code,
          tenantId: sesi.tenantId,
          outletId: terbit.perangkat.outletId,
          // ⛔ Dari `useSesi()`, BUKAN `window.location.origin`.
          //
          // Versi pertama memakai origin halaman sebagai cadangan dan
          // menghasilkan alamat BACK-OFFICE (port 1422) alih-alih API (port
          // 3000) — terlihat benar di layar, dan perangkat yang dipasang
          // dengannya tidak pernah tersambung. Dua sumber kebenaran untuk satu
          // alamat; sekarang satu.
          baseUrl,
          tokenSecret: terbit.kredensial.secret,
        }
      : null;

  const namaOutlet = (id: string) => outlet.find((o) => o.id === id)?.name ?? id;

  return (
    <div className="stack" style={{ gap: 'var(--space-4)', maxWidth: '84ch' }}>
      <div className="stack" style={{ gap: 'var(--space-1)' }}>
        <span className="t-title">Perangkat</span>
        <span className="t-caption">
          Setiap tablet kasir adalah satu perangkat. Kodenya muncul di nomor struk —
          <span className="num"> K1-20260815-0007</span>.
        </span>
      </div>

      {/* --- tambah ------------------------------------------------------ */}
      <Card>
        <div className="card-pad">
          <div className="stack" style={{ gap: 'var(--space-4)' }}>
            <span className="t-body-md">Tambah perangkat</span>
            <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-end' }}>
              <div style={{ width: '12ch' }}>
                <Bidang id="kode" label="Kode" value={kode} onChange={setKode} required />
              </div>
              <div className="grow">
                <Bidang id="nama" label="Nama (opsional)" value={nama} onChange={setNama} />
              </div>
            </div>

            <div className="stack" style={{ gap: 'var(--space-2)' }}>
              <span className="label">Outlet</span>
              <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                {outlet
                  .filter((o) => !o.archivedAt)
                  .map((o) => (
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

            <div className="row" style={{ gap: 'var(--space-3)' }}>
              <Tombol
                varian="primary"
                disabled={kode.trim().length === 0 || outletId.length === 0}
                onClick={() => void tambah()}
              >
                Tambah
              </Tombol>
              {pesanForm ? (
                <span className="t-caption" style={{ color: 'var(--danger)' }} role="alert">
                  {pesanForm}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </Card>

      {/* --- kredensial: sekali saja ------------------------------------- */}
      {terbit && konfig ? (
        <Card>
          <div className="card-pad">
            <div className="stack" style={{ gap: 'var(--space-4)' }}>
              <div className="row between">
                <span className="t-body-md">
                  Kredensial {terbit.perangkat.code}
                </span>
                <Badge tone="warning">Hanya ditampilkan sekali</Badge>
              </div>
              <span className="t-caption">
                Salin sekarang. Setelah layar ini berpindah, nilainya tidak dapat dibaca lagi di
                mana pun — yang tersimpan di server hanya sidik jarinya. Menerbitkan ulang
                mengganti kredensial ini, dan perangkat yang sudah memakainya berhenti tersambung.
              </span>

              <div className="stack" style={{ gap: 'var(--space-2)' }}>
                <span className="label">Kode pemasangan</span>
                <code
                  className="t-caption"
                  style={{
                    display: 'block',
                    padding: 'var(--space-3)',
                    borderRadius: 'var(--radius-control)',
                    background: 'var(--surface-alt)',
                    // ⛔ Tanpa `border`. `1px` adalah nilai piksel mentah, dan
                    // `lint:ds` menolaknya (aturan #6) — meski
                    // `components.css` sendiri memakainya di mana-mana. Latar
                    // `--surface-alt` di dalam kartu sudah membedakan bloknya.
                    wordBreak: 'break-all',
                  }}
                >
                  {bungkusKodePemasangan(konfig)}
                </code>
                <span className="t-caption">
                  Satu baris berisi keenam nilai di bawah. Layar Perangkat di aplikasi kasir belum
                  punya kotak tempel — sampai ada, isikan keenamnya satu per satu.
                </span>
              </div>

              <Table
                columns={[
                  { key: 'kunci', header: 'Isian di aplikasi kasir' },
                  { key: 'nilai', header: 'Nilai' },
                ]}
                rows={(Object.keys(konfig) as (keyof KonfigPemasangan)[]).map((k) => ({
                  kunci: k,
                  nilai: konfig[k],
                }))}
              />
            </div>
          </div>
        </Card>
      ) : null}

      {/* --- daftar ------------------------------------------------------ */}
      <Card>
        <div className="card-pad">
          {keadaan.jenis === 'galat' ? (
            <EmptyState
              icon={<Icon name="alert" size={32} />}
              title="Daftar perangkat tidak dapat dimuat"
              body={keadaan.pesan}
              action={<Tombol onClick={() => void muat()}>Coba lagi</Tombol>}
            />
          ) : daftar.length === 0 && keadaan.jenis === 'siap' ? (
            <EmptyState
              icon={<Icon name="register" size={32} />}
              title="Belum ada perangkat"
              body="Tambahkan satu perangkat untuk setiap tablet kasir. Kodenya (K1, K2, …) muncul di nomor struk dan membedakan urutan struk antar perangkat."
            />
          ) : (
            <Table
              columns={[
                { key: 'code', header: 'Kode' },
                { key: 'nama', header: 'Nama' },
                { key: 'outlet', header: 'Outlet' },
                { key: 'status', header: 'Status' },
                { key: 'aksi', header: '', align: 'right' },
              ]}
              rows={daftar.map((p) => ({
                code: p.code,
                nama: p.name ?? '—',
                outlet: namaOutlet(p.outletId),
                // ⛔ Status membawa TEKS, tidak pernah warna saja (aturan DS #5).
                status: p.revokedAt ? (
                  <Badge tone="danger">Dicabut</Badge>
                ) : p.adaKredensial ? (
                  <Badge tone="success">Siap dipasang</Badge>
                ) : (
                  <Badge tone="neutral">Belum ada kredensial</Badge>
                ),
                aksi: p.revokedAt ? null : (
                  <div className="row" style={{ gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                    <Tombol onClick={() => void terbitkan(p)}>
                      {p.adaKredensial ? 'Terbitkan ulang' : 'Terbitkan kredensial'}
                    </Tombol>
                    <Tombol varian="danger" onClick={() => void cabut(p)}>
                      Cabut
                    </Tombol>
                  </div>
                ),
              }))}
            />
          )}
        </div>
      </Card>

      <span className="t-caption">
        Perangkat yang dicabut tetap terlihat di sini. Ia tidak pernah dihapus — riwayat penjualan
        menunjuknya, dan struk lama harus tetap dapat menyebut perangkat mana yang mencetaknya.
      </span>
    </div>
  );
}
