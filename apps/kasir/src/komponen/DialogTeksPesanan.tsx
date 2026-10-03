import { useState } from 'react';
import { Bidang } from '../Bidang.tsx';
import { Tombol } from '../Tombol.tsx';
import { LatarDialog } from './LatarDialog.tsx';
import {
  MAKS_CATATAN,
  MAKS_NAMA_PEMESAN,
  MAKS_NOMOR_MEJA,
  periksaCatatan,
  periksaNamaPemesan,
  periksaNomorMeja,
  rapikanDataPesanan,
} from '../../../../packages/domain/src/data-pesanan.ts';

/* K-03 toolbar — Catatan, Pelanggan, No. Meja (spec § 4 baris 4–6; keputusan
 * user P5(b) dan P6(a)). SATU dialog, tiga mode, satu `Bidang`.
 *
 * ⛔ Nama saja, tanpa telepon (keputusan user): mode Pelanggan berlabel "Nama
 * pemesan" dengan SATU kolom teks, bukan "Nomor HP". Q7 terbuka, jadi tidak ada
 * penolakan pola telepon — yang ditolak hanya nomor kartu (FR-C5).
 *
 * ⛔ Aturannya dari `packages/domain/src/data-pesanan.ts`, pesan galatnya
 * kata demi kata dari sana — dialog, `simpanPenjualan`, dan server menolak hal
 * yang sama dengan kalimat yang sama.
 *
 * Kosong → `null` (menghapus isi yang sudah ada). Scanner global dimatikan
 * Kasir.tsx selama dialog terbuka: scanner HID mengetik ke kolom ini juga.
 */

export type ModeTeksPesanan = 'catatan' | 'pelanggan' | 'meja';

const KONFIG: Record<
  ModeTeksPesanan,
  { judul: string; label: string; petunjuk: string; contoh: string; maks: number; periksa: (v: unknown) => { pesan: string } | null }
> = {
  catatan: {
    judul: 'Catatan pesanan',
    label: 'Catatan',
    petunjuk: 'Tercetak di struk, sebelum daftar item.',
    contoh: 'mis. tanpa es, dibungkus terpisah',
    maks: MAKS_CATATAN,
    periksa: periksaCatatan,
  },
  pelanggan: {
    judul: 'Pelanggan',
    label: 'Nama pemesan',
    petunjuk: 'Nama saja — tercetak di struk sebagai "Atas nama".',
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
  /** Isi yang sudah tersimpan di keranjang; `null` = belum diisi. */
  awal: string | null;
  onSimpan: (nilai: string | null) => void;
  onBatal: () => void;
}

export function DialogTeksPesanan({ mode, awal, onSimpan, onBatal }: Props) {
  const k = KONFIG[mode];
  const [nilai, setNilai] = useState(awal ?? '');
  const galat = k.periksa(nilai);
  const siap = galat === null;

  const kirim = () => {
    if (!siap) return;
    onSimpan(rapikanDataPesanan(nilai));
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

        <Bidang
          label={k.label}
          hint={`Maksimal ${k.maks} karakter`}
          value={nilai}
          onChange={setNilai}
          placeholder={k.contoh}
          autoFokus
        />

        {galat && (
          <p className="t-body-md kasir-login-galat" role="alert">
            {galat.pesan}
          </p>
        )}

        <div className="kasir-dialog-aksi">
          <Tombol varian="ghost" kritis onClick={onBatal}>
            Batal
          </Tombol>
          <Tombol varian="primary" kritis disabled={!siap} onClick={kirim}>
            Simpan
          </Tombol>
        </div>
      </form>
    </LatarDialog>
  );
}
