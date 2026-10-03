import { Tombol } from '../Tombol.tsx';
import { LatarDialog } from './LatarDialog.tsx';
import { LABEL_KANAL, type Kanal, type RingkasanKanal } from '../kasir/kanal.ts';

/* K-03 — lembar Pajak: memilih kanal pesanan, Takeaway atau Dine in (FR-C7,
   spec § 4 "Pajak sebagai pilihan kanal").

   ⛔ Yang ditampilkan NAMA tarif dari `TaxRate.name`, tidak pernah persentase
   yang diketik di sini (invariant #7) dan tidak pernah kata yang menyiratkan
   biaya layanan: `service_charge` masih terkunci nol di klien dan server.

   Tiga keadaan: memuat (`ringkasan === null`, `galat === false`), galat
   (`galat`, pilihan tetap dapat dipakai tanpa nama tarif), dan kosong (tarif
   tidak ada → "tanpa pajak", bukan baris hilang). */

interface Props {
  kanal: Kanal;
  ringkasan: RingkasanKanal[] | null;
  galat: boolean;
  onPilih: (kanal: Kanal) => void;
  onBatal: () => void;
}

function teksPilihan(r: RingkasanKanal | undefined, kanal: Kanal): string {
  if (!r) return LABEL_KANAL[kanal];
  return `${LABEL_KANAL[kanal]} · ${r.namaTarif.length === 0 ? 'tanpa pajak' : r.namaTarif.join(' + ')}`;
}

export function LembarKanal({ kanal, ringkasan, galat, onPilih, onBatal }: Props) {
  const urutan: Kanal[] = ['takeaway', 'dine_in'];
  return (
    <LatarDialog label="Pajak pesanan" onBatal={onBatal}>
      <h2 className="t-title">Pajak pesanan</h2>
      <p className="t-caption kasir-login-sub">Pilih kanal pesanan. Kanal menentukan tarif pajak yang berlaku.</p>

      {ringkasan === null && !galat && <p className="t-body-md">Membaca tarif…</p>}
      {galat && (
        <p className="t-body-md kasir-login-galat" role="alert">
          Tarif tidak dapat dibaca. Kanal tetap dapat dipilih; pajak dihitung saat pembayaran.
        </p>
      )}

      <div className="kasir-lembar-kanal" role="group" aria-label="Kanal pesanan">
        {urutan.map((k) => {
          const aktif = k === kanal;
          return (
            <Tombol
              key={k}
              varian={aktif ? 'primary' : 'secondary'}
              kritis
              onClick={() => onPilih(k)}
            >
              {teksPilihan(ringkasan?.find((r) => r.kanal === k), k)}
              {aktif ? ' · Dipilih' : ''}
            </Tombol>
          );
        })}
      </div>

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
