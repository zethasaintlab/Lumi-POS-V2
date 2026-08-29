import type { PermintaanDiskon } from '../../../../packages/domain/src/diskon.ts';
import type { ItemKatalog, VariationKatalog } from '../katalog/baca.ts';

/**
 * Keranjang K-03. Murni: tanpa React, tanpa database, tanpa waktu.
 *
 * ## Kenapa nilai, bukan objek yang bermutasi
 *
 * Setiap operasi mengembalikan keranjang BARU. Itu yang membuat seluruh
 * aturan di bawah dapat diuji sebagai fungsi, dan yang membuat React tidak
 * perlu ditebak-tebak kapan harus render ulang — sesuai keputusan user
 * 8 Agustus 2026 (tanpa library state).
 *
 * ## Yang TIDAK dihitung di sini
 *
 * Pajak, service charge, pembulatan, dan total akhir. Semuanya milik
 * `computeOrderTotals` / `calculateTax` di `packages/domain`, yang dibagi
 * dengan server — kalau keranjang menghitungnya sendiri, angka di layar
 * kasir akan menyimpang dari angka yang tersimpan. `subtotalKeranjang` di
 * bawah hanya untuk menampilkan subtotal berjalan.
 */

/**
 * Modifier yang SUDAH DIPILIH, dengan kuantitasnya. FR-A3.
 *
 * ⛔ Tipe tersendiri, bukan `ModifierPilihan` katalog. Keduanya punya bentuk
 * yang mirip dan itu yang membuat pemakaian ulangnya menggoda, tapi `bawaan`
 * adalah sifat KATALOG (apa yang terpilih saat dialog dibuka) sementara
 * `qtyMilli` adalah sifat PILIHAN (berapa yang diambil pelanggan ini). Satu
 * tipe untuk keduanya berarti `bawaan` ikut tersimpan ke keranjang dan
 * terkirim ke server sebagai bagian dari pesanan.
 *
 * `qtyMilli` berskala 1000 seperti setiap kuantitas di repo ini, meski
 * modifier selalu bilangan bulat. Konvensi yang punya pengecualian adalah
 * konvensi yang akan disalin salah.
 */
export interface ModifierTerpilih {
  id: string;
  nama: string;
  harga: number;
  /** ×1000. `allow_duplicate = false` selalu `1000`. */
  qtyMilli: number;
}

export interface BarisKeranjang {
  id: string;
  variationId: string;
  itemName: string;
  variationName: string;
  /**
   * FR-A2 AC keempat — berapa varian yang item ini punya saat dimasukkan.
   *
   * ⛔ Dibekukan DI SINI, bukan dibaca ulang saat menyimpan. Katalog dapat
   * turun di tengah antrean pelanggan; keranjang yang membaca ulang akan
   * menyimpan jumlah varian dari SESUDAH kasir menekan kartunya.
   */
  variationCount: number;
  /** Rupiah utuh, sudah diresolusi lewat tangga harga. */
  unitPrice: number;
  /** ×1000. `CLAUDE.md`: REAL membuat `WHERE stok = 0` gagal diam-diam. */
  quantityMilli: number;
  modifier: ModifierTerpilih[];
}

/**
 * Diskon tingkat order yang menempel pada keranjang. FR-B8.
 *
 * ⛔ Yang disimpan adalah PERMINTAAN (`persen 15%`), bukan nominal hasilnya.
 * Nominal bergantung pada subtotal, dan subtotal berubah setiap kali kasir
 * menambah baris — diskon 10% yang dibekukan jadi Rp 10.000 saat keranjang
 * berisi Rp 100.000 akan tetap Rp 10.000 setelah baris kedua masuk, dan
 * merchant memberi separuh dari yang ia kira.
 *
 * `approverId` menempel di sini juga, dan itu bukan kenyamanan: ia harus ikut
 * sampai ke `outbox_local.approver_id` saat penjualan disimpan. Tanpa itu
 * diskon di atas ambang yang dibuat offline dijawab `403` oleh server lalu
 * berhenti permanen di antrean — bentuk cacat yang sama dengan refund offline
 * (`tests/ordering/refund-offline-relay.test.js`).
 */
