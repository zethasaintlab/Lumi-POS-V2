import { useState } from 'react';
import { Bidang } from '../Bidang.tsx';
import { Tombol } from '../Tombol.tsx';
import { LatarDialog } from './LatarDialog.tsx';

/* K-03 toolbar — Item manual (spec § 4 baris 1, P4(a) keputusan user).
 *
 * ⛔ SATU jalur, bukan jalur kedua yang menambahkan ke keranjang. Kasir
 * mengetik barcode/SKU saat scanner gagal atau label rusak; kode yang
 * diketik di sini masuk lewat `onKode` — fungsi `dipindai` YANG SAMA yang
 * K-17 pakai untuk scan fisik (`Kasir.tsx`). Menulis `tambah()` sendiri di
 * sini akan melompati aturan stok FR-E4/E5 dan pesan "Barcode tidak
 * dikenali" yang `dipindai` sudah tegakkan — dua jalur untuk satu pertanyaan,
 * yang menyimpang persis pada kasus yang paling penting (stok habis).
 *
 * ⛔ Dialog SELALU ditutup sesudah "Tambah", kode dikenal ATAU asing.
 * `dipindai` sudah menyatakan hasilnya di layar K-03 di belakang dialog ini
 * (baris keranjang bertambah, ATAU `pesanStok` + kotak cari terisi kode yang
 * tidak dikenal — "Cari manual di daftar"). Dialog yang tetap terbuka
 * menutupi pesan itu tepat saat kasir perlu membacanya.
 *
 * "Barang custom" (item berharga bebas di luar katalog, ala Kasir Pintar) —
 * lihat `docs/RENCANA-HIDUPKAN-DESAIN.md` § Keputusan produk tertunda.
 * BUKAN dibangun di sini.
 */

interface Props {
  onKode: (kode: string) => void;
  onBatal: () => void;
}

export function DialogKodeManual({ onKode, onBatal }: Props) {
  const [kode, setKode] = useState('');
  const siap = kode.trim() !== '';

  const kirim = () => {
    if (!siap) return;
    onKode(kode.trim());
    onBatal();
  };

  return (
    <LatarDialog label="Item manual" onBatal={onBatal}>
      <form
        className="kasir-dialog-form"
        onSubmit={(e) => {
          e.preventDefault();
          kirim();
        }}
      >
        <h2 className="t-title">Item manual</h2>
        <p className="t-caption kasir-login-sub">
          Ketik barcode atau SKU saat scanner gagal atau label rusak.
        </p>

        <Bidang
          label="Kode barang"
          value={kode}
          onChange={setKode}
          placeholder="mis. 8992761111017"
          autoFokus
        />

        <div className="kasir-dialog-aksi">
          <Tombol varian="ghost" kritis onClick={onBatal}>
            Batal
          </Tombol>
          <Tombol varian="primary" kritis disabled={!siap} onClick={kirim}>
            Tambah
          </Tombol>
        </div>
      </form>
    </LatarDialog>
  );
}
