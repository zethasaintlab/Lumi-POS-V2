import { useState } from 'react';
import { Bidang } from '../Bidang.tsx';
import { Tombol } from '../Tombol.tsx';
import { LatarDialog } from './LatarDialog.tsx';
import {
  MAKS_CATATAN,
  MAKS_NAMA_PEMESAN,
  MAKS_NOMOR_MEJA,
  normalkanTeksPesanan,
  periksaCatatan,
  periksaNamaPemesan,
  periksaNomorMeja,
} from '../../../../packages/domain/src/data-pesanan.ts';
import type { GalatBayar } from '../../../../packages/domain/src/pembayaran-manual.ts';

/* K-03 toolbar — Catatan, Pelanggan, No. Meja (spec § 4 baris 4-6; P5(b), P6(a)).
 *
 * ⛔ SATU dialog, tiga mode: ketiganya satu teks pendek yang ikut pesanan dan
 * tercetak di struk. Aturannya (batas, nomor kartu) milik
 * `packages/domain/src/data-pesanan.ts` — SAMA dengan server dan jalur tulis
 * `simpanPenjualan`; dialog hanya menampilkan pesannya, tidak mengulang aturan.
 *
 * ⛔ Pelanggan = NAMA SAJA (keputusan user): satu kolom, berlabel "Nama
 * pemesan", tanpa kolom telepon. Q7: ditegakkan lewat label dan satu kolom,
 * bukan penolakan pola telepon.
 *
 * Simpan dengan kolom kosong = menghapus isi. Batal tidak menyentuh isi lama.
 */

export type ModeTeksPesanan = 'catatan' | 'pelanggan' | 'meja';

const KONFIG: Record<
  ModeTeksPesanan,
  { judul: string; label: string; petunjuk: string; contoh: string; maks: number; periksa: (v: unknown) => GalatBayar | null }
> = {
  catatan: {
    judul: 'Catatan pesanan',
    label: 'Catatan',
    petunjuk: 'Tercetak di struk, mis. permintaan khusus untuk pesanan ini.',
    contoh: 'mis. tanpa gula',
    maks: MAKS_CATATAN,
    periksa: periksaCatatan,
  },
  pelanggan: {
    judul: 'Pelanggan',
    label: 'Nama pemesan',
    petunjuk: 'Nama saja, tercetak di struk sebagai "Atas nama".',
    contoh: 'mis. Budi',
    maks: MAKS_NAMA_PEMESAN,
    periksa: periksaNamaPemesan,
  },
  meja: {
    judul: 'No. Meja',
    label: 'Nomor meja',
    petunjuk: 'Tercetak di struk. Bukan pengelolaan meja.',
    contoh: 'mis. 4 atau A3',
    maks: MAKS_NOMOR_MEJA,
    periksa: periksaNomorMeja,
  },
};

interface Props {
  mode: ModeTeksPesanan;
  /** Isi saat ini; `null` = belum diisi. */
  nilai: string | null;
  onSimpan: (nilai: string | null) => void;
  onBatal: () => void;
}

export function DialogTeksPesanan({ mode, nilai, onSimpan, onBatal }: Props) {
  const k = KONFIG[mode];
  const [teks, setTeks] = useState(nilai ?? '');
  const galat = k.periksa(teks);

  const simpan = () => {
    if (galat !== null) return;
    onSimpan(normalkanTeksPesanan(teks));
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
        <p className="t-caption kasir-login-sub">{k.petunjuk}</p>

        <Bidang
          label={k.label}
          value={teks}
          onChange={setTeks}
          placeholder={k.contoh}
          hint={`${teks.trim().length} / ${k.maks} karakter`}
          autoFokus
        />

        {galat !== null && (
          <p className="t-caption kasir-login-galat" role="alert">
            {galat.pesan}
          </p>
        )}

        <div className="kasir-dialog-aksi">
          <Tombol varian="ghost" kritis onClick={onBatal}>
            Batal
          </Tombol>
          <Tombol varian="primary" kritis disabled={galat !== null} onClick={simpan}>
            Simpan
          </Tombol>
        </div>
      </form>
    </LatarDialog>
  );
}
