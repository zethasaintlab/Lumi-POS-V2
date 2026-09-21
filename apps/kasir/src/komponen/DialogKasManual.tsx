import { useState } from 'react';
import { catatKasManual, type HasilKasManual } from '../kas/manual.ts';
import { Tombol } from '../Tombol.tsx';
import { Bidang } from '../Bidang.tsx';
import { useDbLokal } from '../konteks/DbLokalProvider.tsx';
import { muatHlc } from '../lokal/hlc.ts';
import {
  alasanUntuk,
  periksaKas,
  type ArahKas,
} from '../../../../packages/domain/src/kas-manual.ts';
import type { KonfigPerangkat } from '../../../../packages/sync-client/src/perangkat.ts';
import type { Sesi } from '../identitas/login.ts';
import { rupiah } from '../../../../packages/domain/src/uang-tampilan.ts';
import { LatarDialog } from './LatarDialog.tsx';

/* FR-D5 — kas masuk & kas keluar. Dialog, bukan layar: pola yang sama dengan
   K-16 (`IA:66`), dan alasan yang sama — ia tidak punya keadaan sendiri untuk
   dipulihkan lewat URL.

   ⛔ Kenapa ia harus ada DI KASIR dan bukan hanya di back-office: uang keluar
   dari laci di konter, saat shift berjalan, dan sering justru saat internet
   mati. Owner yang mengambil Rp 500.000 untuk membayar pemasok tanpa cara
   mencatatnya membuat tutup kas melaporkan kekurangan Rp 500.000 — selisih
   yang sepenuhnya dapat dijelaskan, tetapi menuntut otorisasi manajer dan
   menandai kasirnya di laporan exception FR-G5.

   ⛔ Arahnya dipilih SEBELUM jumlahnya, dan jumlahnya selalu positif. Kolom
   bertanda membuat "-50000" untuk kas masuk menjadi masukan yang sah bagi
   layar dan salah bagi laci; tandanya diturunkan `periksaKas` di domain, satu
   tempat, dipakai server juga. */

const LABEL_ALASAN: Record<string, string> = {
  // Masuk
  tambah_modal: 'Tambah modal laci',
  kembalian_dari_bank: 'Ambil pecahan dari bank',
  setoran_pemilik: 'Setoran pemilik',
  // Keluar
  bayar_pemasok: 'Bayar pemasok',
  biaya_operasional: 'Biaya operasional',
  ambil_pemilik: 'Diambil pemilik',
  setor_ke_bank: 'Setor ke bank',
  // Keduanya
  koreksi_pencatatan: 'Koreksi pencatatan',
  lainnya: 'Lainnya',
};

interface Props {
  shiftId: string;
  konfig: KonfigPerangkat;
  sesi: Sesi;
  onBatal: () => void;
  onSelesai: (hasil: Extract<HasilKasManual, { status: 'tercatat' }>, arah: ArahKas) => void;
}

