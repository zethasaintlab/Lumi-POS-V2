import { useState } from 'react';
import {
  bolehTambah,
  kosongkanPilihan,
  kurangPilihan,
  kurangnya,
  pesanKurang,
  QTY_MODIFIER,
  tambahPilihan,
  togglePilihan,
  type AturanModifier,
  type PilihanModifier,
} from '../../../../packages/domain/src/modifier-pilihan.ts';
import type { DaftarModifier, ItemKatalog, VariationKatalog } from '../katalog/baca.ts';
import type { ModifierTerpilih } from '../kasir/keranjang.ts';
import { Tombol } from '../Tombol.tsx';
import { rupiah } from '../../../../packages/domain/src/uang-tampilan.ts';
import { LatarDialog } from './LatarDialog.tsx';

/* K-04 (modifier) dan K-05 (variation) dalam SATU dialog.

   IA memisahkannya jadi dua layar, dan itu benar sebagai inventaris. Tapi
   keduanya menjawab pertanyaan yang sama pada momen yang sama — "produk ini,
   yang mana persisnya?" — dan dua dialog berurutan menambah satu ketukan
   pada setiap penjualan yang punya keduanya. Digabung, bukan dihilangkan:
   masing-masing tetap punya bagiannya sendiri di layar.

   ⛔ Aturan pemilihannya (FR-A3) hidup di
   `packages/domain/src/modifier-pilihan.ts`, bukan di sini. Yang di berkas ini
   hanya bentuk layarnya. */

function aturanDari(d: DaftarModifier): AturanModifier {
  return {
    tipe: d.tipe,
    wajib: d.wajib,
    minPilih: d.minPilih,
    maxPilih: d.maxPilih,
    bolehGanda: d.bolehGanda,
  };
}

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
  /* `is_default` terpilih otomatis (AC FR-A3 kedua) — kuantitas satu, bukan
     kuantitas yang diwarisi dari mana pun. */
  const [terpilih, setTerpilih] = useState<Record<string, PilihanModifier>>(() =>
    Object.fromEntries(
      daftar.map((d) => [
        d.id,
        Object.fromEntries(d.modifier.filter((m) => m.bawaan).map((m) => [m.id, QTY_MODIFIER])),
      ])
    )
  );

  const ubah = (d: DaftarModifier, f: (p: PilihanModifier) => PilihanModifier) =>
    setTerpilih((t) => ({ ...t, [d.id]: f(t[d.id] ?? {}) }));

  const kurang = daftar
    .map((d) => pesanKurang(d.nama, aturanDari(d), terpilih[d.id] ?? {}))
    .filter((p): p is string => p !== null);

  /* ⛔ Baris terpilih diurutkan mengikuti KATALOG, bukan urutan penekanan
     tombol. Sidik jari keranjang mengurutkan sendiri, tapi struk dan layar
     membaca daftar ini apa adanya — dan barista yang membaca "Es, Gula" pada
     satu struk dan "Gula, Es" pada struk berikutnya untuk pesanan yang sama
     akan berhenti membaca urutannya. */
  const semuaModifier: ModifierTerpilih[] = daftar.flatMap((d) =>
    d.modifier
      .filter((m) => ((terpilih[d.id] ?? {})[m.id] ?? 0) > 0)
      .map((m) => ({
        id: m.id,
        nama: m.nama,
        harga: m.harga,
        qtyMilli: (terpilih[d.id] ?? {})[m.id],
      }))
  );

  return (
    <LatarDialog label={item.nama} onBatal={onBatal}>
        <h2 className="t-title">{item.nama}</h2>

        {item.variations.length > 1 && (
          <fieldset className="kasir-alasan">
            <legend className="t-body-md">Ukuran</legend>
            {item.variations.map((v) => (
              <label key={v.id} className="kasir-alasan-opsi t-body-md">
                <input
                  type="radio"
                  name="variation"
                  checked={variation.id === v.id}
                  onChange={() => setVariation(v)}
                />
                {v.nama} · <span className="num">{rupiah(v.harga)}</span>
              </label>
            ))}
          </fieldset>
        )}

        {daftar.map((d) => {
          const aturan = aturanDari(d);
          const pilihan = terpilih[d.id] ?? {};
          const sisaKurang = kurangnya(aturan, pilihan);
          return (
            <fieldset key={d.id} className="kasir-alasan">
              <legend className="t-body-md">
                {d.nama}
                {d.wajib ? ' · wajib' : ''}
                {/* AC FR-A3 pertama menuntut batasnya TERLIHAT, bukan hanya
                    ditegakkan. Kasir yang tombolnya mati tanpa penjelasan akan
                    menyimpulkan aplikasinya rusak. */}
                {d.maxPilih !== null ? ` · maksimal ${d.maxPilih}` : ''}
                {sisaKurang > 0 ? ` · kurang ${sisaKurang}` : ''}
              </legend>

              {/* `single` yang TIDAK wajib mendapat "Tanpa pilihan"
                  (`spec-a:119`). Tanpanya, radio yang sudah ditekan tidak
                  dapat dibatalkan sama sekali — kasir harus menutup dialog dan
                  mengulang seluruh pesanan. */}
              {d.tipe === 'single' && !d.wajib && d.minPilih === 0 && (
                <label className="kasir-alasan-opsi t-body-md">
                  <input
                    type="radio"
                    name={d.id}
                    checked={Object.keys(pilihan).length === 0}
                    onChange={() => ubah(d, kosongkanPilihan)}
                  />
                  Tanpa pilihan
                </label>
              )}

              {d.modifier.map((m) => {
                const qty = pilihan[m.id] ?? 0;
                const penuh = qty === 0 && !bolehTambah(aturan, pilihan, m.id);
                return (
                  <label key={m.id} className="kasir-alasan-opsi t-body-md">
                    <input
                      type={d.tipe === 'single' ? 'radio' : 'checkbox'}
                      name={d.id}
                      checked={qty > 0}
                      /* ⛔ DINONAKTIFKAN, bukan diterima lalu ditolak
                         (`spec-a:126`). Menerima pilihan ke-4 lalu menampilkan
                         error setelah tombol Tambahkan berarti kasir sudah
                         menyebut angkanya ke pelanggan. */
                      disabled={penuh}
                      onChange={() => ubah(d, (p) => togglePilihan(aturan, p, m.id))}
                    />
                    {m.nama}
                    {m.harga !== 0 && <span className="num"> · +{rupiah(m.harga)}</span>}

                    {/* `allow_duplicate` → stepper (`spec-a:121`). Ia muncul
                        hanya untuk yang SUDAH dipilih: stepper pada modifier
                        yang belum dipilih adalah dua cara memilih hal yang
                        sama, dan kasir menekan yang salah. */}
                    {d.bolehGanda && qty > 0 && (
                      <>
                        <Tombol
                          varian="ghost"
                          onClick={() => ubah(d, (p) => kurangPilihan(p, m.id))}
                        >
                          −
                        </Tombol>
                        <span className="num">×{qty / QTY_MODIFIER}</span>
                        <Tombol
                          varian="ghost"
                          disabled={!bolehTambah(aturan, pilihan, m.id)}
                          onClick={() => ubah(d, (p) => tambahPilihan(aturan, p, m.id))}
                        >
                          +
                        </Tombol>
                      </>
                    )}
                  </label>
                );
              })}
            </fieldset>
          );
        })}

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
