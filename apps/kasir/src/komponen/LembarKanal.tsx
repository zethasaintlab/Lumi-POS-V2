import { Tombol } from '../Tombol.tsx';
import { LatarDialog } from './LatarDialog.tsx';
import { NAMA_KANAL, type Kanal, type RingkasanKanal } from '../kasir/kanal.ts';

/* K-03 — lembar tombol Pajak (FR-C7, spec § 4 "Pajak sebagai pilihan kanal").
 *
 * ⛔ Kasir memilih KANAL, bukan tarif: tarif dipilih `TaxCalculator`
 * (FR-C6). Tiap pilihan menyebut tarif yang AKAN berlaku, dan namanya datang
 * dari `TaxRate.name` lewat `ringkasKanal` — tidak ada persentase yang diketik
 * di sini (invariant #7).
 *
 * ⛔ Tidak ada kata biaya layanan di lembar ini, berapa pun
 * `outlet.service_charge_rate`: biaya layanan terkunci nol (G-TANPA-LAYANAN).
 *
 * Tiga keadaan `ringkasan`: `null` = belum ada item (tarif butuh baris untuk
 * diresolusi), `'memuat'`, `'galat'`. Pilihan kanal TETAP dapat dipakai pada
 * ketiganya — kanal bukan data yang bergantung pada pembacaan tarif.
 */

export type KeadaanRingkasan = RingkasanKanal[] | 'kosong' | 'memuat' | 'galat';

interface Props {
  kanalAktif: Kanal;
  ringkasan: KeadaanRingkasan;
  onPilih: (kanal: Kanal) => void;
  onTutup: () => void;
}

function namaTarifTeks(r: RingkasanKanal): string {
  return r.namaTarif.length === 0 ? 'Tanpa pajak' : r.namaTarif.join(' + ');
}

export function LembarKanal({ kanalAktif, ringkasan, onPilih, onTutup }: Props) {
  const daftar: { kanal: Kanal; tarif: string | null }[] = Array.isArray(ringkasan)
    ? ringkasan.map((r) => ({ kanal: r.kanal, tarif: namaTarifTeks(r) }))
    : (['takeaway', 'dine_in'] as const).map((kanal) => ({ kanal, tarif: null }));

  const sama = Array.isArray(ringkasan) && ringkasan.length > 0 && ringkasan[0].sama;

  return (
    <LatarDialog label="Pajak pesanan" onBatal={onTutup}>
      <h2 className="t-title">Pajak pesanan</h2>
      <p className="t-caption kasir-login-sub">
        Pilih kanal pesanan. Tarif pajak mengikuti kanal yang dipilih.
      </p>

      <div className="kasir-pilih-kanal" role="group" aria-label="Kanal pesanan">
        {daftar.map((d) => (
          <button
            key={d.kanal}
            type="button"
            className="btn btn-secondary btn-critical"
            aria-pressed={d.kanal === kanalAktif}
            onClick={() => onPilih(d.kanal)}
          >
            <span>{d.tarif === null ? NAMA_KANAL[d.kanal] : `${NAMA_KANAL[d.kanal]} · ${d.tarif}`}</span>
            {/* Status bukan warna saja (DS #5): teks "Dipilih". */}
            {d.kanal === kanalAktif && <span className="t-caption">Dipilih</span>}
          </button>
        ))}
      </div>

      {sama && <p className="t-body-md">Tarif sama untuk kedua kanal.</p>}
      {ringkasan === 'kosong' && (
        <p className="t-body-md">Nama tarif tampil setelah ada item di keranjang.</p>
      )}
      {ringkasan === 'memuat' && <p className="t-body-md">Membaca tarif…</p>}
      {ringkasan === 'galat' && (
        <p className="t-body-md kasir-login-galat" role="alert">
          Tarif tidak dapat dibaca. Kanal tetap dapat dipilih.
        </p>
      )}

      <div className="kasir-dialog-aksi">
        <Tombol varian="ghost" kritis onClick={onTutup}>
          Tutup
        </Tombol>
      </div>
    </LatarDialog>
  );
}