export function DialogKasManual({ shiftId, konfig, sesi, onBatal, onSelesai }: Props) {
  const { db, pemberitahu } = useDbLokal();
  const [arah, setArah] = useState<ArahKas>('keluar');
  const [teks, setTeks] = useState('');
  const [kode, setKode] = useState('');
  const [catatan, setCatatan] = useState('');
  const [galat, setGalat] = useState<string | null>(null);
  const [menyimpan, setMenyimpan] = useState(false);

  /* ⛔ Rupiah utuh, tanpa titik dan tanpa desimal — aturan yang sama dengan
     nominal diskon. Digit saja; string kosong menjadi 0n dan ditolak domain
     seperti nol yang diketik sungguhan. */
  const jumlah = /^\d+$/.test(teks) ? BigInt(teks) : 0n;
  const periksa = periksaKas({ arah, jumlah, alasan: kode, catatan: catatan.trim() || null });
  const siap = periksa.ok && !menyimpan;

  /* ⛔ Mengganti arah MENGOSONGKAN alasannya. Daftar keduanya tidak
     berpotongan kecuali dua entri, dan alasan yang tertinggal dari daftar
     sebelumnya akan ditolak domain dengan pesan yang tidak menyebut bahwa
     arahnyalah yang berubah. */
  const gantiArah = (a: ArahKas) => {
    setArah(a);
    setKode('');
    setGalat(null);
  };

  const jalankan = () => {
    setMenyimpan(true);
    setGalat(null);
    void muatHlc(db, () => Date.now())
      .then((hlc) =>
        catatKasManual({
          db,
          konfig,
          sesi,
          shiftId,
          arah,
          jumlah,
          alasan: { kode, catatan: catatan.trim() || null },
          waktu: () => new Date(),
          idBaru: () => crypto.randomUUID(),
          hlc: () => hlc.tick(),
        })
      )
      .then((hasil) => {
        if (hasil.status === 'tercatat') {
          pemberitahu.beritahu();
          onSelesai(hasil, arah);
          return;
        }
        setGalat(pesanGagal(hasil));
      })
      .catch((e: Error) => setGalat(`Kas TIDAK tercatat: ${e.message}`))
      .finally(() => setMenyimpan(false));
  };

  return (
    <LatarDialog label="Kas masuk/keluar" onBatal={onBatal}>
        <h2 className="t-title">Kas masuk / keluar</h2>
        <p className="t-caption kasir-login-sub">
          Uang yang berpindah di luar penjualan. Tanpa dicatat di sini, selisihnya muncul saat tutup
          kas dan menuntut otorisasi manajer.
        </p>

        <fieldset className="kasir-alasan">
          <legend className="t-body-md">Arah</legend>
          <label className="kasir-alasan-opsi t-body-md">
            <input
              type="radio"
              name="arah-kas"
              checked={arah === 'keluar'}
              disabled={menyimpan}
              onChange={() => gantiArah('keluar')}
            />
            Uang keluar dari laci
          </label>
          <label className="kasir-alasan-opsi t-body-md">
            <input
              type="radio"
              name="arah-kas"
              checked={arah === 'masuk'}
              disabled={menyimpan}
              onChange={() => gantiArah('masuk')}
            />
            Uang masuk ke laci
          </label>
        </fieldset>

        <Bidang
          label="Jumlah (Rp)"
          inputMode="numeric"
          value={teks}
          onChange={(v) => setTeks(v.replace(/[^\d]/g, ''))}
          placeholder="mis. 500000"
        />
        <p className="t-caption">
          {jumlah > 0n ? (
            <>
              {arah === 'keluar' ? 'Laci berkurang ' : 'Laci bertambah '}
              <span className="num">{rupiah(jumlah)}</span>.
            </>
          ) : (
            'Masukkan rupiah utuh, tanpa titik dan tanpa desimal.'
          )}
        </p>

        <fieldset className="kasir-alasan">
          <legend className="t-body-md">Alasan</legend>
          {alasanUntuk(arah).map((a) => (
            <label key={a} className="kasir-alasan-opsi t-body-md">
              <input
                type="radio"
                name="alasan-kas"
                checked={kode === a}
                disabled={menyimpan}
                onChange={() => setKode(a)}
              />
              {LABEL_ALASAN[a] ?? a}
            </label>
          ))}
        </fieldset>

        {kode === 'lainnya' && (
          <textarea
            className="kasir-catatan"
            value={catatan}
            onChange={(e) => setCatatan(e.target.value)}
            placeholder="Jelaskan alasannya"
            rows={2}
          />
        )}

        {/* ⛔ Alasan penolakan DITAMPILKAN sebelum kasir menekan tombol, bukan
            sesudahnya. Tombol yang mati tanpa penjelasan (aturan yang sama
            dengan pilihan modifier, `spec-a:126`) membuat kasir menyimpulkan
            aplikasinya rusak. */}
        {!periksa.ok && (teks !== '' || kode !== '') && (
          <p className="t-caption" role="status">
            {periksa.pesan}
          </p>
        )}

        {galat && (
          <p className="t-body-md kasir-login-galat" role="alert">
            {galat}
          </p>
        )}

        <p className="t-caption">
          Tercatat atas nama Anda di jejak audit. Tidak memerlukan persetujuan manajer.
        </p>

        <div className="kasir-dialog-aksi">
          <Tombol varian="ghost" kritis disabled={menyimpan} onClick={onBatal}>
            Batal
          </Tombol>
          <Tombol varian="primary" kritis disabled={!siap} onClick={jalankan}>
            {menyimpan ? 'Mencatat…' : 'Catat'}
          </Tombol>
        </div>
    </LatarDialog>
  );
}

function pesanGagal(hasil: HasilKasManual): string {
  switch (hasil.status) {
    case 'shift_tidak_terbuka':
      return 'Shift sudah ditutup. Kas tidak dapat dicatat lagi ke shift ini.';
    case 'ditolak':
      return hasil.pesan;
    default:
      return 'Kas gagal dicatat.';
  }
}
