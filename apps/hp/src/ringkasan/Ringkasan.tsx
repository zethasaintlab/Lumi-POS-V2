import { useCallback, useEffect, useState } from 'react';
import { Card } from 'ds';
import { Tombol } from '../Tombol.tsx';
import { useSesi } from '../../../../packages/klien-api/src/sesi.tsx';
import { GalatHttp } from '../../../../packages/klien-api/src/http.ts';
import { rupiah } from '../../../../packages/domain/src/uang-tampilan.ts';
import {
  barisMetode,
  pesanLayar,
  rataRataTampil,
  tanggalTampil,
  trenTampil,
  CATATAN_ANTREAN,
  PESAN_METODE_KOSONG,
  type KeadaanLayar,
  type RingkasanHarian,
} from './m01.ts';

/**
 * M-01 — Ringkasan Hari Ini.
 *
 * ⛔ **Tanggalnya tidak pernah dihitung di sini.** Permintaan dikirim TANPA
 * `date`, dan server menjawab dengan tanggal bisnis yang ia hitung sendiri
 * dari jam database, zona outlet, dan jam tutupnya. Jam HP dapat salah — FR-F8
 * ada di produk ini justru karena jam perangkat berbohong cukup sering untuk
 * perlu dideteksi — dan HP yang jamnya maju satu hari akan meminta ringkasan
 * hari yang belum terjadi lalu menerima nol transaksi tanpa satu pun error.
 *
 * Tanggal yang dirender karena itu `data.tanggal`, bukan tanggal yang diminta.
 */

interface Outlet {
  id: string;
  name: string;
  archivedAt: string | null;
}

export function Ringkasan() {
  const { api } = useSesi();
  const [outlets, setOutlets] = useState<Outlet[] | null>(null);
  const [outletId, setOutletId] = useState<string>('');
  const [data, setData] = useState<RingkasanHarian | null>(null);
  const [keadaan, setKeadaan] = useState<KeadaanLayar>('memuat');

  // Daftar outlet dimuat sekali. Kegagalannya TIDAK menghentikan ringkasan:
  // tanpa outlet, permintaan lintas-outlet tetap sah selama seluruh outlet
  // sepakat zona waktunya.
  useEffect(() => {
    let batal = false;
    api
      .minta<Outlet[]>('/outlets')
      .then((hasil) => {
        if (!batal) setOutlets(hasil.filter((o) => o.archivedAt === null));
      })
      .catch(() => {
        if (!batal) setOutlets([]);
      });
    return () => {
      batal = true;
    };
  }, [api]);

  const muat = useCallback(async () => {
    setKeadaan('memuat');
    try {
      // ⛔ TANPA `date`. Lihat catatan kepala.
      const q = outletId === '' ? '' : `?outlet_id=${encodeURIComponent(outletId)}`;
      const hasil = await api.minta<RingkasanHarian>(`/reports/daily-summary${q}`);
      setData(hasil);
      setKeadaan('siap');
    } catch (err) {
      setData(null);
      // ⛔ Ketiga sebab dibedakan. "Tidak berhak" dan "hari ini ambigu" punya
      // tindakan yang sangat berbeda dari "coba lagi", dan menyatukannya
      // membuat owner menekan tombol yang tidak akan pernah menolongnya.
      if (err instanceof GalatHttp && err.status === 403) setKeadaan('tidak-berhak');
      else if (err instanceof GalatHttp && err.kode === 'BUSINESS_DATE_AMBIGUOUS')
        setKeadaan('ambigu');
      else setKeadaan('gagal');
    }
  }, [api, outletId]);

  useEffect(() => {
    void muat();
  }, [muat]);

  const pesan = pesanLayar(keadaan);
  const tren = data === null ? null : trenTampil(data.tren);
  const metode = data === null ? [] : barisMetode(data.perMetode);

  return (
    <div
      className="stack"
      style={{
        gap: 'var(--space-4)',
        padding: 'var(--space-4)',
        minHeight: '100dvh',
        background: 'var(--surface-sunk)',
      }}
    >
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="stack" style={{ gap: 'var(--space-1)' }}>
          <div className="t-caption">Ringkasan hari ini</div>
          <div className="t-title">{data === null ? '—' : tanggalTampil(data.tanggal)}</div>
        </div>
        {outlets !== null && outlets.length > 1 && (
          <select
            className="field"
            style={{ maxWidth: '18ch' }}
            value={outletId}
            aria-label="Outlet"
            onChange={(e) => setOutletId(e.target.value)}
          >
            <option value="">Semua outlet</option>
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {pesan !== null ? (
        <Card>
          <div className="card-pad stack" style={{ gap: 'var(--space-3)' }}>
            <div className="t-body-md">{pesan}</div>
            {/* ⛔ "Coba lagi" HANYA untuk keadaan yang mencoba lagi dapat
                memperbaikinya. Menawarkannya pada "tidak berhak" membuat owner
                menekannya berulang tanpa apa pun berubah. */}
            {keadaan === 'gagal' && (
              <Tombol varian="secondary" onClick={() => void muat()}>
                Coba lagi
              </Tombol>
            )}
          </div>
        </Card>
      ) : (
        data !== null && (
          <>
            <Card>
              <div className="card-pad stack" style={{ gap: 'var(--space-2)' }}>
                <div className="t-caption">Omzet bersih</div>
                {/* `.num` — angka uang selalu `tabular-nums` (aturan DS #4). */}
                <div className="t-display num">{rupiah(data.omzetBersih)}</div>
                <div className="t-body-md">
                  {data.jumlahTransaksi === 1
                    ? '1 transaksi'
                    : `${data.jumlahTransaksi} transaksi`}{' '}
                  · {rataRataTampil(data.rataRataPerTransaksi)}
                </div>
              </div>
            </Card>

            <Card>
              <div className="card-pad stack" style={{ gap: 'var(--space-2)' }}>
                <div className="t-caption">Dibanding kebiasaan</div>
                {/* ⛔ Panah TIDAK PERNAH sendirian — aturan DS #5. Katanya ada
                    di `teks`, dan itulah yang membawa artinya. */}
                <div className="t-body-md">
                  {tren !== null && tren.panah !== '' ? `${tren.panah} ` : ''}
                  {tren?.teks}
                </div>
              </div>
            </Card>

            <Card>
              <div className="card-pad stack" style={{ gap: 'var(--space-2)' }}>
                <div className="t-caption">Uang masuk per metode</div>
                {metode.length === 0 ? (
                  <div className="t-body-md">{PESAN_METODE_KOSONG}</div>
                ) : (
                  metode.map((m) => (
                    <div
                      key={m.kunci}
                      className="row"
                      style={{ justifyContent: 'space-between', gap: 'var(--space-3)' }}
                    >
                      <span className="t-body-md">{m.label}</span>
                      <span className="stack" style={{ alignItems: 'flex-end', gap: 0 }}>
                        <span className="t-body-md num">{m.nominal}</span>
                        <span className="t-caption">{m.jumlah}</span>
                      </span>
                    </div>
                  ))
                )}
              </div>
            </Card>

            {/* ⛔ Kalimat batas SELALU tampil, juga saat angkanya lengkap.
                Tanpa itu angka di layar dibaca sebagai "apa yang terjual"
                alih-alih "apa yang sudah sampai ke server". */}
            <div className="t-caption">{CATATAN_ANTREAN}</div>
          </>
        )
      )}
    </div>
  );
}
