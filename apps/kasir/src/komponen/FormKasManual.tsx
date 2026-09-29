import { useRef, useState } from 'react';
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
import { bacaRupiah, rupiah } from '../../../../packages/domain/src/uang-tampilan.ts';

/* FR-D5 — kas masuk & kas keluar, sebagai KARTU di layar Laci kas (K-18).

   Sampai Task 4 (kampanye Hidupkan desain, 26 September 2026) ini dialog yang
   dibuka dari toolbar K-03 (`DialogKasManual`). Logikanya dipindah apa adanya —
   `catatKasManual` dan `periksaKas` tidak disentuh — yang berubah hanya
   wadahnya: kartu kiri layar sendiri, dan jumlah dibaca `bacaRupiah`.

   ⛔ Kenapa ia harus ada DI KASIR dan bukan hanya di back-office: uang keluar
   dari laci di konter, saat shift berjalan, dan sering justru saat internet
   mati. Owner yang mengambil Rp 500.000 untuk membayar pemasok tanpa cara
   mencatatnya membuat tutup kas melaporkan kekurangan Rp 500.000 — selisih
   yang sepenuhnya dapat dijelaskan, tetapi menuntut otorisasi manajer dan
   menandai kasirnya di laporan exception FR-G5.

   ⛔ Arahnya dipilih SEBELUM jumlahnya, dan jumlahnya selalu positif. Kolom
   bertanda membuat "-50000" untuk kas masuk menjadi masukan yang sah bagi
   layar dan salah bagi laci; tandanya diturunkan `periksaKas` di domain, satu
   tempat, dipakai server juga.

   ⛔ Form ini TIDAK menampilkan saldo laci — bukan sebelum, bukan sesudah
   tersimpan (hitungan buta FR-D2). Konfirmasinya menyebut arah dan jumlah
   yang baru dicatat, tidak pernah hasil penjumlahannya. */

export const LABEL_ALASAN: Record<string, string> = {
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
  /** Dipanggil SESUDAH transaksi lokal ter-commit, supaya riwayat dibaca ulang. */
  onTercatat: () => void;
}

