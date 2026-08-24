import { useCallback, useEffect, useState } from 'react';
import { Badge, Card, EmptyState, Icon, Table } from 'ds';
import { useSesi } from '../sesi.tsx';
import { Tombol } from '../Tombol.tsx';
import { Bidang } from '../Bidang.tsx';
import {
  CATATAN_TOKEN,
  CATATAN_TULIS,
  JUDUL_LAYAR,
  PILIHAN_ALASAN,
  PILIHAN_DURASI,
  labelAlasan,
  pesanKeadaan,
  pesanLayar,
  type KeadaanLayar,
  type SesiSupport,
} from './banner.ts';
import { DURASI_BAWAAN_MENIT } from '../../../../packages/domain/src/sesi-support.ts';

/**
 * F.5 — Akses Support.
 *
 * ## ⛔ Layar ini memberikan akses ke SELURUH data merchant
 *
 * Bukan ke satu outlet, bukan ke satu laporan. Karena itu ia owner-only
 * (`spec-f:400`), alasannya wajib dari daftar tertutup, durasinya berbatas,
 * read-only adalah bawaan, dan setiap pemberian menulis audit.
 *
 * ## ⛔ Riwayat ada di layar yang sama, dan dapat dibaca semua peran
 *
 * "Berapa kali support masuk ke data kami, kapan, dan untuk apa" adalah
 * pertanyaan yang merchant berhak jawab tanpa meminta siapa pun. Formulir
 * pemberiannya yang owner-only; daftarnya tidak.
 */

interface Props {
  /** Dipanggil setelah daftar berubah, supaya banner di App ikut disegarkan. */
  onBerubah?: () => void;
}

type Keadaan =
  | { jenis: 'memuat' }
  | { jenis: 'gagal'; pesan: string }
  | { jenis: 'siap'; sesi: SesiSupport[] };

