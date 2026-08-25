import { Card } from 'ds';
import { Tombol } from '../Tombol.tsx';
import { rupiah } from '../../../../packages/domain/src/uang-tampilan.ts';
import {
  MAKS_TEMUAN_M01,
  judulJenis,
  outletTampil,
  ringkasTemuan,
  rinciTemuan,
  type PerluPerhatian,
} from '../perlu/m02.ts';
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
 *
 * ⛔ Pengambilan datanya ada di INDUK (`Beranda.tsx`), bukan di sini. M-02
 * menampilkan daftar yang sama yang bagian "perlu diperiksa" di layar ini
 * meringkas; dua permintaan untuk satu jawaban dapat berbeda, dan owner yang
 * membuka daftar dari "3 hal perlu diperiksa" lalu melihat empat baris tidak
 * punya cara memahami selisihnya.
 */

interface Outlet {
  id: string;
  name: string;
  archivedAt: string | null;
}

interface Props {
  data: RingkasanHarian | null;
  keadaan: KeadaanLayar;
  outlets: Outlet[] | null;
  outletId: string;
  onOutlet: (id: string) => void;
  onCobaLagi: () => void;
  /** `null` bila daftarnya belum berhasil dimuat — BEDA dari nol temuan. */
  perlu: PerluPerhatian | null;
  onBukaPerlu: () => void;
}

export function Ringkasan({
  data,
  keadaan,
  outlets,
  outletId,
  onOutlet,
  onCobaLagi,
  perlu,
  onBukaPerlu,
}: Props) {
  const pesan = pesanLayar(keadaan);
  const tren = data === null ? null : trenTampil(data.tren);
  const metode = data === null ? [] : barisMetode(data.perMetode);
  // ⛔ `null` (belum/ gagal dimuat) dan `0` (tidak ada temuan) sama-sama
  // menghasilkan bagian yang tidak tampil, dan itu benar untuk keduanya:
  // `spec-g:245` melarang bagiannya muncul tanpa temuan, dan bagian yang
  // muncul dengan "gagal memuat" di layar satu-pertanyaan ini menambah
  // pertanyaan alih-alih menjawabnya. Kegagalannya terlihat di M-02.
  const ringkas = perlu === null ? null : ringkasTemuan(perlu.jumlah);

  return (
    <div
      className="stack"
      style={{
        gap: 'var(--space-4)',
        padding: 'var(--space-4)',
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
            onChange={(e) => onOutlet(e.target.value)}
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
              <Tombol varian="secondary" onClick={onCobaLagi}>
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

            {/* ⛔ Muncul HANYA bila ada temuan — `spec-g:245`, acceptance
                criteria harfiah. Maksimal tiga (`IA:373`), dan jumlah PENUHNYA
                tetap disebut di judulnya: tiga dari sembilan yang tidak
                menyebut sembilan mengecilkan apa yang menunggu. */}
            {ringkas !== null && perlu !== null && (
              <Card>
                <div className="card-pad stack" style={{ gap: 'var(--space-2)' }}>
                  <div className="t-body-md">⚠ {ringkas}</div>
                  {perlu.temuan.slice(0, MAKS_TEMUAN_M01).map((t) => (
                    <div key={`${t.jenis}-${t.id}`} className="stack" style={{ gap: 0 }}>
                      <span className="t-caption">
                        {judulJenis(t.jenis)} · {outletTampil(t)}
                      </span>
                      <span className="t-body-md">{rinciTemuan(t)}</span>
                    </div>
                  ))}
                  <Tombol varian="secondary" onClick={onBukaPerlu}>
                    {perlu.jumlah > MAKS_TEMUAN_M01 ? `Lihat semua (${perlu.jumlah})` : 'Lihat detail'}
                  </Tombol>
                </div>
              </Card>
            )}

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
