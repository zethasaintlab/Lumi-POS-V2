import { useState } from 'react';
import { PIN_LENGTH } from '../../../../packages/domain/src/pin.ts';
import { buatPinHasherWasm } from '../identitas/pin-hasher-wasm.ts';
import {
  otorisasi,
  validasiAlasan,
  type Alasan,
  type HasilOtorisasi,
} from '../identitas/otorisasi.ts';
import { useDbLokal } from '../konteks/DbLokalProvider.tsx';
import { Keypad } from './Keypad.tsx';
import { Tombol } from '../Tombol.tsx';

/* K-11 — Otorisasi step-up (IA §2.2, FR-B8/B9).

   "Tidak memutus sesi kasir" (`IA:70`). Itu bukan catatan tata letak
   melainkan AC (`spec-f:279`), dan yang menegakkannya ada di
   `identitas/otorisasi.ts` — modul ini tidak pernah menyentuh `sesi_lokal`.
   Komponen di sini hanya mengumpulkan alasan dan PIN.

   Bentuknya dialog, BUKAN layar: kasir dan keranjangnya harus tetap terlihat
   di belakangnya. Manajer datang, mengetik, pergi; kasir melanjutkan dari
   tempat yang sama. */

const hasher = buatPinHasherWasm();

interface Props {
  /** Kasir yang sedang masuk. Dipakai menolak persetujuan-diri-sendiri. */
  aktorId: string;
  daftarAlasan: readonly Alasan[];
  judul: string;
  onBatal: () => void;
  onSetuju: (hasil: { approverId: string; reasonCode: string; reasonNote: string | null }) => void;
}

export function DialogOtorisasi({ aktorId, daftarAlasan, judul, onBatal, onSetuju }: Props) {
  const { db } = useDbLokal();
  const [kode, setKode] = useState('');
  const [catatan, setCatatan] = useState('');
  const [pin, setPin] = useState('');
  const [galat, setGalat] = useState<string | null>(null);
  const [memeriksa, setMemeriksa] = useState(false);

  const galatAlasan = kode === '' ? null : validasiAlasan(daftarAlasan, kode, catatan || null);
  /* Alasan divalidasi SEBELUM PIN diminta.

     `spec-f:385` menuntut "Lainnya" memvalidasi catatan ≥10 karakter. Kalau
     itu diperiksa setelah PIN, manajer sudah mengetik PIN-nya di depan orang
     lain, ditolak karena catatan pendek, dan harus mengetiknya lagi — dan
     `spec-f:139` menyebut shoulder surfing sebagai risiko utama PIN manajer. */
  const alasanSiap = kode !== '' && galatAlasan === null;

  const kirim = (nilaiPin: string) => {
    setMemeriksa(true);
    void otorisasi({
      db,
      hasher,
      waktu: () => new Date(),
      pin: nilaiPin,
      aktorId,
      operasi: 'approve_authorization',
    })
      .then((h: HasilOtorisasi) => {
        if (h.status === 'disetujui') {
          onSetuju({ approverId: h.approverId, reasonCode: kode, reasonNote: catatan || null });
          return;
        }
        setGalat(h.pesan);
        setPin('');
      })
      .finally(() => setMemeriksa(false));
  };

  return (
    <div className="kasir-dialog-latar" role="dialog" aria-modal="true" aria-label={judul}>
      <div className="kasir-dialog">
        <h2 className="t-title">{judul}</h2>

        <fieldset className="kasir-alasan">
          <legend className="t-body-md">Alasan</legend>
          {/* Daftar TERTUTUP. `spec-f:378`: free text tidak dapat diagregasi
              jadi laporan fraud, dan itu seluruh gunanya. */}
          {daftarAlasan.map((a) => (
            <label key={a.kode} className="kasir-alasan-opsi t-body-md">
              <input
                type="radio"
                name="alasan"
                value={a.kode}
                checked={kode === a.kode}
                onChange={() => setKode(a.kode)}
              />
              {a.label}
            </label>
          ))}
        </fieldset>

        {kode === 'lainnya' && (
          <textarea
            className="kasir-catatan"
            value={catatan}
            onChange={(e) => setCatatan(e.target.value)}
            placeholder="Jelaskan alasannya (minimal 10 karakter)"
            rows={2}
          />
        )}

        {galatAlasan && (
          <p className="t-body-md kasir-login-galat" role="alert">
            {galatAlasan}
          </p>
        )}

        {alasanSiap && (
          <>
            <p className="t-body-md">PIN manajer</p>
            <Keypad
              nilai={pin}
              panjang={PIN_LENGTH}
              nonaktif={memeriksa}
              onUbah={(v) => {
                setPin(v);
                setGalat(null);
                if (v.length === PIN_LENGTH) kirim(v);
              }}
            />
          </>
        )}

        {galat && (
          <p className="t-body-md kasir-login-galat" role="alert">
            {galat}
          </p>
        )}

        <div className="kasir-dialog-aksi">
          <Tombol varian="ghost" kritis disabled={memeriksa} onClick={onBatal}>
            Batal
          </Tombol>
        </div>
      </div>
    </div>
  );
}