export interface DiskonKeranjang {
  minta: PermintaanDiskon;
  alasanKode: string;
  alasanCatatan: string | null;
  /** Manajer yang menyetujui, bila ambangnya terlewati. */
  approverId: string | null;
  /**
   * ⛔ Nominal rupiah yang DILIHAT manajer saat menyetujui. `null` bila tidak
   * ada persetujuan.
   *
   * Tanpa ini, persetujuan atas "30%" berlaku untuk keranjang mana pun
   * SESUDAHNYA: manajer menyetujui 30% dari Rp 100.000 — Rp 30.000 — lalu
   * kasir menambahkan barang senilai Rp 900.000 dan potongannya menjadi
   * Rp 300.000 dengan persetujuan yang sama. Yang disetujui adalah ANGKANYA,
   * dan angka yang tumbuh melewatinya menuntut persetujuan baru.
   *
   * Potongan yang MENGECIL tetap sah — manajer sudah menyetujui yang lebih
   * besar, dan meminta persetujuan ulang untuk itu hanya melatih manajer
   * mengetik PIN tanpa membaca.
   */
  nominalDisetujui: bigint | null;
}

export interface Keranjang {
  baris: BarisKeranjang[];
  /** `null` = tidak ada diskon. */
  diskon: DiskonKeranjang | null;
}

export function keranjangKosong(): Keranjang {
  return { baris: [], diskon: null };
}

export function setelDiskon(k: Keranjang, diskon: DiskonKeranjang | null): Keranjang {
  return { ...k, diskon };
}

/**
 * ⛔ Diskon DILEPAS saat keranjang menjadi kosong.
 *
 * Keranjang kosong yang masih memegang "diskon 30% disetujui Budi" akan
 * menerapkannya pada pesanan BERIKUTNYA — pesanan pelanggan lain, dengan
 * persetujuan yang tidak pernah diberikan untuknya.
 */
export function lepasDiskonBilaKosong(k: Keranjang): Keranjang {
  return k.baris.length === 0 && k.diskon !== null ? { ...k, diskon: null } : k;
}

/**
 * Sidik jari yang menentukan dua penambahan digabung atau tidak.
 *
 * ⛔ Modifier DIURUTKAN sebelum digabung. Urutan penekanan tombol tidak boleh
 * menghasilkan dua baris untuk pesanan yang identik — kasir yang memilih
 * "gula" lalu "es" dan kasir yang memilih "es" lalu "gula" memesan hal yang
 * sama, dan barista membaca struk yang sama.
 *
 * Variation ikut ke dalam sidik jari: Regular dan Large harganya berbeda,
 * dan menggabungkannya menghasilkan struk yang totalnya benar tapi barisnya
 * bohong — lalu refund sebagian, yang menyebut baris, menjadi mustahil.
 *
 * ⛔ KUANTITAS modifier ikut (FR-A3, `allow_duplicate`). "Extra Shot ×1" dan
 * "Extra Shot ×2" adalah dua pesanan berbeda dengan harga berbeda;
 * menggabungkannya membuat pelanggan kedua menerima kopi pelanggan pertama —
 * dan totalnya salah tanpa satu pun error.
 */
function sidik(variationId: string, modifier: readonly ModifierTerpilih[]): string {
  const m = modifier
    .map((x) => `${x.id}×${x.qtyMilli}`)
    .sort()
    .join(',');
  return `${variationId}|${m}`;
}

export function tambah(
  keranjang: Keranjang,
  {
    item,
    variation,
    modifier,
    idBaris,
    qtyMilli = 1000,
  }: {
    item: ItemKatalog;
    variation: VariationKatalog;
    modifier: readonly ModifierTerpilih[];
    idBaris: () => string;
    qtyMilli?: number;
  }
): Keranjang {
  const kunci = sidik(variation.id, modifier);
  const adaIndex = keranjang.baris.findIndex((b) => sidik(b.variationId, b.modifier) === kunci);

  if (adaIndex >= 0) {
    const baris = keranjang.baris.map((b, i) =>
      i === adaIndex ? { ...b, quantityMilli: b.quantityMilli + qtyMilli } : b
    );
    return { ...keranjang, baris };
  }

  return {
    ...keranjang,
    baris: [
      ...keranjang.baris,
      {
        id: idBaris(),
        variationId: variation.id,
        // Nama DISALIN, bukan ditunjuk. `order_line.item_name` adalah
        // snapshot (`CLAUDE.md`): produk yang diganti namanya besok tidak
        // boleh mengubah struk yang sudah tercetak hari ini.
        itemName: item.nama,
        variationName: variation.nama,
        // FR-A2 — dibekukan bersama namanya, alasan yang sama.
        //
        // ⛔ `?? 1` bukan kelonggaran tipe. `ItemKatalog` menuntut
        // `variations`, jadi TypeScript menjaminnya di setiap pemanggil
        // produksi — yang dijaga di sini adalah kasir yang sedang melayani
        // antrean. Item yang entah bagaimana sampai tanpa daftar variannya
        // tidak boleh menjatuhkan penjualan demi satu kata di struk; 1
        // menghasilkan perilaku yang sama dengan sebelum kolom ini ada.
        variationCount: item.variations?.length ?? 1,
        unitPrice: variation.harga,
        quantityMilli: qtyMilli,
        modifier: [...modifier],
      },
    ],
  };
}

