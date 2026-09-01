import { useEffect, useState } from 'react';
import { bukaLaci, rencanaNoSaleLokal, type HasilNoSale } from '../kasir/no-sale.ts';
import { DialogOtorisasi } from './DialogOtorisasi.tsx';
import { Tombol } from '../Tombol.tsx';
import { useDbLokal } from '../konteks/DbLokalProvider.tsx';
import { muatHlc } from '../lokal/hlc.ts';
import { ALASAN_NO_SALE } from '../../../../packages/domain/src/no-sale.ts';
import type { KonfigPerangkat } from '../../../../packages/sync-client/src/perangkat.ts';
import type { Sesi } from '../identitas/login.ts';
import { LatarDialog } from './LatarDialog.tsx';

/* K-16 — Buka Laci (no-sale). `IA:66`: **dialog, bukan layar**.

   `spec-d:229`: membuka laci tanpa transaksi adalah pola fraud kasir paling
   dasar. Yang dibangun di sini karena itu bukan tombolnya — tombolnya sepele
   — melainkan kontrolnya: alasan wajib dari daftar tertutup, dan PIN manajer
   mulai pembukaan ke-4 dalam shift.

   ⛔ Layar MENYEBUTKAN urutannya. Kasir yang tiba-tiba dimintai PIN tanpa
   penjelasan akan menyimpulkan aplikasinya rusak; kasir yang membaca
   "pembukaan ke-4 dalam shift ini" tahu persis kenapa.

   ⛔ Layar juga menyatakan batas yang `spec-d:231` tuntut dinyatakan:
   sinyalnya SATU ARAH. Sistem tidak tahu apakah laci benar-benar terbuka, dan
   tidak dapat mendeteksi laci yang dibuka manual dengan kunci. Merchant yang
   mengira laporan ini menghitung SETIAP pembukaan akan menyimpulkan selisih
   kas dari angka yang buta pada separuhnya. */

const LABEL: Record<string, string> = {
  tukar_uang: 'Tukar uang pecahan',
  ambil_kembalian_tertinggal: 'Kembalian tertinggal pelanggan',
  setor_ke_brankas: 'Setor ke brankas',
  periksa_laci: 'Periksa isi laci',
  lainnya: 'Lainnya',
};

interface Props {
  shiftId: string;
  konfig: KonfigPerangkat;
  sesi: Sesi;
  onBatal: () => void;
  onSelesai: (hasil: Extract<HasilNoSale, { status: 'tersimpan' }>) => void;
}

