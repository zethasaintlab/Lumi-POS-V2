import { Card } from 'ds';
import { Tombol } from '../Tombol.tsx';
import {
  CATATAN_TERTUNGGAK,
  judulJenis,
  outletTampil,
  pesanPerlu,
  rinciTemuan,
  type KeadaanPerlu,
  type PerluPerhatian,
} from './m02.ts';

/**
 * M-02 — Perlu Diperiksa. Drill-down dari peringatan di M-01 (`IA:247`).
 *
 * ⛔ Datanya diberikan INDUK, bukan diambil ulang di sini. M-01 sudah
 * memintanya untuk menampilkan ringkasannya; meminta lagi berarti dua
 * permintaan untuk satu jawaban, dan keduanya dapat berbeda — owner yang
 * membuka daftar dari "3 hal perlu diperiksa" lalu melihat empat baris tidak
 * punya cara memahami selisihnya.
 */

interface Props {
  data: PerluPerhatian | null;
  keadaan: KeadaanPerlu;
  onKembali: () => void;
  onCobaLagi: () => void;
}

export function PerluDiperiksa({ data, keadaan, onKembali, onCobaLagi }: Props) {
  const pesan = pesanPerlu(keadaan);

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
        <div className="t-caption">Perlu diperiksa</div>
        <div className="t-title">
          {data === null ? '—' : `${data.jumlah} hal`}
        </div>
        {/* ⛔ Kalimat batas SELALU tampil. Temuan berumur seminggu yang
            dicapai dari layar "Ringkasan Hari Ini" terbaca sebagai kejadian
            hari ini, dan owner memeriksa shift yang salah. */}
        <div className="t-caption">{CATATAN_TERTUNGGAK}</div>
      </div>

      {pesan !== null ? (
        <Card>
          <div className="card-pad stack" style={{ gap: 'var(--space-3)' }}>
            <div className="t-body-md">{pesan}</div>
            {keadaan === 'gagal' && (
              <Tombol varian="secondary" onClick={onCobaLagi}>
                Coba lagi
              </Tombol>
            )}
          </div>
        </Card>
      ) : (
        data !== null &&
        data.temuan.map((t) => (
          <Card key={`${t.jenis}-${t.id}`}>
            <div className="card-pad stack" style={{ gap: 'var(--space-1)' }}>
              {/* Status tidak pernah warna saja (aturan DS #5): jenisnya
                  adalah teks, dan teks itulah yang membawa artinya. */}
              <div className="t-caption">
                {judulJenis(t.jenis)} · {outletTampil(t)}
              </div>
              <div className="t-body-md">{rinciTemuan(t)}</div>
            </div>
          </Card>
        ))
      )}

      <Tombol varian="ghost" penuh onClick={onKembali}>
        Kembali ke ringkasan
      </Tombol>
    </div>
  );
}