export function SupportLayar({ onBerubah }: Props) {
  const { api, sesi: sesiSaya } = useSesi();
  const [keadaan, setKeadaan] = useState<Keadaan>({ jenis: 'memuat' });
  const [adminLabel, setAdminLabel] = useState('');
  const [alasan, setAlasan] = useState('');
  const [catatan, setCatatan] = useState('');
  const [durasi, setDurasi] = useState(DURASI_BAWAAN_MENIT);
  const [bolehTulis, setBolehTulis] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);

  const muat = useCallback(async () => {
    try {
      const hasil = await api.minta<{ sessions: SesiSupport[] }>('/support-sessions');
      setKeadaan({ jenis: 'siap', sesi: hasil.sessions });
    } catch (e) {
      setKeadaan({ jenis: 'gagal', pesan: (e as Error).message });
    }
  }, [api]);

  useEffect(() => {
    void muat();
  }, [muat]);

  const owner = sesiSaya?.roles.includes('owner') ?? false;
  const catatanWajib = alasan === 'lainnya';
  const siap =
    adminLabel.trim() !== '' && alasan !== '' && (!catatanWajib || catatan.trim() !== '') && !sibuk;

  const beri = async () => {
    setSibuk(true);
    setGalat(null);
    try {
      const hasil = await api.minta<SesiSupport & { token: string }>('/support-sessions', {
        metode: 'POST',
        body: {
          adminLabel: adminLabel.trim(),
          reasonCode: alasan,
          reasonNote: catatan.trim() || null,
          durationMinutes: durasi,
          writeEnabled: bolehTulis,
        },
      });
      setToken(hasil.token);
      setAdminLabel('');
      setAlasan('');
      setCatatan('');
      setBolehTulis(false);
      await muat();
      onBerubah?.();
    } catch (e) {
      setGalat((e as Error).message);
    } finally {
      setSibuk(false);
    }
  };

  const akhiri = async (id: string) => {
    setSibuk(true);
    setGalat(null);
    try {
      await api.minta(`/support-sessions/${id}/end`, { metode: 'POST' });
      // ⛔ Token yang tampil DIHAPUS begitu sesinya berakhir. Kode yang masih
      // terlihat di layar untuk sesi yang sudah dicabut akan dikirim ke
      // seseorang dan gagal di tangannya, dan yang menerimanya menyimpulkan
      // sistemnya rusak alih-alih bahwa aksesnya memang sudah diputus.
      setToken(null);
      await muat();
      onBerubah?.();
    } catch (e) {
      setGalat((e as Error).message);
    } finally {
      setSibuk(false);
    }
  };

  const pesan = pesanLayar(keadaanLayar(keadaan));

  return (
    <div className="stack" style={{ gap: 'var(--space-4)' }}>
      <h1 className="t-title">{JUDUL_LAYAR}</h1>
      <p className="t-body-md">
        Petugas support Lumi tidak dapat melihat data Anda tanpa Anda memberikan akses di sini.
        Akses selalu berbatas waktu, tercatat, dan dapat Anda akhiri kapan saja.
      </p>

      {owner ? (
        <Card>
          <div className="stack" style={{ gap: 'var(--space-3)' }}>
            <h2 className="t-title">Beri akses</h2>

            <Bidang
              id="support-admin"
              label="Nama petugas support (mis. Rina — support Lumi)"
              value={adminLabel}
              onChange={setAdminLabel}
            />

            <fieldset>
              <legend className="t-body-md">Alasan</legend>
              {PILIHAN_ALASAN.map((a) => (
                <label key={a.kode} className="t-body-md" style={{ display: 'block' }}>
                  <input
                    type="radio"
                    name="alasan-support"
                    checked={alasan === a.kode}
                    disabled={sibuk}
                    onChange={() => setAlasan(a.kode)}
                  />{' '}
                  {a.label}
                </label>
              ))}
            </fieldset>

            {catatanWajib && (
              <Bidang
                id="support-catatan"
                label="Catatan — jelaskan alasannya"
                value={catatan}
                onChange={setCatatan}
              />
            )}

            <fieldset>
              <legend className="t-body-md">Berlaku selama</legend>
              {PILIHAN_DURASI.map((d) => (
                <label key={d.menit} className="t-body-md" style={{ display: 'block' }}>
                  <input
                    type="radio"
                    name="durasi-support"
                    checked={durasi === d.menit}
                    disabled={sibuk}
                    onChange={() => setDurasi(d.menit)}
                  />{' '}
                  {d.label}
                </label>
              ))}
            </fieldset>

            <label className="t-body-md" style={{ display: 'block' }}>
              <input
                type="checkbox"
                checked={bolehTulis}
                disabled={sibuk}
                onChange={(e) => setBolehTulis(e.target.checked)}
              />{' '}
              Izinkan petugas support MENGUBAH data
            </label>
            {/* ⛔ Konsekuensinya dinyatakan SEBELUM owner memilihnya, bukan
                sesudah. `spec-f:403` menuntut persetujuan terpisah untuk
                menulis, dan persetujuan yang tidak tahu apa yang disetujuinya
                bukan persetujuan. */}
            <p className="t-caption">{CATATAN_TULIS}</p>

            {galat && (
              <p className="t-body-md" role="alert">
                {galat}
              </p>
            )}

            <Tombol disabled={!siap} onClick={() => void beri()}>
              {sibuk ? 'Memproses…' : 'Beri akses'}
            </Tombol>
          </div>
        </Card>
      ) : (
        <p className="t-caption">
          Hanya Owner yang dapat memberi akses support. Anda tetap dapat melihat riwayatnya di
          bawah.
        </p>
      )}

      {token && (
        <Card>
          <div className="stack" style={{ gap: 'var(--space-2)' }}>
            <h2 className="t-title">Kode akses</h2>
            <p className="t-title num" style={{ wordBreak: 'break-all' }}>
              {token}
            </p>
            <p className="t-caption">{CATATAN_TOKEN}</p>
          </div>
        </Card>
      )}

      {pesan ? (
        <EmptyState
          icon={<Icon name="shield" size={32} />}
          title={keadaan.jenis === 'gagal' ? 'Riwayat tidak dapat dimuat' : 'Belum ada akses support'}
          body={pesan}
        />
      ) : keadaan.jenis === 'siap' ? (
        <Table
          columns={[
            { key: 'petugas', header: 'Petugas' },
            { key: 'alasan', header: 'Alasan' },
            { key: 'mulai', header: 'Mulai' },
            { key: 'akses', header: 'Akses' },
            { key: 'keadaan', header: 'Keadaan' },
            { key: 'aksi', header: '', align: 'right' },
          ]}
          rows={keadaan.sesi.map((s) => ({
            petugas: s.adminLabel,
            alasan: labelAlasan(s.reasonCode),
            mulai: new Date(s.startedAt).toLocaleString('id-ID'),
            // ⛔ Status tidak pernah warna saja (aturan design system #5) —
            // Badge-nya membawa teksnya.
            akses: (
              <Badge tone={s.writeEnabled ? 'warning' : 'neutral'}>
                {s.writeEnabled ? 'Baca & ubah' : 'Baca saja'}
              </Badge>
            ),
            keadaan: pesanKeadaan(s),
            aksi:
              s.state === 'aktif' && owner ? (
                <Tombol disabled={sibuk} onClick={() => void akhiri(s.id)}>
                  Akhiri sekarang
                </Tombol>
              ) : null,
          }))}
        />
      ) : null}
    </div>
  );
}

function keadaanLayar(k: Keadaan): KeadaanLayar {
  if (k.jenis === 'memuat') return 'memuat';
  if (k.jenis === 'gagal') return 'gagal';
  return k.sesi.length === 0 ? 'kosong' : 'siap';
}
