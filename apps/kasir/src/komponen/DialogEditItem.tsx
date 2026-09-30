import { Icon } from 'ds';
import { useRef, useState } from 'react';
import type { PilihanModifier } from '../../../../packages/domain/src/modifier-pilihan.ts';
import { tampilkanKuantitas } from '../../../../packages/domain/src/kuantitas.ts';
import { rupiah } from '../../../../packages/domain/src/uang-tampilan.ts';
import type { DaftarModifier } from '../katalog/baca.ts';
import { periksaTambahStok } from '../kasir/batas-stok.ts';
import {
  gantiModifier,
  qtyDiKeranjang,
  satuanKeranjang,
  ubahQty,
  type BarisKeranjang,
  type Keranjang,
  type ModifierTerpilih,
} from '../kasir/keranjang.ts';
import { Tombol } from '../Tombol.tsx';
import { LatarDialog } from './LatarDialog.tsx';
import {
  modifierTerpilihDari,
  PemilihModifier,
  pesanKurangSemua,
  pilihanDariBaris,
  type PilihanPerDaftar,
} from './PemilihModifier.tsx';

/* Edit Item — dibuka dengan menyentuh baris keranjang (spec kasir § 6).

   ⛔ Yang diedit adalah DRAF, bukan keranjang. Simpan menerapkan qty dan
   modifier dalam SATU panggilan `onSimpan` (keranjang hasil akhir), jadi
   `simpanKeranjang` (KEP-21) menulis satu kali; Batal dan tombol tutup tidak
   mengubah apa pun.

   ⛔ Kenaikan qty lewat `periksaTambahStok` — jalur yang sama dengan ketukan
   kartu (FR-E4/E5). Stepper lama memanggil `ubahQty` langsung dan melewati
   pemeriksaan itu; dialog inilah yang menutup lubangnya (R6). Pengurangan
   tidak pernah diperiksa.

   ⛔ Tidak ada field harga, diskon, atau catatan (spec § 6, ditolak): harga
   diresolusi dari `price_history`, diskon tetap tingkat order, `order_line`
   tidak punya kolom catatan. Tidak ada tombol "Hapus item" terpisah — qty
   turun ke 0 mengubah tombol utama menjadi "Hapus dari keranjang".

   ⛔ Simpan yang MENURUNKAN qty (atau menghapus baris) meninggalkan jejak
   audit (Task 5C, issue #76 Q2). `onSimpan` mengembalikan pesan galat, atau
   `null` bila berhasil (pemanggil menutup dialog): kegagalan menulis jejak
   MENAHAN dialog dan keranjang tetap utuh — keranjang berkurang tanpa jejak
   adalah persis yang fitur ini cegah. */

