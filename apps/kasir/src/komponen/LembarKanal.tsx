import { Icon } from 'ds';
import { Tombol } from '../Tombol.tsx';
import { LatarDialog } from './LatarDialog.tsx';
import { LABEL_KANAL, type RingkasanKanal } from '../kasir/kanal.ts';
import type { Kanal } from '../kasir/keranjang.ts';

/* K-03 toolbar — Pajak = pilihan KANAL (spec § 4 "Pajak sebagai pilihan kanal", P9(a)).
 *
 * ⛔ Kasir memilih kanal, tidak pernah tarif: memilih tarif langsung melompati
 * resolusi FR-C6/C7. Nama tarif di tiap pilihan datang dari `ringkasKanal`
 * (hasil `hitungKeranjang` per kanal) — tidak ada persentase yang diketik di sini.
 *
 * ⛔ Tidak menyebut biaya layanan dalam keadaan apa pun (G-TANPA-LAYANAN).
 * Memilih menutup lembar: satu ketukan, tanpa tombol "Simpan".
 */

interface Props {
  aktif: Kanal;
  /** `null` = tarif tidak terbaca; pilihan tetap sah, K-06 menghitung ulang. */
  ringkasan: RingkasanKanal[] | null;
  onPilih: (kanal: Kanal) => void;
  onBatal: () => void;
}

const namaTarif = (r: RingkasanKanal) => (r.namaTarif.length > 0 ? r.namaTarif.join(' + ') : 'Tanpa pajak');

export function LembarKanal({ aktif, ringkasan, onPilih, onBatal }: Props) {
  const daftar: RingkasanKanal[] =
    ringkasan ??
    (['takeaway', 'dine_in'] as const).map((kanal) => ({ kanal, namaTarif: [], sama: false }));

  return (
    <LatarDialog label="Pajak pesanan" onBatal={onBatal}>
      <h2 className="t-title">Pajak pesanan</h2>
      <p className="t-caption kasir-login-sub">Pilih kanal pesanan; tarif pajak mengikuti kanalnya.</p>

      <div className="kasir-kanal-daftar" role="radiogroup" aria-label="Kanal pesanan">
        {daftar.map((r) => (
          <button
            key={r.kanal}
            type="button"
            role="radio"
            aria-checked={r.kanal === aktif}
            className="btn btn-secondary btn-critical kasir-kanal-opsi"
            onClick={() => onPilih(r.kanal)}
          >
            <span>{ringkasan === null ? LABEL_KANAL[r.kanal] : `${LABEL_KANAL[r.kanal]} · ${namaTarif(r)}`}</span>
            {r.kanal === aktif && <Icon name="check" size={20} />}
          </button>
        ))}
      </div>

      {ringkasan === null && (
        <p className="t-caption kasir-login-galat" role="alert">
          Tarif belum dapat dibaca dari perangkat. Kanal tetap dapat dipilih; tarif dihitung saat Bayar.
        </p>
      )}
      {ringkasan !== null && ringkasan[0]?.sama && (
        <p className="t-caption kasir-login-sub">Tarif sama untuk kedua kanal.</p>
      )}

      <div className="kasir-dialog-aksi">
        <Tombol varian="ghost" kritis onClick={onBatal}>
          Tutup
        </Tombol>
      </div>
    </LatarDialog>
  );
}
