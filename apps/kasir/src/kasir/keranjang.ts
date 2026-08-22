import type { PermintaanDiskon } from '../../../../packages/domain/src/diskon.ts';
import type { ItemKatalog, ModifierPilihan, VariationKatalog } from '../katalog/baca.ts';

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

export interface BarisKeranjang {
  id: string;
  variationId: string;
  itemName: string;
  variationName: string;
  /** Rupiah utuh, sudah diresolusi lewat tangga harga. */
  unitPrice: number;
  /** ×1000. `CLAUDE.md`: REAL membuat `WHERE stok = 0` gagal diam-diam. */
  quantityMilli: number;
  modifier: ModifierPilihan[];
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
 */
function sidik(variationId: string, modifier: readonly ModifierPilihan[]): string {
  const m = modifier.map((x) => x.id).sort().join(',');
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
    modifier: readonly ModifierPilihan[];
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
    const satuan = BigInt(b.unitPrice) + b.modifier.reduce((s, m) => s + BigInt(m.harga), 0n);
    jumlah += (satuan * BigInt(b.quantityMilli)) / 1000n;
  }
  return jumlah;
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
