import { SegmentedControl } from 'ds';
import { useState } from 'react';
import type { PilihanModifier } from '../../../../packages/domain/src/modifier-pilihan.ts';
import type { DaftarModifier, ItemKatalog, VariationKatalog } from '../katalog/baca.ts';
import type { ModifierTerpilih } from '../kasir/keranjang.ts';
import { Tombol } from '../Tombol.tsx';
import { rupiah } from '../../../../packages/domain/src/uang-tampilan.ts';
import { LatarDialog } from './LatarDialog.tsx';
import {
  modifierTerpilihDari,
  PemilihModifier,
  pesanKurangSemua,
  pilihanBawaan,
  type PilihanPerDaftar,
} from './PemilihModifier.tsx';

/* K-04 (modifier) dan K-05 (variation) dalam SATU dialog.

   IA memisahkannya jadi dua layar, dan itu benar sebagai inventaris. Tapi
   keduanya menjawab pertanyaan yang sama pada momen yang sama — "produk ini,
   yang mana persisnya?" — dan dua dialog berurutan menambah satu ketukan
   pada setiap penjualan yang punya keduanya. Digabung, bukan dihilangkan:
   masing-masing tetap punya bagiannya sendiri di layar.

   ⛔ Aturan pemilihannya (FR-A3) hidup di
   `packages/domain/src/modifier-pilihan.ts`, dan bentuk pemilihnya di
   `PemilihModifier.tsx` (dipakai juga Edit Item). Yang di berkas ini hanya
   pemilih ukuran dan tombol aksinya. */

export function DialogModifier({
  item,
  daftar,
  onBatal,
  onPilih,
}: {
  item: ItemKatalog;
  daftar: DaftarModifier[];
  onBatal: () => void;
  onPilih: (item: ItemKatalog, variation: VariationKatalog, modifier: ModifierTerpilih[]) => void;
}) {
  /* ⛔ Yang TERMURAH dipilih lebih dulu, bukan yang pertama di katalog.
     Ditemukan dengan menjalankan aplikasi: kartu grid mengiklankan
     "dari Rp 15.000" (harga terendah), lalu dialog memilih Large Rp 25.000
     karena `sort_order` keduanya sama dan "Large" menang secara alfabet.
     Kasir yang menekan Tambahkan tanpa membaca akan MENAGIH LEBIH — dan
     angka yang salah itu sudah masuk struk sebelum ada yang sadar.
     Preseleksi termurah membuat kedua angka sepakat, dan menyalahkannya
     hanya bisa ke arah yang tidak merugikan pelanggan. */
  const [variation, setVariation] = useState(
    item.variations.reduce((a, b) => (b.harga < a.harga ? b : a))
  );
  const [terpilih, setTerpilih] = useState<PilihanPerDaftar>(() => pilihanBawaan(daftar));

  const ubah = (d: DaftarModifier, f: (p: PilihanModifier) => PilihanModifier) =>
    setTerpilih((t) => ({ ...t, [d.id]: f(t[d.id] ?? {}) }));

  const kurang = pesanKurangSemua(daftar, terpilih);
  const semuaModifier: ModifierTerpilih[] = modifierTerpilihDari(daftar, terpilih);

  return (
    <LatarDialog label={item.nama} onBatal={onBatal}>
        <h2 className="t-title">{item.nama}</h2>

        {/* ⛔ `<SegmentedControl>` bundle menggantikan daftar radio,
            2 September 2026.

            Radio bertumpuk vertikal adalah bentuk yang benar untuk daftar
            panjang dan salah untuk pilihan yang saling eksklusif dan sedikit —
            "Regular / Large" adalah SATU keputusan, bukan dua pertanyaan. Ia
            juga memberi target sentuh sebesar lingkaran radionya sendiri,
            sementara segmented control memberi seluruh segmen.

            ⛔ Harga tetap dirender markup KITA lewat `rupiah()`. `<Chip>` dan
            `<SegmentedControl>` tidak menyentuh uang sama sekali — keduanya
            hanya menerima label — jadi keduanya ada di baris KEDUA aturan
            bundle (`CLAUDE.md` § Aturan memakai /ds-bundle), bukan baris
            ketiga. Yang ada di baris ketiga adalah `CartRow`/`ProductCard`,
            dan keduanya tidak dapat diimpor. */}
        {item.variations.length > 1 && (
          <div className="kasir-pilih-varian">
            <span className="label">Ukuran</span>
            <SegmentedControl
              ariaLabel="Ukuran"
              value={variation.id}
              onChange={(id: string) => {
                const v = item.variations.find((x) => x.id === id);
                if (v) setVariation(v);
              }}
              options={item.variations.map((v) => ({
                value: v.id,
                /* Nama DAN harga di dalam segmennya: varian tanpa harga
                   menuntut kasir mengingat selisihnya, dan selisih itulah
                   yang pelanggan tanyakan. */
                label: `${v.nama} · ${rupiah(v.harga)}`,
              }))}
            />
          </div>
        )}

        <PemilihModifier daftar={daftar} terpilih={terpilih} onUbah={ubah} />

        {kurang.length > 0 && (
          <p className="t-body-md kasir-login-galat" role="alert">
            {kurang.join(' ')}
          </p>
        )}

        <div className="kasir-dialog-aksi">
          <Tombol varian="ghost" kritis onClick={onBatal}>
            Batal
          </Tombol>
          <Tombol
            varian="primary"
            kritis
            disabled={kurang.length > 0}
            onClick={() => onPilih(item, variation, semuaModifier)}
          >
            Tambahkan
          </Tombol>
        </div>
    </LatarDialog>
  );
}
