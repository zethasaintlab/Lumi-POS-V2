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

/* K-03 toolbar — Catatan, Pelanggan, No. Meja (P5(b), P6(a)). SATU dialog,
   tiga mode: tiga dialog kembar akan menyimpang pada hal yang sama (batas,
   nomor kartu).

   ⛔ Aturannya `packages/domain/src/data-pesanan.ts`, fungsi yang sama dengan
   server dan `simpanPenjualan`. Pesan galat dari domain KATA DEMI KATA —
   kasir membaca kalimat yang sama di perangkat dan di antrean.

   ⛔ "Pelanggan" = NAMA saja (keputusan user, tanpa nomor telepon): satu kolom,
   berlabel "Nama pemesan". Itu yang menegakkannya, bukan penolakan pola (Q7).

   Kosong atau spasi saja → `null`: tersimpan sebagai "tidak diisi". */

export type ModeTeksPesanan = 'catatan' | 'pelanggan' | 'meja';

const KONFIG: Record<
  ModeTeksPesanan,
  { judul: string; label: string; bantuan: string; periksa: (v: unknown) => GalatBayar | null }
> = {
  catatan: {
    judul: 'Catatan pesanan',
    label: 'Catatan',
    bantuan: `Paling banyak ${MAKS_CATATAN} karakter. Dicetak di struk.`,
    periksa: periksaCatatan,
  },
  pelanggan: {
    judul: 'Pelanggan',
    label: 'Nama pemesan',
    bantuan: `Nama saja, paling banyak ${MAKS_NAMA_PEMESAN} karakter.`,
    periksa: periksaNamaPemesan,
  },
  meja: {
    judul: 'No. Meja',
    label: 'Nomor meja',
    bantuan: `Paling banyak ${MAKS_NOMOR_MEJA} karakter, mis. A-07.`,
    periksa: periksaNomorMeja,
  },
};

interface Props {
  mode: ModeTeksPesanan;
  /** Nilai tersimpan; `null` = belum diisi. */
  nilaiAwal: string | null;
  /** Dipanggil dengan teks yang sudah dibersihkan, atau `null` bila dikosongkan. */
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
        <p className="t-caption kasir-login-sub">{k.bantuan} Kosongkan untuk menghapus.</p>

        <Bidang
          label={k.label}
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
