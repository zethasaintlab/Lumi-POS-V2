import { useState } from 'react';
import {
  ALASAN_DISKON,
  formatPersenDiskon,
  parseNilaiDiskon,
  periksaAlasanDiskon,
  rencanaDiskon,
  type AmbangDiskon,
  type TipeDiskon,
} from '../../../../packages/domain/src/diskon.ts';
import { KODE_LAINNYA, MIN_PANJANG_CATATAN } from '../../../../packages/domain/src/alasan.ts';
import { LABEL_ALASAN_DISKON } from '../kasir/diskon.ts';
import type { DiskonKeranjang } from '../kasir/keranjang.ts';
import { DialogOtorisasi } from './DialogOtorisasi.tsx';
import { Bidang } from '../Bidang.tsx';
import { Tombol } from '../Tombol.tsx';
import { rupiah } from '../../../../packages/domain/src/uang-tampilan.ts';

/* K-03 — diskon tingkat order (FR-B8, `spec-b:267`).

   Dialog, bukan layar: keranjangnya harus tetap terlihat di belakang, dan
   diskon diberikan DI TENGAH transaksi dengan antrean menunggu.

   ⛔ Layar MENYEBUTKAN akibatnya sebelum kasir menekan apa pun. Nominal
   potongan dan "butuh PIN manajer" dihitung ulang pada setiap ketukan, jadi
   kasir tahu bahwa 25% akan memanggil manajer SEBELUM ia menjanjikannya ke
   pelanggan. Dialog yang baru menolak setelah tombol ditekan membuat kasir
   menawar di depan orang yang sudah mendengar angkanya.

   ⛔ Alasan dikumpulkan DI SINI, dan `DialogOtorisasi` dipanggil TANPA
   `daftarAlasan`. Meminta manajer mengulang pilihan kasir membuang waktu di
   antrean dan membuang pilihan pertamanya begitu saja — pelajaran yang sama
   dengan K-10. */

interface Props {
  /** Subtotal keranjang SEKARANG, rupiah utuh. */
  subtotal: bigint;
  ambang: AmbangDiskon;
  /** Kasir yang sedang masuk — dipakai menolak persetujuan-diri-sendiri. */
  aktorId: string;
  /** Diskon yang sudah menempel, bila dialog dibuka untuk mengubahnya. */
  awal: DiskonKeranjang | null;
  onBatal: () => void;
  /** `null` = diskon dilepas. */
  onSimpan: (diskon: DiskonKeranjang | null) => void;
}

function teksAwal(awal: DiskonKeranjang | null): string {
  if (awal === null) return '';
  return awal.minta.tipe === 'persen'
    ? formatPersenDiskon(awal.minta.nilai)
    : awal.minta.nilai.toString();
}

