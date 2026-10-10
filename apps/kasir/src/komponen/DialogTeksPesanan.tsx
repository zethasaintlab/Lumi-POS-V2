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
import type { GalatBayar } from '../../../../packages/domain/src/pembayaran-manual.ts';

/* K-03 toolbar -- Catatan, Pelanggan, No. Meja (spec § 4 baris 4-6; P5, P6).
 *
 * ⛔ SATU dialog, tiga mode, SATU kolom teks. Pelanggan berlabel "Nama
 * pemesan" dan tidak punya kolom telepon: keputusan user P5 "nama pelanggan
 * saja, tanpa nomor telepon" ditegakkan lewat label dan satu kolom, bukan
 * lewat pola (Q7).
 *
 * ⛔ Aturannya dari `packages/domain/src/data-pesanan.ts` -- yang SAMA dengan
 * `simpanPenjualan` dan server. Nomor kartu ditolak di sini dengan pesan
 * domain; dialog tetap terbuka, nilainya tidak disimpan.
 *
 * Kolom kosong lalu Simpan = menghapus nilainya (field opsional). Dialog
 * dibuka dari tombol toolbar, jadi `Kasir.tsx` mematikan pemindai global
 * selama dialog terbuka (`aktif` pada `usePemindaiGlobal`). */

export type ModeTeksPesanan = 'catatan' | 'pelanggan' | 'meja';

const KONFIG: Record<
  ModeTeksPesanan,
  { judul: string; label: string; petunjuk: string; contoh: string; maks: number; periksa: (v: unknown) => GalatBayar | null }
> = {
  catatan: {
    judul: 'Catatan pesanan',
    label: 'Catatan',
    petunjuk: 'Dicetak di struk, sebelum daftar item.',
    contoh: 'mis. tanpa es, gula sedikit',
    maks: MAKS_CATATAN,
    periksa: periksaCatatan,
  },
  pelanggan: {
    judul: 'Pelanggan',
    label: 'Nama pemesan',
    petunjuk: 'Nama saja, untuk memanggil pesanan. Dicetak di struk.',
    contoh: 'mis. Budi',
    maks: MAKS_NAMA_PEMESAN,
    periksa: periksaNamaPemesan,
  },
  meja: {
    judul: 'Nomor meja',
    label: 'Nomor meja',
    petunjuk: 'Dicetak di struk dan disimpan sebagai data pesanan.',
    contoh: 'mis. A-12',
    maks: MAKS_NOMOR_MEJA,
    periksa: periksaNomorMeja,
  },
};

interface Props {
  mode: ModeTeksPesanan;
  /** Nilai tersimpan; `null` = belum diisi. */
  nilaiAwal: string | null;
  onSimpan: (nilai: string | null) => void;
  onBatal: () => void;
}

export function DialogTeksPesanan({ mode, nilaiAwal, onSimpan, onBatal }: Props) {
  const k = KONFIG[mode];
  const [nilai, setNilai] = useState(nilaiAwal ?? '');
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
        <p className="t-caption kasir-login-sub">{k.petunjuk}</p>

        <Bidang
          label={k.label}
          value={nilai}
          onChange={(v) => {
            setNilai(v);
            setGalat(null);
          }}
          placeholder={k.contoh}
          autoFokus
        />
        <p className="t-caption">
          <span className="num">{nilai.trim().length}</span> / <span className="num">{k.maks}</span> karakter
        </p>

        {galat !== null && (
          <p className="t-body-md kasir-login-galat" role="alert">
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
