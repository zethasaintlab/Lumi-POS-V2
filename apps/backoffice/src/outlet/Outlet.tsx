import { useCallback, useEffect, useState } from 'react';
import { Badge, Card, EmptyState, Icon, Table } from 'ds';
import { useSesi } from '../sesi.tsx';
import { GalatHttp } from '../http.ts';
import { Tombol } from '../Tombol.tsx';
import { Bidang } from '../Bidang.tsx';
import { hitungBaris, type Pemakaian } from '../langganan/kuota-tampilan.ts';
import { buatMuatanOutlet, urutkanOutlet, type FormOutlet, type Outlet } from './outlet.ts';
import {
  ZONA_WAKTU,
  LABEL_ZONA,
  type ZonaWaktu,
} from '../../../../packages/domain/src/zona-waktu.ts';

/**
 * B-23 — Outlet (`IA:§3.3`, akses minimum Manajer Area di tabel IA;
 * **owner-only** pada penulisan).
 *
 * ## ⛔ Layar ini TIDAK punya ubah maupun arsip, dan itu bukan kelalaian
 *
 * Kontraknya hanya punya `listOutlets` dan `createOutlet`. `PATCH
 * /outlets/{id}`, archive, dan restore **tidak ada** — meski kolom
 * `outlet.archived_at` ada di migrasi `0002` dan ikut di respons daftar.
 *
 * Daftar tanpa tombol "Ubah" terbaca seperti layar yang rusak, jadi layar
 * menyatakan batasnya. Ada test yang menyematkan daftar operasi di kontrak;
 * kalau endpointnya ditambahkan, test itu merah.
 *
 * ## ⛔ Kuota ditampilkan SEBELUM form
 *
 * Paket Free memberi `maxOutlets: 1`, dan outlet pertama sudah lahir bersama
 * tenant. Merchant Free karena itu **selalu** ditolak `QUOTA_EXCEEDED` saat
 * menambah — dan 403 setelah mengetik nama, alamat, dan memilih zona waktu
 * adalah cara paling buruk menyampaikannya.
 *
 * Baris kuotanya memakai `hitungBaris` yang sama dengan B-29; dua penghitung
 * untuk satu angka adalah dua penghitung yang akan menyimpang.
 *
 * ## ⛔ Owner-only, dan penolakannya dijelaskan
 *
 * `spec-f:29` memberi Owner "membuat outlet" dan `spec-f:30` menaruhnya di
 * kolom yang TIDAK BOLEH milik Manajer Area. `GET /tenants/usage` juga
 * owner-only — kegagalannya dipakai sebagai isyarat, bukan diperlakukan
 * sebagai kerusakan.
 */

type Keadaan = { jenis: 'memuat' } | { jenis: 'siap' } | { jenis: 'galat'; pesan: string };

const KOSONG: FormOutlet = { nama: '', zonaWaktu: 'Asia/Jakarta', alamat: '' };