/** Kuantitas nol MENGHAPUS barisnya — lihat komentar di test. */
export function ubahQty(keranjang: Keranjang, barisId: string, qtyMilli: number): Keranjang {
  if (qtyMilli <= 0) return hapusBaris(keranjang, barisId);
  return {
    ...keranjang,
    baris: keranjang.baris.map((b) => (b.id === barisId ? { ...b, quantityMilli: qtyMilli } : b)),
  };
}

export function hapusBaris(keranjang: Keranjang, barisId: string): Keranjang {
  // ⛔ `lepasDiskonBilaKosong`: baris terakhir yang dihapus membawa diskonnya
  // pergi. Lihat alasannya di fungsi itu.
  return lepasDiskonBilaKosong({
    ...keranjang,
    baris: keranjang.baris.filter((b) => b.id !== barisId),
  });
}

export function kosongkan(_keranjang: Keranjang): Keranjang {
  return keranjangKosong();
}

/**
 * Subtotal berjalan, untuk DITAMPILKAN.
 *
 * ⛔ `bigint`, tanpa satu pun float. Kuantitas berskala 1000 dan harga rupiah
 * utuh, jadi hasil kalinya dibagi 1000n — pembagian bigint memotong, dan itu
 * benar di sini: kuantitas pecahan hanya berlaku untuk barang timbang, yang
 * harganya sudah per satuan terkecil.
 *
 * Ini BUKAN total. Pajak, service charge, dan pembulatan ditambahkan
 * `computeOrderTotals`.
 */
export function subtotalKeranjang(keranjang: Keranjang): bigint {
  let jumlah = 0n;
  for (const b of keranjang.baris) {
    jumlah += (satuanKeranjang(b) * BigInt(b.quantityMilli)) / 1000n;
  }
  return jumlah;
}

/**
 * Harga satu unit baris — harga variation + modifier, kuantitas modifier ikut.
 *
 * ⛔ Satu tempat, dipakai `subtotalKeranjang` DAN layar. Sebelum FR-A3 ada dua
 * salinan penjumlahan yang sama di berkas ini dan di `Kasir.tsx`; kuantitas
 * modifier yang lahir kemudian hanya masuk ke salah satunya, dan angka di
 * baris keranjang berbeda dari subtotal di bawahnya tanpa satu pun error.
 *
 * Ini BUKAN `computeLineTotal` — yang menghitung baris yang benar-benar
 * tersimpan tetap fungsi domain itu, dan angka di sini hanya untuk
 * ditampilkan.
 */
export function satuanKeranjang(baris: BarisKeranjang): bigint {
  let satuan = BigInt(baris.unitPrice);
  for (const m of baris.modifier) {
    satuan += (BigInt(m.harga) * BigInt(m.qtyMilli)) / 1000n;
  }
  return satuan;
}

/**
 * Total kuantitas variation ini di keranjang, ×1000.
 *
 * ⛔ Dijumlahkan LINTAS baris. Modifier yang berbeda memisahkan baris, tapi
 * stoknya satu: kasir yang menambah 2 Kopi biasa lalu 2 Kopi extra-shot sudah
 * mengambil 4 dari rak. Memeriksa per baris akan meloloskan penjualan yang
 * melewati stok tanpa satu pun peringatan (FR-E4).
 */
export function qtyDiKeranjang(keranjang: Keranjang, variationId: string): number {
  let total = 0;
  for (const b of keranjang.baris) {
    if (b.variationId === variationId) total += b.quantityMilli;
  }
  return total;
}
