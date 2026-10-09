import { useState } from 'react';
import {
  MAKS_CATATAN,
  MAKS_NAMA_PEMESAN,
  MAKS_NOMOR_MEJA,
  normalisasiTeksPesanan,
  periksaCatatan,
  periksaNamaPemesan,
  periksaNomorMeja,
} from '../../../../packages/domain/src/data-pesanan.ts';
import type { GalatBayar } from '../../../../packages/domain/src/pembayaran-manual.ts';
import { Bidang } from '../Bidang.tsx';
import { Tombol } from '../Tombol.tsx';
import { LatarDialog } from './LatarDialog.tsx';

/* K-03 toolbar — Catatan, Pelanggan, No. Meja (spec § 4 baris 4–6; P5(b),
 * P6(a)). SATU dialog, tiga mode: ketiganya masukan teks pendek opsional yang
 * ikut ke `order` dan struk.
 *
 * ⛔ Aturan DARI DOMAIN (`data-pesanan.ts`), bukan salinan: batas karakter dan
 * penolakan nomor kartu sama persis dengan server. Nama pemesan SATU kolom
 * teks — tanpa kolom telepon (keputusan user, Q7 tanpa penolakan pola).
 *
 * Simpan dengan kolom kosong MENGHAPUS isinya (mengosongkan = `null`), jadi
 * tidak ada tombol "Hapus" terpisah. Scanner global mati selama dialog ini
 * terbuka (`usePemindaiGlobal` di `Kasir.tsx`). */

export type ModeTeksPesanan = 'catatan' | 'pelanggan' | 'meja';

interface KonfigMode {
  judul: string;
  label: string;
  petunjuk: string;
  placeholder: string;
  maks: number;
  periksa: (nilai: unknown) => GalatBayar | null;
}

const MODE: Record<ModeTeksPesanan, KonfigMode> = {
  catatan: {
    judul: 'Catatan',
    label: 'Catatan pesanan',
    petunjuk: 'Tercetak di struk. Kosongkan lalu simpan untuk menghapus.',
    placeholder: 'mis. tanpa gula, es dipisah',
    maks: MAKS_CATATAN,
    periksa: periksaCatatan,
  },
  pelanggan: {
    judul: 'Pelanggan',
    label: 'Nama pemesan',
    petunjuk: 'Nama saja, tanpa nomor telepon. Tercetak di struk sebagai "Atas nama".',
    placeholder: 'mis. Budi',
    maks: MAKS_NAMA_PEMESAN,
    periksa: periksaNamaPemesan,
  },
  meja: {
    judul: 'No. Meja',
    label: 'Nomor meja',
    petunjuk: 'Tercetak di struk. Kosongkan lalu simpan untuk menghapus.',
    placeholder: 'mis. 4 atau A3',
    maks: MAKS_NOMOR_MEJA,
    periksa: periksaNomorMeja,
  },
};

interface Props {
  mode: ModeTeksPesanan;
  /** Isi tersimpan saat ini; `null` = belum diisi. */
  awal: string | null;
  onSimpan: (nilai: string | null) => void;
  onBatal: () => void;
}

export function DialogTeksPesanan({ mode, awal, onSimpan, onBatal }: Props) {
  const k = MODE[mode];
  const [teks, setTeks] = useState(awal ?? '');
  const galat = k.periksa(teks);
  const nilai = normalisasiTeksPesanan(teks);

  const kirim = () => {
    if (galat !== null) return;
    onSimpan(nilai);
  };

  return (
    <LatarDialog label={k.judul} onBatal={onBatal}>
      <form
        className="kasir-dialog-form"
        onSubmit={(e) => {
          e.preventDefault();
          kirim();
        }}
      >
        <h2 className="t-title">{k.judul}</h2>
        <p className="t-caption kasir-login-sub">{k.petunjuk}</p>

        <Bidang label={k.label} value={teks} onChange={setTeks} placeholder={k.placeholder} autoFokus />

        <p className="t-caption num">
          {teks.trim().length}/{k.maks}
        </p>

        {galat !== null && (
          <p className="t-body-md kasir-login-galat" role="alert">
            {galat.pesan}
          </p>
        )}

        <div className="kasir-dialog-aksi">
          <Tombol varian="ghost" kritis onClick={onBatal}>
            Batal
          </Tombol>
          <Tombol varian="primary" kritis disabled={galat !== null} onClick={kirim}>
            Simpan
          </Tombol>
        </div>
      </form>
    </LatarDialog>
  );
}
