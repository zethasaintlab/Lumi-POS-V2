import { Tombol } from '../Tombol.tsx';
import { LatarDialog } from './LatarDialog.tsx';
import { labelKanal, type Kanal, type RingkasanKanal } from '../kasir/kanal.ts';

/* K-03 -- lembar Pajak: kasir memilih KANAL (Dine in / Takeaway), bukan tarif
 * (FR-C7; spec kasir § 4 "Pajak sebagai pilihan kanal"). Tarif tetap diresolusi
 * `TaxCalculator`; setiap pilihan hanya MENYEBUT nama tarif yang akan berlaku,
 * diambil dari hasil `hitungKeranjang` (lihat `ringkasKanal`).
 *
 * ⛔ Tidak ada persentase yang diketik dan TIDAK ada kata tentang biaya layanan
 * (tambahan user untuk P9): Dine in tidak menyiratkan biaya apa pun di luar
 * pajak, dan `service_charge_amount` tetap terkunci nol di klien dan server.
 *
 * ⛔ Tiga keadaan: memuat (`ringkasan === null`), galat (`galat`), dan terisi.
 * Escape menutup tanpa mengubah kanal (`LatarDialog`). */

interface Props {
  aktif: Kanal;
  /** `null` = tarif sedang dibaca. */
  ringkasan: RingkasanKanal[] | null;
  /** Pesan bila tarif tidak terbaca; pilihan kanal tetap tersedia. */
  galat: string | null;
  onPilih: (kanal: Kanal) => void;
  onTutup: () => void;
}

function sebutTarif(namaTarif: readonly string[]): string {
  return namaTarif.length === 0 ? 'tanpa pajak' : namaTarif.join(' + ');
}

export function LembarKanal({ aktif, ringkasan, galat, onPilih, onTutup }: Props) {
  const sama = ringkasan !== null && ringkasan.length > 0 && ringkasan[0].sama;

  return (
    <LatarDialog label="Pajak pesanan" onBatal={onTutup}>
      <h2 className="t-title">Pajak pesanan</h2>
      <p className="t-caption kasir-login-sub">Pilih kanal pesanan. Tarif pajak mengikuti kanal.</p>

      {ringkasan === null && galat === null && (
        <p className="t-body-md" role="status">
          Membaca tarif pajak…
        </p>
      )}

      {galat !== null && (
        <p className="t-body-md kasir-login-galat" role="alert">
          {galat}
        </p>
      )}

      <div className="kasir-pilih-kanal" role="group" aria-label="Kanal pesanan">
        {(['takeaway', 'dine_in'] as const).map((kanal) => {
          const baris = ringkasan?.find((r) => r.kanal === kanal);
          return (
            <button
              key={kanal}
              type="button"
              className="btn btn-secondary btn-critical kasir-pilih-kanal-opsi"
              aria-pressed={aktif === kanal}
              onClick={() => onPilih(kanal)}
            >
              {labelKanal(kanal)}
              {baris ? ` · ${sebutTarif(baris.namaTarif)}` : ''}
              {aktif === kanal ? ' (dipakai)' : ''}
            </button>
          );
        })}
      </div>

      {sama && <p className="t-caption kasir-login-sub">Tarif sama untuk kedua kanal.</p>}

      <div className="kasir-dialog-aksi">
        <Tombol varian="ghost" kritis onClick={onTutup}>
          Tutup
        </Tombol>
      </div>
    </LatarDialog>
  );
}