export function FormKasManual({ shiftId, konfig, sesi, onTercatat }: Props) {
  const { db, pemberitahu } = useDbLokal();
  const [arah, setArah] = useState<ArahKas>('keluar');
  const [teks, setTeks] = useState('');
  const [kode, setKode] = useState('');
  const [catatan, setCatatan] = useState('');
  const [galat, setGalat] = useState<string | null>(null);
  const [pesan, setPesan] = useState<string | null>(null);
  const [menyimpan, setMenyimpan] = useState(false);
  /* Penjaga masuk-ulang: dua ketukan cepat dapat mencapai `jalankan` sebelum
     React sempat menonaktifkan tombolnya, dan itu dua movement untuk satu niat. */
  const sibuk = useRef(false);

  /* ⛔ `bacaRupiah`, bukan `Number()`/`replace(/\D/g, '')`. Yang pertama
     mengubah kolom kosong menjadi 0; yang kedua mengubah "25.5" menjadi 255 —
     salah 10×, tanpa error. `null` berarti kosong ATAU bentuk yang tidak sah,
     dan keduanya bukan angka. */
  const terbaca = bacaRupiah(teks);
  const jumlah = terbaca === null ? 0n : BigInt(terbaca);
  const periksa = periksaKas({ arah, jumlah, alasan: kode, catatan: catatan.trim() || null });

  /* ⛔ Alasan Simpan nonaktif DITULIS di layar, dan `aria-describedby` menunjuk
     ke sana. Tombol mati tanpa penjelasan membuat kasir menyimpulkan
     aplikasinya rusak. Kolom kosong dan nol adalah dua kalimat yang berbeda:
     yang pertama belum diisi, yang kedua diisi dengan angka yang ditolak. */
  const alasanNonaktif: string | null = menyimpan
    ? 'Sedang mencatat…'
    : terbaca === null
      ? teks.trim() === ''
        ? 'Isi jumlah lebih dulu.'
        : 'Jumlah harus rupiah utuh, tanpa desimal (mis. 25.000).'
      : jumlah === 0n
        ? 'Jumlah harus lebih dari nol. Arah uang ditentukan pilihan Kas masuk/Kas keluar.'
        : kode === ''
          ? 'Pilih alasan lebih dulu.'
          : periksa.ok
            ? null
            : periksa.pesan;

  /* ⛔ Mengganti arah MENGOSONGKAN alasannya. Daftar keduanya tidak
     berpotongan kecuali dua entri, dan alasan yang tertinggal dari daftar
     sebelumnya akan ditolak domain dengan pesan yang tidak menyebut bahwa
     arahnyalah yang berubah. */
  const gantiArah = (a: ArahKas) => {
    setArah(a);
    setKode('');
    setGalat(null);
    setPesan(null);
  };

  const jalankan = () => {
    if (sibuk.current || !periksa.ok) return;
    sibuk.current = true;
    setMenyimpan(true);
    setGalat(null);
    setPesan(null);
    const arahDicatat = arah;
    void muatHlc(db, () => Date.now())
      .then((hlc) =>
        catatKasManual({
          db,
          konfig,
          sesi,
          shiftId,
          arah: arahDicatat,
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
          // ⛔ Nilai MUTLAK, dan arahnya dibawa KATANYA: tanda sudah ada di
          // kalimat ("masuk"/"keluar"), dan `− Rp 50.000` di kalimat "Kas
          // keluar" membacakan arah yang sama dua kali.
          const nilai = rupiah(hasil.delta < 0n ? -hasil.delta : hasil.delta);
          setPesan(`${arahDicatat === 'masuk' ? 'Kas masuk' : 'Kas keluar'} ${nilai} tercatat.`);
          // Isian dikosongkan HANYA saat tercatat: pada kegagalan kasir tidak
          // mengetik ulang, dan pada sukses angka lama yang tertinggal mengundang
          // tekanan kedua yang mencatat uang yang sama dua kali.
          setTeks('');
          setKode('');
          setCatatan('');
          onTercatat();
          return;
        }
        setGalat(pesanGagal(hasil));
      })
      .catch((e: Error) => setGalat(`Kas TIDAK tercatat: ${e.message}`))
      .finally(() => {
        sibuk.current = false;
        setMenyimpan(false);
      });
  };

  return (
    <>
      <div className="kasir-laci-judul">
        <h1 className="t-title">Operasional laci</h1>
        <p className="t-caption">Catat pergerakan kas di luar penjualan.</p>
      </div>

      {/* Arah sebagai TOGGLE (`.segmented` bundle), tampil 44 px persis
          mockup (186×44). Area TEKAN 56 px lewat `.sentuh-uang` — memindahkan
          uang adalah aksi uang (DS #3), dan mekanismenya tidak menyentuh ukuran
          tampil. Yang ditekan diberi permukaan terangkat, bukan aksen: aksen
          milik satu aksi utama layar ini, "Simpan catatan". */}
      <div className="segmented" role="group" aria-label="Arah">
        <button
          type="button"
          className="sentuh-uang"
          aria-pressed={arah === 'masuk'}
          disabled={menyimpan}
          onClick={() => gantiArah('masuk')}
        >
          Kas masuk
        </button>
        <button
          type="button"
          className="sentuh-uang"
          aria-pressed={arah === 'keluar'}
          disabled={menyimpan}
          onClick={() => gantiArah('keluar')}
        >
          Kas keluar
        </button>
      </div>

      <Bidang
        label="Jumlah"
        ukuran="lg"
        awalan="Rp"
        inputMode="numeric"
        value={teks}
        onChange={(v) => {
          setTeks(v);
          setPesan(null);
        }}
        placeholder="mis. 50.000"
      />

      {/* Dua kolom: daftar alasan keluar membuat kartu satu kolom menggulir. */}
      <fieldset className="kasir-alasan kasir-alasan-grid">
        <legend className="t-body-md">Alasan</legend>
        {alasanUntuk(arah).map((a) => (
          <label key={a} className="kasir-alasan-opsi t-body-md">
            <input
              type="radio"
              name="alasan-kas"
              checked={kode === a}
              disabled={menyimpan}
              onChange={() => {
                setKode(a);
                setPesan(null);
              }}
            />
            {LABEL_ALASAN[a] ?? a}
          </label>
        ))}
      </fieldset>

      {kode === 'lainnya' && (
        <textarea
          className="kasir-catatan"
          aria-label="Catatan alasan"
          value={catatan}
          onChange={(e) => setCatatan(e.target.value)}
          placeholder="Jelaskan alasannya"
          rows={1}
        />
      )}

      {galat && (
        <p className="t-body-md kasir-login-galat" role="alert">
          {galat}
        </p>
      )}
      {pesan && (
        <p className="t-body-md" role="status">
          {pesan}
        </p>
      )}

      {/* SATU baris keterangan di bawah tombol: saat Simpan nonaktif ia
          menyatakan KENAPA (`aria-describedby`), saat siap ia menyatakan
          jejaknya. Dua paragraf terpisah membuat kartu ini menggulir pada
          1024×768 (terukur) — tinggi kartu bukan selera, ia batas layar. */}
      <p className="t-caption" id="kas-simpan-alasan">
        {alasanNonaktif ?? 'Tercatat atas nama Anda di jejak audit. Tanpa PIN manajer.'}
      </p>
      <Tombol
        varian="primary"
        kritis
        disabled={alasanNonaktif !== null}
        keterangan={alasanNonaktif !== null ? 'kas-simpan-alasan' : undefined}
        onClick={jalankan}
      >
        {menyimpan ? 'Mencatat…' : 'Simpan catatan'}
      </Tombol>
    </>
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
