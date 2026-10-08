import { useState } from 'react';
import { Bidang } from '../Bidang.tsx';
import { Tombol } from '../Tombol.tsx';
import { LatarDialog } from './LatarDialog.tsx';
import {
  MAKS_CATATAN,
  MAKS_NAMA_PEMESAN,
  MAKS_NOMOR_MEJA,
  bersihkanTeksPesanan,
  periksaCatatan,
  periksaNamaPemesan,
  periksaNomorMeja,
} from '../../../../packages/domain/src/data-pesanan.ts';

/* K-03 toolbar — Catatan, Pelanggan, No. Meja (spec § 4 baris 4–6; P5(b),
 * P6(a), keputusan user 28 September 2026). Satu dialog, tiga mode: ketiganya
 * satu kolom teks opsional dengan aturan yang sama.
 *
 * ⛔ Pemeriksaannya fungsi DOMAIN yang sama dengan `simpanPenjualan` dan
 * `POST /orders`. Dialog yang menerima apa yang server tolak membuat kasir
 * tahu terlambat — setelah uang diterima.
 *
 * ⛔ "Nama pemesan", bukan "Pelanggan" di kolomnya: nama SAJA, tanpa nomor
 * telepon (keputusan user). Tombol toolbar tetap berlabel "Pelanggan" (mockup).
 *
 * Kosong + Simpan = menghapus isinya (bukan galat: field opsional).
 * Scanner global mati selama dialog ini terbuka (`Kasir.tsx`, `aktif`). */

export type ModeTeksPesanan = 'catatan' | 'pelanggan' | 'meja';

const KONFIG: Record<
  ModeTeksPesanan,
  {
    judul: string;
    label: string;
    petunjuk: string;
    maks: number;
    periksa: (v: unknown) => { kode: string; pesan: string } | null;
  }
> = {
  catatan: {
    judul: 'Catatan pesanan',
    label: 'Catatan',
    petunjuk: `Tercetak di struk. Maksimal ${MAKS_CATATAN} karakter.`,
    maks: MAKS_CATATAN,
    periksa: periksaCatatan,
  },
  pelanggan: {
    judul: 'Nama pemesan',
    label: 'Nama pemesan',
    petunjuk: `Tercetak di struk sebagai "Atas nama". Nama saja. Maksimal ${MAKS_NAMA_PEMESAN} karakter.`,
    maks: MAKS_NAMA_PEMESAN,
    periksa: periksaNamaPemesan,
  },
  meja: {
    judul: 'Nomor meja',
    label: 'Nomor meja',
    petunjuk: `Tercetak di struk. Contoh: 4 atau A3. Maksimal ${MAKS_NOMOR_MEJA} karakter.`,
    maks: MAKS_NOMOR_MEJA,
    periksa: periksaNomorMeja,
  },
};

interface Props {
  mode: ModeTeksPesanan;
  awal: string | null;
  /** `null` = dikosongkan. */
  onSimpan: (nilai: string | null) => void;
  onBatal: () => void;
}

export function DialogTeksPesanan({ mode, awal, onSimpan, onBatal }: Props) {
  const k = KONFIG[mode];
  const [nilai, setNilai] = useState(awal ?? '');
  const [galat, setGalat] = useState<string | null>(null);

  const simpan = () => {
    const g = k.periksa(nilai);
    if (g !== null) {
      setGalat(g.pesan);
      return;
    }
    onSimpan(bersihkanTeksPesanan(nilai));
  };

  return (
    <LatarDialog label={k.judul} onBatal={onBatal}>
      <form
        className="kasir-dialog-form"
        onSubmit={(e) => {
          e.preventDefault();
          simpan();
        }}
      >
        <h2 className="t-title">{k.judul}</h2>

        <Bidang
          label={k.label}
          hint={k.petunjuk}
          value={nilai}
          onChange={(v) => {
            setNilai(v);
            setGalat(null);
          }}
          autoFokus
        />

        {galat !== null && (
          <p className="t-caption kasir-login-galat" role="alert">
            {galat}
          </p>
        )}

        <div className="kasir-dialog-aksi">
          <Tombol varian="ghost" kritis onClick={onBatal}>
            Batal
          </Tombol>
          <Tombol varian="primary" kritis onClick={simpan}>
            Simpan
          </Tombol>
        </div>
      </form>
    </LatarDialog>
  );
}
