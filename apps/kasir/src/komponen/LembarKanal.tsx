import { Icon } from 'ds';
import { Tombol } from '../Tombol.tsx';
import { LatarDialog } from './LatarDialog.tsx';
import { LABEL_KANAL, type RingkasKanal } from '../kasir/kanal.ts';
import type { Kanal } from '../kasir/keranjang.ts';

/* K-03 toolbar — Pajak = pilihan KANAL (spec § 4 "Pajak sebagai pilihan kanal", P9(a)).
 *
 * ⛔ Yang dipilih kanal, bukan tarif: tarif diresolusi TaxCalculator (FR-C6/C7).
 * Setiap pilihan menyebut nama tarif yang akan berlaku, dari hasil hitung —
 * tidak ada persentase yang diketik di sini.
 *
 * ⛔ Tidak ada kata biaya layanan: Dine in tidak menyiratkan biaya tambahan
 * (G-TANPA-LAYANAN). Memilih menutup lembar; Escape/Batal tidak mengubah apa pun. */

interface Props {
  aktif: Kanal;
  /** `null` = belum ada item (nama tarif belum bisa dihitung) atau sedang dihitung. */
  ringkas: RingkasKanal[] | null;
  galat: string | null;
  onPilih: (kanal: Kanal) => void;
  onBatal: () => void;
}

function teksTarif(r: RingkasKanal | undefined): string {
  if (!r) return '';
  return r.namaTarif.length === 0 ? 'Tanpa pajak' : r.namaTarif.join(' + ');
}

export function LembarKanal({ aktif, ringkas, galat, onPilih, onBatal }: Props) {
  const urutan: Kanal[] = ['takeaway', 'dine_in'];
  const sama = ringkas?.[0]?.sama === true;
  return (
    <LatarDialog label="Pajak pesanan" onBatal={onBatal}>
      <h2 className="t-title">Pajak pesanan</h2>
      <p className="t-caption kasir-login-sub">
        Pilih kanal pesanan. Tarif mengikuti kanal sesuai pengaturan outlet.
      </p>

      <div className="kasir-kanal-daftar" role="group" aria-label="Kanal pesanan">
        {urutan.map((k) => {
          const r = ringkas?.find((x) => x.kanal === k);
          const dipilih = aktif === k;
          return (
            <button
              key={k}
              type="button"
              className="btn btn-secondary btn-critical kasir-kanal-pilihan"
              aria-pressed={dipilih}
              onClick={() => onPilih(k)}
            >
              <span className="kasir-kanal-isi">
                {dipilih && <Icon name="check" size={17} />}
                <span className="t-body-md">
                  {LABEL_KANAL[k]}
                  {r ? ` · ${teksTarif(r)}` : ''}
                </span>
              </span>
              {dipilih && <span className="t-caption">Dipilih</span>}
            </button>
          );
        })}
      </div>

      {galat && (
        <p className="t-caption kasir-login-galat" role="alert">
          {galat}
        </p>
      )}
      {!galat && ringkas === null && (
        <p className="t-caption kasir-login-sub">Nama tarif tampil setelah ada item di keranjang.</p>
      )}
      {sama && <p className="t-caption kasir-login-sub">Tarif sama untuk kedua kanal.</p>}

      <div className="kasir-dialog-aksi">
        <Tombol varian="ghost" kritis onClick={onBatal}>
          Tutup
        </Tombol>
      </div>
    </LatarDialog>
  );
}