export function DialogEditItem({
  baris,
  keranjang,
  lacakStok,
  stok,
  habis,
  bolehNegatif,
  daftarModifier,
  onBatal,
  onSimpan,
}: {
  baris: BarisKeranjang;
  keranjang: Keranjang;
  /** `variation.lacakStok`; variation yang tak lagi ada di katalog dianggap tidak dilacak. */
  lacakStok: boolean;
  stok: ReadonlyMap<string, number>;
  habis: ReadonlySet<string>;
  bolehNegatif: boolean;
  daftarModifier: readonly DaftarModifier[];
  onBatal: () => void;
  /** Mengembalikan pesan galat, atau `null` bila berhasil. `qtySesudahMilli` = qty draf (0 = dihapus). */
  onSimpan: (baru: Keranjang, qtySesudahMilli: number) => Promise<string | null>;
}) {
  const [qty, setQty] = useState(baris.quantityMilli);
  const [terpilih, setTerpilih] = useState<PilihanPerDaftar>(() =>
    pilihanDariBaris(daftarModifier, baris.modifier)
  );
  const [berubahModifier, setBerubahModifier] = useState(false);
  const [pesan, setPesan] = useState<{ teks: string; blokir: boolean } | null>(null);
  const [menyimpan, setMenyimpan] = useState(false);
  /* ⛔ Penjaga masuk-ulang SINKRON: `disabled` baru berlaku sesudah render, dan
     klik kedua di tugas yang sama akan mencatat pengurangan yang sama dua kali. */
  const sedangKirim = useRef(false);
  const [galatSimpan, setGalatSimpan] = useState<string | null>(null);

  /* Kelengkapan modifier hanya dituntut bila kasir MENGUBAH modifier: baris hasil scan masuk tanpa
     modifier dan tetap harus dapat dikurangi qty-nya. */
  const kurang = berubahModifier ? pesanKurangSemua(daftarModifier, terpilih) : [];

  /* ⛔ Modifier di baris yang TIDAK ada di daftar (diarsipkan sesudah
     dimasukkan) tidak dapat dipilih ulang — dipertahankan apa adanya, bukan
     dibuang diam-diam (harga barisnya akan turun tanpa satu pun tanda). */
  const yatim = baris.modifier.filter((m) => !daftarModifier.some((d) => d.modifier.some((x) => x.id === m.id)));
  const modifierDraf: ModifierTerpilih[] = berubahModifier
    ? [...modifierTerpilihDari(daftarModifier, terpilih), ...yatim]
    : baris.modifier;

  /* ⛔ `satuanKeranjang` pada baris DRAF — modifier ikut, dan angkanya sama
     dengan yang dirender baris keranjang dan `subtotalKeranjang`. */
  const satuan = satuanKeranjang({ ...baris, modifier: modifierDraf });
  const subtotal = (satuan * BigInt(qty)) / 1000n;

  const ubahPilihan = (d: DaftarModifier, f: (p: PilihanModifier) => PilihanModifier) => {
    setBerubahModifier(true);
    setTerpilih((t) => ({ ...t, [d.id]: f(t[d.id] ?? {}) }));
  };

  const kurangi = () => {
    setPesan(null);
    setQty((q) => Math.max(0, q - 1000));
  };

  const tambahQty = () => {
    /* Kumulatif LINTAS baris: baris lain variation yang sama ikut terhitung,
       dan baris INI dihitung dari drafnya, bukan dari nilai tersimpan. */
    const diminta = qtyDiKeranjang(keranjang, baris.variationId) - baris.quantityMilli + qty + 1000;
    const h = periksaTambahStok({
      namaItem: baris.itemName,
      variationId: baris.variationId,
      lacakStok,
      dimintaMilli: diminta,
      stok,
      habis,
      bolehNegatif,
    });
    if (!h.boleh) {
      setPesan({ teks: h.pesan, blokir: true });
      return;
    }
    /* Peringatan TIDAK memblokir (`spec-e:146`). */
    setPesan(h.peringatan ? { teks: h.peringatan, blokir: false } : null);
    setQty((q) => q + 1000);
  };

  const kirim = (baru: Keranjang) => {
    if (sedangKirim.current) return;
    sedangKirim.current = true;
    setMenyimpan(true);
    setGalatSimpan(null);
    void onSimpan(baru, qty)
      .then((galat) => setGalatSimpan(galat))
      .catch((e: Error) => setGalatSimpan(`Perubahan TIDAK disimpan: ${e.message}`))
      .finally(() => {
        sedangKirim.current = false;
        setMenyimpan(false);
      });
  };

  const simpan = () => {
    if (qty === 0) {
      kirim(ubahQty(keranjang, baris.id, 0));
      return;
    }
    /* Urutan: qty DULU, lalu modifier. `gantiModifier` dapat menggabung baris
       ini ke baris kembarnya, dan penggabungan menjumlahkan qty yang SUDAH
       final — kebalikannya membuang qty draf. */
    let baru = ubahQty(keranjang, baris.id, qty);
    if (berubahModifier) baru = gantiModifier(baru, baris.id, modifierDraf);
    kirim(baru);
  };

  /* ⛔ Menutup dialog SELAMA menyimpan membuang galat penulisan yang gagal ke
     komponen yang sudah dilepas: kasir tidak diberi tahu bahwa keranjangnya
     tidak berubah. Esc, latar, dan tombol tutup sama-sama diblokir. */
  const tutup = () => {
    if (!sedangKirim.current) onBatal();
  };

  const tanpaPerubahan = qty === baris.quantityMilli && !berubahModifier;

  return (
    <LatarDialog label="Edit item" kelas="kasir-dialog-edit" onBatal={tutup}>
      <div className="kasir-edit-kepala">
        <div className="kasir-edit-judul">
          <h2 className="t-title">Edit item</h2>
          <p className="t-body-md">
            {baris.itemName}
            {baris.variationName !== 'Regular' ? ` · ${baris.variationName}` : ''}
          </p>
        </div>
        <button type="button" className="btn btn-ghost kasir-edit-tutup" aria-label="Tutup"
          disabled={menyimpan}
          aria-describedby={menyimpan ? 'edit-menyimpan-alasan' : undefined}
          onClick={tutup}
        >
          <Icon name="x" size={18} />
        </button>
      </div>

      <div className="kasir-edit-jumlah">
        <span className="label">Jumlah</span>
        <div className="kasir-edit-langkah">
          <Tombol
            varian="secondary"
            kritis
            disabled={qty === 0}
            keterangan={qty === 0 ? 'edit-nol-alasan' : undefined}
            onClick={kurangi}
            ariaLabel={qty === 1000 ? `Hapus ${baris.itemName} (jumlah menjadi 0)` : `Kurangi ${baris.itemName}`}
          >
            −
          </Tombol>
          <span className="t-title num" data-uji="edit-qty">
            {tampilkanKuantitas(String(qty))}
          </span>
          <Tombol varian="secondary" kritis onClick={tambahQty} ariaLabel={`Tambah ${baris.itemName}`}>
            +
          </Tombol>
        </div>
        {qty === 0 && (
          <p className="t-caption" id="edit-nol-alasan">
            Jumlah 0. Tekan Hapus dari keranjang untuk menghapus baris ini, atau Batal.
          </p>
        )}
      </div>

      {qty < baris.quantityMilli && (
        <p className="t-caption" data-uji="edit-tercatat">
          Pengurangan ini tercatat di audit: siapa, item, jumlah sebelum dan sesudah.
        </p>
      )}

      {menyimpan && (
        <p className="t-caption" id="edit-menyimpan-alasan">
          Sedang mencatat perubahan. Simpan, Batal, dan Tutup nonaktif sampai selesai.
        </p>
      )}

      {galatSimpan && (
        <p className="t-body-md kasir-login-galat" role="alert">
          {galatSimpan}
        </p>
      )}

      {pesan && (
        <p className={pesan.blokir ? 't-body-md kasir-login-galat' : 't-caption'} role={pesan.blokir ? 'alert' : 'status'}>
          {pesan.teks}
        </p>
      )}

      {daftarModifier.length > 0 && (
        <PemilihModifier daftar={daftarModifier} terpilih={terpilih} onUbah={ubahPilihan} />
      )}

      {kurang.length > 0 && (
        <p className="t-body-md kasir-login-galat" role="alert" id="edit-kurang">
          {kurang.join(' ')}
        </p>
      )}

      <div className="kasir-edit-ringkas">
        <span className="t-caption" data-uji="edit-satuan">
          {rupiah(satuan)} per item
        </span>
        <span className="t-body-md num" data-uji="edit-subtotal">
          {rupiah(subtotal)}
        </span>
      </div>

      <div className="kasir-dialog-aksi">
        <Tombol
          varian="ghost"
          kritis
          disabled={menyimpan}
          keterangan={menyimpan ? 'edit-menyimpan-alasan' : undefined}
          onClick={tutup}
        >
          Batal
        </Tombol>
        {qty === 0 ? (
          <Tombol
            varian="danger"
            kritis
            disabled={menyimpan}
            keterangan={menyimpan ? 'edit-menyimpan-alasan' : undefined}
            onClick={simpan}
          >
            {menyimpan ? 'Mencatat…' : 'Hapus dari keranjang'}
          </Tombol>
        ) : (
          <Tombol
            varian="primary"
            kritis
            disabled={kurang.length > 0 || menyimpan}
            keterangan={menyimpan ? 'edit-menyimpan-alasan' : kurang.length > 0 ? 'edit-kurang' : undefined}
            onClick={tanpaPerubahan ? onBatal : simpan}
          >
            {menyimpan ? 'Mencatat…' : 'Simpan'}
          </Tombol>
        )}
      </div>
    </LatarDialog>
  );
}