export function DialogDiskon({ subtotal, ambang, aktorId, awal, onBatal, onSimpan }: Props) {
  const [tipe, setTipe] = useState<TipeDiskon>(awal?.minta.tipe ?? 'persen');
  const [teks, setTeks] = useState(() => teksAwal(awal));
  const [kode, setKode] = useState(awal?.alasanKode ?? '');
  const [catatan, setCatatan] = useState(awal?.alasanCatatan ?? '');
  const [mintaOtorisasi, setMintaOtorisasi] = useState(false);

  const nilai = parseNilaiDiskon(tipe, teks);
  const rencana = nilai === null ? null : rencanaDiskon(subtotal, { tipe, nilai }, ambang);

  /* Alasan divalidasi sebelum PIN diminta — alasan yang sama dengan
     `DialogOtorisasi`: manajer yang PIN-nya sudah diketik lalu ditolak karena
     catatan pendek harus mengetiknya lagi, di depan orang lain. */
  const galatAlasan = kode === '' ? null : periksaAlasanDiskon(kode, catatan || null);
  const siap = rencana !== null && rencana.nominal > 0n && kode !== '' && galatAlasan === null;

  const simpan = (approverId: string | null) => {
    if (nilai === null || rencana === null) return;
    onSimpan({
      // ⛔ Yang disimpan PERMINTAAN-nya (`persen 15%`), bukan nominalnya.
      // Subtotal berubah setiap kali kasir menambah baris; nominal yang
      // dibekukan membuat merchant memberi separuh dari yang ia kira.
      minta: { tipe, nilai },
      alasanKode: kode,
      alasanCatatan: catatan.trim() || null,
      approverId,
      // Angka yang DILIHAT penyetuju. `null` tanpa persetujuan.
      nominalDisetujui: approverId === null ? null : rencana.nominal,
    });
  };

  if (mintaOtorisasi && rencana !== null) {
    return (
      <DialogOtorisasi
        aktorId={aktorId}
        // TANPA `daftarAlasan`: kasir sudah memilihnya di langkah sebelumnya.
        judul={`Otorisasi diskon ${rupiah(rencana.nominal)}`}
        onBatal={() => setMintaOtorisasi(false)}
        onSetuju={({ approverId }) => simpan(approverId)}
      />
    );
  }

  return (
    <div className="kasir-dialog-latar" role="dialog" aria-modal="true" aria-label="Diskon">
      <div className="kasir-dialog">
        <h2 className="t-title">Diskon</h2>
        <p className="t-caption kasir-login-sub">
          Subtotal <span className="num">{rupiah(subtotal)}</span>. Di atas{' '}
          <span className="num">{formatPersenDiskon(ambang.persenSkala)}%</span> atau{' '}
          <span className="num">{rupiah(ambang.nominal)}</span>, persetujuan manajer diperlukan.
        </p>

        <fieldset className="kasir-alasan">
          <legend className="t-body-md">Bentuk</legend>
          <label className="kasir-alasan-opsi t-body-md">
            <input
              type="radio"
              name="tipe-diskon"
              checked={tipe === 'persen'}
              onChange={() => {
                setTipe('persen');
                // ⛔ Angkanya DIKOSONGKAN saat bentuk berubah. "50" yang
                // berarti Rp 50 menjadi 50% begitu radio ditekan — potongan
                // ribuan kali lipat, dari satu ketukan yang tidak terlihat
                // mengubah apa pun.
                setTeks('');
              }}
            />
            Persen
          </label>
          <label className="kasir-alasan-opsi t-body-md">
            <input
              type="radio"
              name="tipe-diskon"
              checked={tipe === 'nominal'}
              onChange={() => {
                setTipe('nominal');
                setTeks('');
              }}
            />
            Nominal rupiah
          </label>
        </fieldset>

        <Bidang
          label={tipe === 'persen' ? 'Diskon (%)' : 'Diskon (Rp)'}
          inputMode={tipe === 'persen' ? 'decimal' : 'numeric'}
          value={teks}
          onChange={setTeks}
          placeholder={tipe === 'persen' ? 'mis. 10 atau 12,5' : 'mis. 5000'}
        />

        {/* Keadaan error dan keadaan kosong, keduanya (aturan design system
            #7). Ruangnya tidak dicadangkan seperti di `DialogOtorisasi` —
            tidak ada keypad di bawahnya yang akan bergeser. */}
        {teks.trim() !== '' && nilai === null && (
          <p className="t-body-md kasir-login-galat" role="alert">
            {tipe === 'persen'
              ? 'Masukkan persen 0–100, maksimal dua angka desimal.'
              : 'Masukkan rupiah utuh, tanpa titik dan tanpa desimal.'}
          </p>
        )}

        {rencana !== null && (
          <p className="t-body-md" role="status">
            Potongan <span className="num">{rupiah(rencana.nominal)}</span>
            {rencana.butuhPenyetuju ? ' · butuh PIN manajer' : ''}
          </p>
        )}

        <fieldset className="kasir-alasan">
          <legend className="t-body-md">Alasan</legend>
          {/* Daftar TERTUTUP (`spec-b:293`). Free text tidak dapat diagregasi
              jadi laporan exception FR-G5, dan itu seluruh gunanya. */}
          {ALASAN_DISKON.map((a) => (
            <label key={a} className="kasir-alasan-opsi t-body-md">
              <input
                type="radio"
                name="alasan-diskon"
                checked={kode === a}
                onChange={() => setKode(a)}
              />
              {LABEL_ALASAN_DISKON[a]}
            </label>
          ))}
        </fieldset>

        {kode === KODE_LAINNYA && (
          <textarea
            className="kasir-catatan"
            value={catatan}
            onChange={(e) => setCatatan(e.target.value)}
            placeholder={`Jelaskan alasannya (minimal ${MIN_PANJANG_CATATAN} karakter)`}
            rows={2}
          />
        )}

        {galatAlasan && (
          <p className="t-body-md kasir-login-galat" role="alert">
            {galatAlasan}
          </p>
        )}

        <div className="kasir-dialog-aksi">
          <Tombol varian="ghost" kritis onClick={onBatal}>
            Batal
          </Tombol>
          {awal !== null && (
            <Tombol varian="ghost" kritis onClick={() => onSimpan(null)}>
              Hapus diskon
            </Tombol>
          )}
          <Tombol
            varian="primary"
            kritis
            disabled={!siap}
            onClick={() => {
              if (rencana === null) return;
              if (rencana.butuhPenyetuju) setMintaOtorisasi(true);
              else simpan(null);
            }}
          >
            Terapkan
          </Tombol>
        </div>
      </div>
    </div>
  );
}