export function OutletLayar() {
  const { api } = useSesi();
  const [keadaan, setKeadaan] = useState<Keadaan>({ jenis: 'memuat' });
  const [daftar, setDaftar] = useState<Outlet[]>([]);
  const [pemakaian, setPemakaian] = useState<Pemakaian | null>(null);
  const [bolehKelola, setBolehKelola] = useState(true);

  const [form, setForm] = useState<FormOutlet>(KOSONG);
  const [pesan, setPesan] = useState<string | null>(null);
  const [bidang, setBidang] = useState<keyof FormOutlet | null>(null);
  const [sedangKirim, setSedangKirim] = useState(false);
  // Id dibuat sekali per form — `POST /outlets` menjawab 409 untuk id yang
  // sama, dan itu yang menahan percobaan ulang jadi outlet kedua bernama sama.
  const [idBaru, setIdBaru] = useState(() => crypto.randomUUID());

  const muat = useCallback(async () => {
    setKeadaan({ jenis: 'memuat' });
    try {
      const o = await api.minta<Outlet[]>('/outlets');
      setDaftar(o);
      setKeadaan({ jenis: 'siap' });
    } catch (err) {
      setKeadaan({
        jenis: 'galat',
        pesan:
          err instanceof GalatHttp
            ? err.message
            : 'Tidak dapat menghubungi server. Periksa koneksi lalu coba lagi.',
      });
      return;
    }

    try {
      setPemakaian(await api.minta<Pemakaian>('/tenants/usage'));
      setBolehKelola(true);
    } catch (err) {
      // ⛔ Kegagalan di sini TIDAK menjatuhkan layar. `GET /tenants/usage`
      // owner-only, sama seperti `POST /outlets` — 403 di sini berarti aktor
      // ini memang tidak berhak menambah outlet, dan itu keadaan sah yang
      // layar jelaskan alih-alih tampilkan sebagai kerusakan.
      setPemakaian(null);
      if (err instanceof GalatHttp && err.status === 403) setBolehKelola(false);
    }
  }, [api]);

  useEffect(() => {
    void muat();
  }, [muat]);

  async function tambah() {
    setPesan(null);
    setBidang(null);

    const hasil = buatMuatanOutlet(form, idBaru);
    if (!hasil.ok) {
      setBidang(hasil.bidang);
      setPesan(hasil.pesan);
      return;
    }

    setSedangKirim(true);
    try {
      await api.minta('/outlets', { metode: 'POST', body: hasil.muatan });
      setForm(KOSONG);
      setIdBaru(crypto.randomUUID());
      await muat();
    } catch (err) {
      // `QUOTA_EXCEEDED` dan `FORBIDDEN` keduanya mendarat di sini, dan pesan
      // server MEMBAWA ANGKANYA (terpakai/batas). Menggantinya dengan pesan
      // generik membuang satu-satunya hal yang dapat ditindaklanjuti.
      setPesan(err instanceof GalatHttp ? err.message : 'Outlet tidak dapat dibuat.');
    } finally {
      setSedangKirim(false);
    }
  }

  const terurut = urutkanOutlet(daftar);
  const barisKuota = pemakaian ? hitungBaris('outlet', pemakaian.kuota.outlet) : null;
  const penuh = barisKuota?.status === 'penuh' || barisKuota?.status === 'terlampaui';
  const galat = (b: keyof FormOutlet) => (bidang === b ? (pesan ?? undefined) : undefined);

  return (
    <div className="stack" style={{ gap: 'var(--space-4)', maxWidth: '84ch' }}>
      <div className="stack" style={{ gap: 'var(--space-1)' }}>
        <span className="t-title">Outlet</span>
        <span className="t-caption">
          Setiap outlet punya zona waktunya sendiri, dan zona itu yang menentukan tanggal bisnis di
          seluruh laporan.
        </span>
      </div>

      {/* --- kuota, SEBELUM form ------------------------------------------- */}
      {barisKuota ? (
        <Card>
          <div className="card-pad">
            <div className="row between">
              <span className="t-body-md">
                {barisKuota.judul} terpakai{' '}
                <span className="num">
                  {barisKuota.terpakai}
                  {barisKuota.batas === null ? '' : ` dari ${barisKuota.batas}`}
                </span>
              </span>
              {/* ⛔ `label` dan `tone` datang dari `hitungBaris`, tidak
                  dihitung ulang di sini — B-29 memakai fungsi yang sama, dan
                  dua penghitung untuk satu angka akan menyimpang. Status
                  membawa TEKS, tidak pernah warna saja (aturan DS #5). */}
              <Badge tone={barisKuota.tone}>{barisKuota.label}</Badge>
            </div>
            {penuh ? (
              <span className="t-caption">
                Paket ini sudah memakai seluruh jatah outletnya. Naikkan paket di layar Langganan
                &amp; Batas untuk menambah outlet.
              </span>
            ) : null}
          </div>
        </Card>
      ) : null}

      {/* --- tambah -------------------------------------------------------- */}
      <Card>
        <div className="card-pad">
          {!bolehKelola ? (
            <EmptyState
              icon={<Icon name="lock" size={32} />}
              title="Hanya Owner yang dapat menambah outlet"
              body="Membuka outlet baru mengubah tagihan, jadi haknya melekat pada Owner — sama seperti billing. Anda tetap dapat melihat daftar outlet di bawah."
            />
          ) : (
            <div className="stack" style={{ gap: 'var(--space-4)' }}>
              <span className="t-body-md">Tambah outlet</span>

              <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
                <div className="grow">
                  <Bidang
                    id="nama-outlet"
                    label="Nama outlet"
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
                <div className="grow">
                  <Bidang
                    id="alamat-outlet"
                    label="Alamat (opsional)"
                    value={form.alamat}
                    onChange={(v) => setForm((f) => ({ ...f, alamat: v }))}
                  />
                </div>
              </div>

              <div className="stack" style={{ gap: 'var(--space-2)' }}>
                <span className="label">
                  Zona waktu<span style={{ color: 'var(--danger)' }}> *</span>
                </span>
                <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  {ZONA_WAKTU.map((z) => (
                    <Tombol
                      key={z}
                      varian={form.zonaWaktu === z ? 'primary' : 'secondary'}
                      onClick={() => setForm((f) => ({ ...f, zonaWaktu: z }))}
                    >
                      {LABEL_ZONA[z as ZonaWaktu]}
                    </Tombol>
                  ))}
                </div>
                {/* ⛔ Bukan hiasan. Tanggal bisnis berakhir saat tutup shift
                    dan dihitung di zona outlet — zona yang salah menggeser
                    setiap laporan harian sejak hari pertama, dan layar ini
                    tidak punya cara memperbaikinya nanti. */}
                <span className="t-caption">
                  Menentukan tanggal bisnis di laporan outlet ini. Belum dapat diubah setelah
                  outlet dibuat — periksa sebelum menyimpan.
                </span>
              </div>

              <div className="stack" style={{ gap: 'var(--space-2)' }}>
                <div className="row" style={{ gap: 'var(--space-3)' }}>
                  <Tombol
                    varian="primary"
                    disabled={sedangKirim || penuh}
                    onClick={() => void tambah()}
                  >
                    {sedangKirim ? 'Menyimpan…' : 'Tambah outlet'}
                  </Tombol>
                  {pesan && bidang === null ? (
                    <span className="t-caption" style={{ color: 'var(--danger)' }} role="alert">
                      {pesan}
                    </span>
                  ) : null}
                </div>
                <span className="t-caption">
                  Outlet baru memakai profil vertikal default tenant. Ubah per outlet di layar
                  Profil vertikal bila outlet ini perlu aturan berbeda.
                </span>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* --- daftar --------------------------------------------------------- */}
      <Card>
        <div className="card-pad">
          {keadaan.jenis === 'galat' ? (
            <EmptyState
              icon={<Icon name="alert" size={32} />}
              title="Daftar outlet tidak dapat dimuat"
              body={keadaan.pesan}
              action={<Tombol onClick={() => void muat()}>Coba lagi</Tombol>}
            />
          ) : terurut.length === 0 && keadaan.jenis === 'siap' ? (
            // Praktis mustahil: outlet pertama lahir bersama tenant. Ada
            // supaya layar punya keadaan kosong yang menjelaskan, bukan tabel
            // tanpa baris.
            <EmptyState
              icon={<Icon name="map-pin" size={32} />}
              title="Belum ada outlet"
              body="Tenant tanpa outlet tidak dapat berjualan sama sekali. Hubungi dukungan bila daftar ini kosong — outlet pertama seharusnya lahir bersama akun Anda."
            />
          ) : (
            <Table
              columns={[
                { key: 'nama', header: 'Outlet' },
                { key: 'zona', header: 'Zona waktu' },
                { key: 'alamat', header: 'Alamat' },
                { key: 'status', header: 'Status' },
              ]}
              rows={terurut.map((o) => ({
                nama: o.name,
                zona: LABEL_ZONA[o.timezone as ZonaWaktu] ?? o.timezone,
                alamat: o.address ?? '—',
                status: o.archivedAt ? (
                  <Badge tone="neutral">Diarsipkan</Badge>
                ) : (
                  <Badge tone="success">Aktif</Badge>
                ),
              }))}
            />
          )}
        </div>
      </Card>

      {/* ⛔ Batas dinyatakan, bukan didiamkan. Daftar tanpa tombol "Ubah"
          terbaca seperti layar yang rusak. */}
      <span className="t-caption">
        Nama, alamat, dan zona waktu outlet belum dapat diubah dari back-office — API-nya baru
        menyediakan pembuatan dan pembacaan. Outlet juga belum dapat diarsipkan sendiri. Hubungi
        dukungan bila salah satunya perlu diperbaiki.
      </span>
    </div>
  );
}
