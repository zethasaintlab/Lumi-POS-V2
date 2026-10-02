import { useState } from 'react';
import { Pembayaran } from '../layar/Pembayaran.tsx';
import { setelKeranjang } from '../kasir/simpanan.ts';
import { keranjangKosong } from '../kasir/keranjang.ts';

/* Pembungkus galeri untuk K-06. Keranjang hidup di MEMORI (`simpanan.ts`) dan
   biasanya diisi K-03; layar yang dibuka langsung dari galeri tidak melewati
   K-03, jadi tanpa ini yang tampil hanya "Keranjang kosong" — satu tombol, tidak
   ada yang mati. Dipasang sinkron sebelum render pertama `Pembayaran`. */
function pasangKeranjang(): boolean {
  setelKeranjang({
    ...keranjangKosong(),
    baris: Array.from({ length: 3 }, (_, i) => ({
      id: `galeri-bayar-${i}`,
      variationId: `var-${i}`,
      itemName: `Item Galeri ${i + 1}`,
      variationName: 'Regular',
      variationCount: 1,
      unitPrice: 20000 + i * 2500,
      quantityMilli: 1000,
      modifier: [],
    })),
  });
  return true;
}

export function BayarGaleri({ tabAwal }: { tabAwal?: 'tunai' | 'qris' }) {
  useState(pasangKeranjang);
  /* "Kembali ke kasir" di aplikasi mengganti layar; galeri tidak punya router, jadi
     ia mengganti isi panggung dengan kalimat — tombol yang tampak hidup di G-TOMBOL-HIDUP. */
  const [kembali, setKembali] = useState(false);
  if (kembali) return <p className="t-body-md">Kembali ke K-03 (galeri tidak memuat layar itu dari sini).</p>;
  return <Pembayaran onKembali={() => setKembali(true)} tabAwal={tabAwal} />;
}
