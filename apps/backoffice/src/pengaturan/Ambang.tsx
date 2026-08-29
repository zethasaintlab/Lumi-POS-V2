import { useCallback, useEffect, useState } from 'react';
import { Badge, Card, EmptyState, Icon, Table } from 'ds';
import { useSesi } from '../../../../packages/klien-api/src/sesi.tsx';
import { GalatHttp } from '../../../../packages/klien-api/src/http.ts';
import { Tombol } from '../Tombol.tsx';
import { Bidang } from '../Bidang.tsx';
import {
  BAWAAN_TAMPIL,
  FORM_KOSONG,
  JUDUL_LAYAR,
  buatMuatanAmbang,
  formDariTersimpan,
  ringkasBerlaku,
  type FormAmbang,
} from './b26.ts';

/**
 * B-26 — Ambang Otorisasi (`IA:205`, akses minimum Manajer Area).
 *
 * ## ⛔ Layar ini mengubah kapan PIN manajer dituntut
 *
 * Ketiga ambangnya adalah kontrol, bukan preferensi: yang menaikkannya
 * mengurangi berapa kali orang lain harus dimintai izin. Karena itu setiap
 * perubahan menulis `threshold_changed` ke audit trail dengan nilai lama dan
 * barunya, dan layar menyebutkannya.
 *
 * ## ⛔ Manajer Outlet TIDAK dapat membukanya, dan itu bukan kekikiran
 *
 * Ambang inilah yang memutuskan kapan persetujuan Manajer Outlet dituntut.
 * Yang dapat menaikkannya dapat menghapus kebutuhan atas persetujuannya
 * sendiri — pemisahan tugas `spec-f:91` runtuh tanpa satu pun aturan terlihat
 * dilanggar. `IA:205` memberi layar ini ke Manajer Area, dan matriks
 * `threshold_settings` = {owner, area_manager} adalah pembacaan langsung
 * darinya.
 *
 * ## ⛔ Isian kosong berarti "pakai bawaan", dan tetap kosong
 *
 * Mengisi otomatis dengan angka bawaan menghapus pilihan itu diam-diam: sekali
 * disimpan, outlet berhenti mengikuti bawaan selamanya, dan tidak ada apa pun
 * di layar yang berbeda. Bawaannya muncul sebagai petunjuk, tidak pernah
 * sebagai nilai.
 *
 * ## ⛔ Per OUTLET, dan outletnya dipilih lebih dulu
 *
 * Ambang hidup di `outlet` (migrasi `0031` dan `0033`). Layar yang menyimpan
 * "untuk semua outlet" akan menimpa setelan cabang yang sengaja berbeda —
 * cabang bandara dan cabang perumahan tidak punya risiko kas yang sama.
 */

type Keadaan =
  | { jenis: 'memuat' }
  | { jenis: 'siap' }
  | { jenis: 'galat'; pesan: string };

interface Outlet {
  id: string;
  name: string;
  archivedAt: string | null;
}

interface RespAmbang {
  outletId: string;
  tersimpan: {
    diskonPersenSkala: string | null;
    diskonNominal: string | null;
    selisihKas: string | null;
    noSale: number | null;
  };
}