export function DialogNoSale({ shiftId, konfig, sesi, onBatal, onSelesai }: Props) {
  const { db, pemberitahu } = useDbLokal();
  const [kode, setKode] = useState('');
  const [catatan, setCatatan] = useState('');
  const [urutan, setUrutan] = useState<number | null>(null);
  const [butuhPenyetuju, setButuhPenyetuju] = useState(false);
  const [ambang, setAmbang] = useState<number | null>(null);
  const [mintaOtorisasi, setMintaOtorisasi] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const [menyimpan, setMenyimpan] = useState(false);

  /* Rencana dibaca SEBELUM kasir memilih apa pun, supaya layar dapat berkata
     "pembukaan ke-4, butuh persetujuan manajer" sejak dialog terbuka —
     bukan setelah kasir menekan tombol dan ditolak. */
  useEffect(() => {
    let hidup = true;
    void rencanaNoSaleLokal(db, shiftId).then((r) => {
      if (!hidup) return;
      setUrutan(r.urutan);
      setButuhPenyetuju(r.butuhPenyetuju);
      setAmbang(r.ambang);
    });
    return () => {
      hidup = false;
    };
  }, [db, shiftId]);

  const catatanWajib = kode === 'lainnya';
  const siap =
    kode !== '' && (!catatanWajib || catatan.trim().length >= 10) && urutan !== null && !menyimpan;

  const jalankan = (approverId: string | null) => {
    setMenyimpan(true);
    setGalat(null);
    void muatHlc(db, () => Date.now())
      .then((hlc) =>
        bukaLaci({
          db,
          konfig,
          sesi,
          shiftId,
          alasan: { kode, catatan: catatan.trim() || null },
          approverId,
          // ⛔ Perintah fisik belum ada: `peripheralAktif()` mengembalikan
          // `null` di v1, dan laci di-kick lewat printer. Catatannya tetap
          // ditulis — itu seluruh kontrolnya — dan `laciTerbuka: false`
          // dinyatakan di layar alih-alih didiamkan.
          waktu: () => new Date(),
          idBaru: () => crypto.randomUUID(),
          hlc: () => hlc.tick(),
        })
      )
      .then((hasil) => {
        if (hasil.status === 'tersimpan') {
          pemberitahu.beritahu();
          onSelesai(hasil);
          return;
        }
        setGalat(pesanGagal(hasil));
      })
      .catch((e: Error) => setGalat(`Pembukaan TIDAK tercatat: ${e.message}`))
      .finally(() => {
        setMenyimpan(false);
        setMintaOtorisasi(false);
      });
  };

  if (mintaOtorisasi) {
    return (
      <DialogOtorisasi
        aktorId={sesi.userId}
        // TANPA `daftarAlasan`: kasir sudah memilihnya di langkah sebelumnya.
        judul={`Otorisasi buka laci ke-${urutan ?? '?'}`}
        onBatal={() => setMintaOtorisasi(false)}
        onSetuju={({ approverId }) => jalankan(approverId)}
      />
    );
  }

  return (
    <LatarDialog label="Buka laci" onBatal={onBatal}>
        <h2 className="t-title">Buka laci</h2>
        <p className="t-caption kasir-login-sub">
          {urutan === null
            ? 'Membaca riwayat shift…'
            : butuhPenyetuju
              ? // ⛔ Ambang yang BERLAKU untuk outlet ini (B-26), bukan
                // konstanta bawaan. Kalimat yang menyebut "3×" pada outlet
                // berambang 6 memberi tahu kasir aturan yang tidak berlaku
                // baginya — dan kasir yang aturannya salah disebutkan berhenti
                // mempercayai kalimat berikutnya.
                `Pembukaan ke-${urutan} dalam shift ini. Di atas ${ambang}×, persetujuan manajer diperlukan.`
              : `Pembukaan ke-${urutan} dalam shift ini. Tanpa transaksi — tercatat di audit.`}
        </p>

        <fieldset className="kasir-alasan">
          <legend className="t-body-md">Alasan</legend>
          {ALASAN_NO_SALE.map((a) => (
            <label key={a} className="kasir-alasan-opsi t-body-md">
              <input
                type="radio"
                name="alasan-no-sale"
                checked={kode === a}
                disabled={menyimpan}
                onChange={() => setKode(a)}
              />
              {LABEL[a] ?? a}
            </label>
          ))}
        </fieldset>

        {catatanWajib && (
          <textarea
            className="kasir-catatan"
            value={catatan}
            onChange={(e) => setCatatan(e.target.value)}
            placeholder="Jelaskan alasannya (minimal 10 karakter)"
            rows={2}
          />
        )}

        {galat && (
          <p className="t-body-md kasir-login-galat" role="alert">
            {galat}
          </p>
        )}

        {/* ⛔ Batas yang `spec-d:231` tuntut DINYATAKAN, bukan disembunyikan. */}
        <p className="t-caption">
          Sistem tidak dapat mengetahui apakah laci benar-benar terbuka, dan tidak dapat mendeteksi
          laci yang dibuka manual dengan kunci. Yang tercatat adalah pembukaan yang{' '}
          <strong>diperintahkan sistem</strong>.
        </p>

        <div className="kasir-dialog-aksi">
          <Tombol varian="ghost" kritis disabled={menyimpan} onClick={onBatal}>
            Batal
          </Tombol>
          <Tombol
            varian="primary"
            kritis
            disabled={!siap}
            onClick={() => {
              if (butuhPenyetuju) setMintaOtorisasi(true);
              else jalankan(null);
            }}
          >
            {menyimpan ? 'Mencatat…' : 'Buka laci'}
          </Tombol>
        </div>
    </LatarDialog>
  );
}

function pesanGagal(hasil: HasilNoSale): string {
  switch (hasil.status) {
    case 'shift_tidak_terbuka':
      return 'Shift sudah ditutup. Laci tidak dapat dibuka lewat no-sale.';
    case 'alasan_tidak_berlaku':
      return hasil.pesan;
    case 'butuh_penyetuju':
      return `Pembukaan ke-${hasil.urutan} menuntut persetujuan manajer.`;
    case 'penyetuju_sama_dengan_aktor':
      return 'Anda tidak dapat menyetujui pembukaan Anda sendiri.';
    default:
      return 'Pembukaan laci gagal dicatat.';
  }
}
