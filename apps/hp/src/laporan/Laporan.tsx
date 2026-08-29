import { useCallback, useEffect, useState } from 'react';
import { Card } from 'ds';
import { Tombol } from '../Tombol.tsx';
import { useSesi } from '../../../../packages/klien-api/src/sesi.tsx';
import { GalatHttp } from '../../../../packages/klien-api/src/http.ts';
import { rupiah } from '../../../../packages/domain/src/uang-tampilan.ts';
import {
  RENTANG,
  pesanLaporan,
  periodeTampil,
  rentangDari,
  type KeadaanLaporan,
  type PilihanRentang,
} from './m03.ts';

/**
 * M-03 — Laporan ringkas (`IA:248`, "subset dari back-office").
 *
 * ⛔ Angkanya dari `GET /reports/sales` — endpoint yang SAMA dengan B-16.
 * Menghitungnya sendiri di sini membuat owner melihat omzet berbeda tergantung
 * layar mana yang ia buka.
 *
 * ⛔ `dasar` datang dari M-01 (`tanggal` yang server hitung), bukan dari
 * `new Date()`. Jam HP dapat salah, dan rentang yang bergeser satu hari
 * menghasilkan angka yang tidak pernah cocok dengan laporan mana pun.
 */

interface Penjualan {
  omzetKotor: string;
  omzetBersih: string;
  pajakTerkumpul: string;
  jumlahTransaksi: number;
  rataRataPerTransaksi: string;
}

interface Props {
  /** Tanggal bisnis dari server. `null` bila M-01 belum berhasil memuatnya. */
  dasar: string | null;
  outletId: string;
}

export function Laporan({ dasar, outletId }: Props) {
  const { api } = useSesi();
  const [pilihan, setPilihan] = useState<PilihanRentang>(RENTANG[0]);
  const [data, setData] = useState<Penjualan | null>(null);
  const [keadaan, setKeadaan] = useState<KeadaanLaporan>('memuat');

  const muat = useCallback(async () => {
    if (dasar === null) return;
    setKeadaan('memuat');
    try {
      const { from, to } = rentangDari(dasar, pilihan);
      const outlet = outletId === '' ? '' : `&outlet_id=${encodeURIComponent(outletId)}`;
      const hasil = await api.minta<{ penjualan: Penjualan }>(
        `/reports/sales?from=${from}&to=${to}${outlet}`
      );
      setData(hasil.penjualan);
      setKeadaan('siap');
    } catch (err) {
      setData(null);
      setKeadaan(err instanceof GalatHttp && err.status === 403 ? 'tidak-berhak' : 'gagal');
    }
  }, [api, dasar, outletId, pilihan]);

  useEffect(() => {
    void muat();
  }, [muat]);

  const pesan =
    dasar === null
      ? // ⛔ Dibedakan dari "gagal". Tanpa tanggal dasar, rentangnya tidak dapat
        // dihitung sama sekali — dan menghitungnya dari jam HP adalah persis
        // yang aturan di kepala berkas ini larang.
        'Tanggal hari ini belum diketahui. Buka Ringkasan lebih dulu.'
      : pesanLaporan(keadaan);
  const { from, to } = dasar === null ? { from: '', to: '' } : rentangDari(dasar, pilihan);

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
      <div className="stack" style={{ gap: 'var(--space-1)' }}>
        <div className="t-caption">Laporan penjualan</div>
        {/* ⛔ Periodenya SELALU tampil bersama angkanya. Angka tanpa periode
            tidak dapat dipakai memutuskan apa pun. */}
        <div className="t-title">{dasar === null ? '—' : periodeTampil(from, to)}</div>
      </div>

      <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        {RENTANG.map((r) => (
          <Tombol
            key={r.id}
            varian={r.id === pilihan.id ? 'primary' : 'secondary'}
            onClick={() => setPilihan(r)}
          >
            {r.label}
          </Tombol>
        ))}
      </div>

      {pesan !== null ? (
        <Card>
          <div className="card-pad stack" style={{ gap: 'var(--space-3)' }}>
            <div className="t-body-md">{pesan}</div>
            {keadaan === 'gagal' && dasar !== null && (
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
                <div className="t-display num">{rupiah(data.omzetBersih)}</div>
                {/* ⛔ "Setelah void & refund" disebut. Owner yang
                    membandingkannya dengan omzet kotor tanpa tahu bedanya akan
                    menyimpulkan angkanya salah. */}
                <div className="t-caption">Setelah void &amp; refund</div>
              </div>
            </Card>

            <Card>
              <div className="card-pad stack" style={{ gap: 'var(--space-2)' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="t-body-md">Omzet kotor</span>
                  <span className="t-body-md num">{rupiah(data.omzetKotor)}</span>
                </div>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="t-body-md">Pajak terkumpul</span>
                  <span className="t-body-md num">{rupiah(data.pajakTerkumpul)}</span>
                </div>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="t-body-md">Transaksi</span>
                  <span className="t-body-md num">
                    {data.jumlahTransaksi === 1
                      ? '1 transaksi'
                      : `${data.jumlahTransaksi} transaksi`}
                  </span>
                </div>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="t-body-md">Rata-rata</span>
                  <span className="t-body-md num">
                    {rupiah(data.rataRataPerTransaksi)} per transaksi
                  </span>
                </div>
              </div>
            </Card>

            {/* Batas yang dinyatakan: ekspor dan rincian per produk tetap di
                back-office. Layar 390px yang memuat sembilan laporan adalah
                navigasi yang `IA:229` justru menolak. */}
            <div className="t-caption">
              Rincian per produk, per kasir, dan ekspor ada di back-office.
            </div>
          </>
        )
      )}
    </div>
  );
}
