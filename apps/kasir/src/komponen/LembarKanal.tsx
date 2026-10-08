import { Tombol } from '../Tombol.tsx';
import { LatarDialog } from './LatarDialog.tsx';
import { LABEL_KANAL, URUTAN_KANAL, type Kanal, type RingkasanKanal } from '../kasir/kanal.ts';

/* K-03 toolbar — Pajak (spec § 4 baris 3, P9(a)): pilihan KANAL, bukan pilihan tarif.
 *
 * ⛔ Kasir yang memilih tarif langsung melompati resolusi `TaxCalculator`
 * (FR-C6); satu-satunya masukan per pesanan yang spec izinkan adalah kanal
 * (FR-C7). Nama tarif di sini datang dari hasil `hitungKeranjang` per kanal
 * (`ringkasKanal`), tidak pernah diketik, dan tidak ada persentase.
 *
 * ⛔ Dine in TIDAK menyiratkan biaya layanan: lembar ini tidak menyebut layanan
 * dalam keadaan apa pun (G-TANPA-LAYANAN).
 *
 * `ringkasan` null + `adaItem` = nama tarif belum terbaca (menghitung atau
 * gagal): kanal tetap dapat dipilih, karena pilihan itu tidak bergantung pada nama.
 */

interface Props {
  kanal: Kanal;
  ringkasan: RingkasanKanal[] | null;
  adaItem: boolean;
  galat: boolean;
  onPilih: (k: Kanal) => void;
  onBatal: () => void;
}

export function LembarKanal({ kanal, ringkasan, adaItem, galat, onPilih, onBatal }: Props) {
  const sama = ringkasan !== null && ringkasan.length > 0 && ringkasan[0].sama;
  const namaUntuk = (k: Kanal): string | null => {
    const r = ringkasan?.find((x) => x.kanal === k);
    if (!r) return null;
    return r.namaTarif.length > 0 ? r.namaTarif.join(' + ') : 'tanpa tarif pajak';
  };

  return (
    <LatarDialog label="Pajak pesanan" onBatal={onBatal}>
      <div className="kasir-dialog-form">
        <h2 className="t-title">Pajak pesanan</h2>
        <p className="t-caption kasir-login-sub">
          Pilih kanal pesanan. Tarif pajak mengikuti kanal yang dipilih.
        </p>

        <div className="kasir-kanal-daftar">
          {URUTAN_KANAL.map((k) => {
            const nama = namaUntuk(k);
            return (
              <Tombol
                key={k}
                varian={kanal === k ? 'primary' : 'secondary'}
                kritis
                tekan={kanal === k}
                onClick={() => onPilih(k)}
              >
                <span>{nama === null ? LABEL_KANAL[k] : `${LABEL_KANAL[k]} · ${nama}`}</span>
                {kanal === k && <span className="t-caption"> (terpilih)</span>}
              </Tombol>
            );
          })}
        </div>

        {sama && <p className="t-caption">Tarif sama untuk kedua kanal.</p>}
        {!adaItem && (
          <p className="t-caption">Nama tarif tampil setelah ada item di keranjang.</p>
        )}
        {adaItem && ringkasan === null && galat && (
          <p className="t-caption kasir-login-galat" role="alert">
            Nama tarif belum dapat dibaca. Pilihan kanal tetap tersimpan.
          </p>
        )}

        <div className="kasir-dialog-aksi">
          <Tombol varian="ghost" kritis onClick={onBatal}>
            Tutup
          </Tombol>
        </div>
      </div>
    </LatarDialog>
  );
}