export function AmbangLayar() {
  const { api } = useSesi();
  const [outlet, setOutlet] = useState<Outlet[]>([]);
  const [outletId, setOutletId] = useState('');
  const [keadaan, setKeadaan] = useState<Keadaan>({ jenis: 'memuat' });
  const [form, setForm] = useState<FormAmbang>(FORM_KOSONG);
  const [tersimpan, setTersimpan] = useState<RespAmbang['tersimpan'] | null>(null);
  const [pesan, setPesan] = useState<string | null>(null);
  const [bidangGalat, setBidangGalat] = useState<keyof FormAmbang | null>(null);
  const [kabar, setKabar] = useState<string | null>(null);
  const [sedangKirim, setSedangKirim] = useState(false);

  useEffect(() => {
    let batal = false;
    void (async () => {
      try {
        const o = await api.minta<Outlet[]>('/outlets');
        if (batal) return;
        setOutlet(o);
        const pertama = o.find((x) => x.archivedAt === null);
        if (pertama) setOutletId(pertama.id);
        else setKeadaan({ jenis: 'siap' });
      } catch (err) {
        if (!batal) {
          setKeadaan({
            jenis: 'galat',
            pesan: err instanceof GalatHttp ? err.message : 'Daftar outlet tidak dapat dimuat.',
          });
        }
      }
    })();
    return () => {
      batal = true;
    };
  }, [api]);

  const muat = useCallback(async () => {
    if (outletId === '') return;
    setKeadaan({ jenis: 'memuat' });
    setPesan(null);
    setBidangGalat(null);
    try {
      const hasil = await api.minta<RespAmbang>(`/outlets/${outletId}/thresholds`);
      setTersimpan(hasil.tersimpan);
      setForm(formDariTersimpan(hasil.tersimpan));
      setKeadaan({ jenis: 'siap' });
    } catch (err) {
      setKeadaan({
        jenis: 'galat',
        pesan: err instanceof GalatHttp ? err.message : 'Ambang tidak dapat dimuat.',
      });
    }
  }, [api, outletId]);

  useEffect(() => {
    void muat();
  }, [muat]);

  async function simpan() {
    const hasil = buatMuatanAmbang(form);
    if (!hasil.ok) {
      setBidangGalat(hasil.bidang);
      setPesan(hasil.pesan);
      return;
    }
    setBidangGalat(null);
    setPesan(null);
    setSedangKirim(true);
    try {
      const resp = await api.minta<RespAmbang>(`/outlets/${outletId}/thresholds`, {
        metode: 'PUT',
        body: hasil.muatan,
      });
      setTersimpan(resp.tersimpan);
      setForm(formDariTersimpan(resp.tersimpan));
      setKabar(
        'Ambang tersimpan. Perubahan tercatat di Audit & Aktivitas dengan nilai lama dan barunya, ' +
          'dan berlaku untuk transaksi berikutnya — perangkat yang sedang offline memakai ambang ' +
          'lama sampai ia tersinkronisasi.'
      );
    } catch (err) {
      // `FORBIDDEN` mendarat di sini untuk Manajer Outlet, dan pesannya sudah
      // menyebut operasinya.
      setPesan(err instanceof GalatHttp ? err.message : 'Ambang tidak dapat disimpan.');
    } finally {
      setSedangKirim(false);
    }
  }

  const ubah = (bidang: keyof FormAmbang) => (nilai: string) => {
    setForm((f) => ({ ...f, [bidang]: nilai }));
    setPesan(null);
    setBidangGalat(null);
    setKabar(null);
  };
  const galat = (bidang: keyof FormAmbang) =>
    bidangGalat === bidang ? (pesan ?? undefined) : undefined;

  const aktif = outlet.filter((o) => o.archivedAt === null);

  return (
    <div className="stack" style={{ gap: 'var(--space-4)', maxWidth: '84ch' }}>
      <div className="stack" style={{ gap: 'var(--space-1)' }}>
        <span className="t-title">{JUDUL_LAYAR}</span>
        <span className="t-caption">
          Kapan kasir harus meminta PIN manajer. Angka yang lebih tinggi berarti lebih jarang
          diminta — dan lebih sedikit yang diperiksa orang kedua.
        </span>
      </div>

      {kabar ? (
        <Card>
          <div className="card-pad">
            <span className="t-body-md" role="status">
              {kabar}
            </span>
          </div>
        </Card>
      ) : null}

      {aktif.length > 1 ? (
        <Card>
          <div className="card-pad">
            <div className="stack" style={{ gap: 'var(--space-2)' }}>
              <span className="label">Outlet</span>
              <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                {aktif.map((o) => (
                  <Tombol
                    key={o.id}
                    varian={outletId === o.id ? 'primary' : 'secondary'}
                    onClick={() => {
                      setOutletId(o.id);
                      setKabar(null);
                    }}
                  >
                    {o.name}
                  </Tombol>
                ))}
              </div>
              {/* ⛔ Dinyatakan: ambang ini milik SATU outlet. Cabang bandara
                  dan cabang perumahan tidak punya risiko kas yang sama. */}
              <span className="t-caption">
                Ambang disimpan per outlet. Mengubahnya di sini tidak menyentuh cabang lain.
              </span>
            </div>
          </div>
        </Card>
      ) : null}

      {keadaan.jenis === 'galat' ? (
        <Card>
          <div className="card-pad">
            <EmptyState
              icon={<Icon name="alert" size={32} />}
              title="Ambang tidak dapat dimuat"
              body={keadaan.pesan}
              action={<Tombol onClick={() => void muat()}>Coba lagi</Tombol>}
            />
          </div>
        </Card>
      ) : null}

      {keadaan.jenis === 'siap' && tersimpan !== null ? (
        <>
          <Card>
            <div className="card-pad">
              <div className="stack" style={{ gap: 'var(--space-4)' }}>
                <span className="t-body-md">Yang berlaku sekarang</span>
                {/* ⛔ Asalnya disebut dengan TEKS. "Rp 20.000 (bawaan)" dan
                    "Rp 20.000 (disetel outlet ini)" berperilaku sama hari ini
                    dan berbeda pada hari bawaannya berubah. */}
                <Table
                  columns={[
                    { key: 'label', header: 'Menuntut PIN manajer' },
                    { key: 'nilai', header: 'Ambang', align: 'right' },
                    { key: 'asal', header: 'Asal' },
                  ]}
                  rows={ringkasBerlaku(tersimpan).map((b) => ({
                    label: b.label,
                    nilai: (
                      <span className="num" style={{ whiteSpace: 'nowrap' }}>
                        {b.nilai}
                      </span>
                    ),
                    asal: (
                      <Badge tone="neutral">
                        {b.asal === 'bawaan' ? 'Bawaan sistem' : 'Disetel outlet ini'}
                      </Badge>
                    ),
                  }))}
                />
              </div>
            </div>
          </Card>

          <Card>
            <div className="card-pad">
              <div className="stack" style={{ gap: 'var(--space-4)' }}>
                <span className="t-body-md">Ubah ambang</span>
                <span className="t-caption">
                  Kosongkan isian untuk mengikuti bawaan sistem. Nol berarti setiap kejadian
                  menuntut PIN — itu pilihan yang sah, bukan sama dengan kosong.
                </span>

                <div className="row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                  <div style={{ width: '22ch' }}>
                    <Bidang
                      id="diskonPersen"
                      label={`Diskon di atas % (bawaan ${BAWAAN_TAMPIL.diskonPersen})`}
                      value={form.diskonPersen}
                      error={galat('diskonPersen')}
                      onChange={ubah('diskonPersen')}
                    />
                  </div>
                  <div style={{ width: '26ch' }}>
                    <Bidang
                      id="diskonNominal"
                      label={`atau di atas Rp (bawaan ${BAWAAN_TAMPIL.diskonNominal})`}
                      value={form.diskonNominal}
                      error={galat('diskonNominal')}
                      onChange={ubah('diskonNominal')}
                    />
                  </div>
                </div>
                {/* ⛔ "ATAU", bukan "dan". Keduanya berlaku bersamaan, dan
                    yang menyala lebih dulu yang menuntut PIN — memeriksa satu
                    bentuk saja membuat setengah ambang tidak pernah menyala. */}
                <span className="t-caption">
                  Keduanya berlaku bersamaan: diskon yang melewati salah satunya menuntut PIN.
                </span>

                <div className="row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                  <div style={{ width: '26ch' }}>
                    <Bidang
                      id="selisihKas"
                      label={`Selisih kas di atas Rp (bawaan ${BAWAAN_TAMPIL.selisihKas})`}
                      value={form.selisihKas}
                      error={galat('selisihKas')}
                      onChange={ubah('selisihKas')}
                    />
                  </div>
                  <div style={{ width: '26ch' }}>
                    <Bidang
                      id="noSale"
                      label={`Buka laci bebas PIN per shift (bawaan ${BAWAAN_TAMPIL.noSale})`}
                      value={form.noSale}
                      error={galat('noSale')}
                      onChange={ubah('noSale')}
                    />
                  </div>
                </div>
                <span className="t-caption">
                  Selisih kas berlaku untuk kekurangan maupun kelebihan. Buka laci menghitung
                  pembukaan tanpa transaksi; pembukaan berikutnya setelah angka ini menuntut PIN.
                </span>

                <div className="row" style={{ gap: 'var(--space-3)' }}>
                  <Tombol varian="primary" disabled={sedangKirim} onClick={() => void simpan()}>
                    {sedangKirim ? 'Menyimpan…' : 'Simpan ambang'}
                  </Tombol>
                  <Tombol onClick={() => setForm(formDariTersimpan(tersimpan))}>Batalkan</Tombol>
                  {pesan && bidangGalat === null ? (
                    <span className="t-caption" style={{ color: 'var(--danger)' }} role="alert">
                      {pesan}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </Card>
        </>
      ) : null}

      <span className="t-caption">
        Ambang tidak dapat dimatikan — hanya angkanya yang dapat diubah. Kontrol yang dapat
        dimatikan adalah kontrol yang hilang pada hari seseorang membutuhkannya. Setiap perubahan
        tercatat di <strong>Audit &amp; Aktivitas</strong> beserta nilai lama, nilai baru, dan
        siapa yang mengubahnya.
      </span>
    </div>
  );
}
