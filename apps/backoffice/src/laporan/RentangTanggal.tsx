import { Tombol } from '../Tombol.tsx';
import { Bidang } from '../Bidang.tsx';
import { rentangSiap, setelRentang, type Rentang } from './b16.ts';

/**
 * Pemilih rentang tanggal bisnis + outlet, dipakai SETIAP layar laporan.
 *
 * ⛔ Diangkat ke komponen sendiri saat B-17 menjadi pemakai kedua. Dua pemilih
 * yang menyimpang akan membuat satu laporan menerima rentang yang laporan lain
 * tolak — di aplikasi yang sama, pada hari yang sama.
 *
 * ⛔ Ia menjaga invariannya sendiri lewat `setelRentang`: menggeser tanggal
 * awal melewati tanggal akhir MENDORONG sisi lain, bukan menghasilkan error.
 * Server benar menolak `from > to` dengan 400; layar yang meneruskan penolakan
 * itu memberi error untuk maksud yang jelas.
 */

export interface Outlet {
  id: string;
  name: string;
  archivedAt: string | null;
}

interface Props {
  rentang: Rentang;
  onRentang: (r: Rentang) => void;
  outlet: Outlet[];
  outletId: string;
  onOutlet: (id: string) => void;
  sedangMuat: boolean;
  onTampilkan: () => void;
  /** Kalimat yang menjelaskan arti rentang di layar ini. */
  catatan: string;
}

export function RentangTanggal({
  rentang,
  onRentang,
  outlet,
  outletId,
  onOutlet,
  sedangMuat,
  onTampilkan,
  catatan,
}: Props) {
  const aktif = outlet.filter((o) => o.archivedAt === null);
  const ubah = (sisi: 'dari' | 'sampai') => (nilai: string) =>
    onRentang(setelRentang(rentang, sisi, nilai));

  return (
    <div className="stack" style={{ gap: 'var(--space-4)' }}>
      <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-end' }}>
        <div style={{ width: '20ch' }}>
          <Bidang id="dari" label="Dari tanggal" value={rentang.dari} required onChange={ubah('dari')} />
        </div>
        <div style={{ width: '20ch' }}>
          <Bidang
            id="sampai"
            label="Sampai tanggal"
            value={rentang.sampai}
            required
            onChange={ubah('sampai')}
          />
        </div>
        <Tombol
          varian="primary"
          disabled={!rentangSiap(rentang) || sedangMuat}
          onClick={onTampilkan}
        >
          {sedangMuat ? 'Menghitung…' : 'Tampilkan'}
        </Tombol>
      </div>

      {/* ⛔ Bukan basa-basi. Tanggal bisnis berakhir saat tutup shift (default
          04:00), bukan tengah malam — penjualan dini hari milik tanggal bisnis
          sebelumnya, dan itu yang server hitung. */}
      <span className="t-caption">
        Format <span className="num">YYYY-MM-DD</span>, keduanya termasuk. Yang dipakai adalah{' '}
        <strong>tanggal bisnis</strong>: hari berakhir saat tutup shift, bukan tengah malam, jadi
        penjualan dini hari masuk ke tanggal sebelumnya. {catatan}
      </span>

      {aktif.length > 1 ? (
        <div className="stack" style={{ gap: 'var(--space-2)' }}>
          <span className="label">Outlet</span>
          <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <Tombol varian={outletId === '' ? 'primary' : 'secondary'} onClick={() => onOutlet('')}>
              Semua outlet
            </Tombol>
            {aktif.map((o) => (
              <Tombol
                key={o.id}
                varian={outletId === o.id ? 'primary' : 'secondary'}
                onClick={() => onOutlet(o.id)}
              >
                {o.name}
              </Tombol>
            ))}
          </div>
          <span className="t-caption">
            Lintas-outlet diagregasi menurut tanggal bisnis masing-masing outlet — outlet di zona
            waktu berbeda tetap memakai batas harinya sendiri.
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** Hari ini di zona perangkat — hanya nilai AWAL pemilih, bukan sumbu laporan. */
export function hariIni(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
