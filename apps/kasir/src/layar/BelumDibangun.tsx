import { EmptyState } from 'ds';
import type { Rute } from '../rute/tabel.ts';

/* Isi setiap layar kasir sampai layarnya benar-benar dibangun.
   SATU komponen untuk semua rute, bukan tujuh berkas kosong: yang berbeda
   antar-layar cuma judulnya, dan tujuh salinan hanya menciptakan tujuh tempat
   yang harus diingat saat pola shell berubah.

   Ia memakai EmptyState karena aturan design system #7 menuntut setiap
   komponen punya keadaan kosong -- dan "belum dibangun" adalah keadaan kosong
   yang paling jujur untuk layar yang memang belum ada. */
export function BelumDibangun({ rute }: { rute: Rute | null }) {
  if (!rute) {
    return (
      <EmptyState
        title="Layar tidak ditemukan"
        body="Alamat ini tidak dikenal aplikasi kasir. Kembali lewat menu di kanan atas."
      />
    );
  }
  return (
    <EmptyState
      title={rute.nama}
      body={`Layar ${rute.layar} belum dibangun. Rutenya sudah terpasang, jadi tautan ke sini tidak akan berubah lagi.`}
    />
  );
}
