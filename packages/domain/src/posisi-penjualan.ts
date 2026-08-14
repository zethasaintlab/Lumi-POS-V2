/**
 * FR-G3 — posisi penjualan bersih, satu definisi untuk SELURUH laporan.
 *
 * `spec-g:29`: "Bila setiap laporan mengimplementasikan logikanya sendiri,
 * laporan akan saling bertentangan — dan laporan yang saling bertentangan
 * menghancurkan kepercayaan merchant lebih cepat daripada fitur yang hilang."
 *
 * Setiap laporan MEMANGGIL fungsi ini. Tidak ada laporan yang menulis query
 * agregasinya sendiri.
 *
 * ## ⛔ Definisi kanonik spec ditulis untuk skema yang bukan skema ini
 *
 * `spec-g:34`:
 *
 *     omzet_kotor = SUM(order.total) WHERE status IN ('PAID','CLOSED','REFUNDED')
 *     void_amount = SUM(order.total) WHERE status = 'VOIDED'
 *
 * Di repo ini void TIDAK mengubah status order aslinya. AC FR-B7 pertama
 * melarang `UPDATE` pada order asli, jadi yang lahir adalah order PEMBATAL
 * ber-status `voided` dengan `voided_by_order_id` menunjuk order yang
 * dibatalkan; order aslinya tetap `closed`.
 *
 * Membaca definisi itu harfiah berarti order yang sudah dibatalkan TETAP
 * masuk omzet kotor — persis yang `spec-g:39` larang ("TIDAK termasuk dalam
 * omzet kotor maupun bersih"). Yang dipertahankan di sini adalah maksudnya:
 * sebuah order dianggap batal bila ADA pembatal yang menunjuknya.
 *
 * ## Murni
 *
 * Tanpa I/O, tanpa waktu, tanpa database. Pemanggil yang menyediakan barisnya
 * — dari PostgreSQL di server, dari SQLite lokal di perangkat — dan justru itu
 * yang membuat AC FR-G4 ("angka laporan lokal cocok dengan laporan server")
 * dapat dipenuhi: keduanya menjalankan aritmetika yang sama persis.
 */

/**
 * Nilai uang dari database, dalam ketiga bentuk yang benar-benar muncul.
 *
 * ⛔ Ketiganya, bukan salah satu. `@powersync/web` mengembalikan kolom INTEGER
 * besar sebagai `bigint`, `node:sqlite` sebagai `number`, dan `pg`
 * mengembalikan `bigint` PostgreSQL sebagai STRING. Fungsi yang hanya menerima
 * satu bentuk hijau di test dan salah di salah satu aplikasi — pelajaran yang
 * sudah dibayar sekali saat menutup I10.
 */
export type NilaiUang = bigint | number | string;

function keBigInt(nilai: NilaiUang): bigint {
  if (typeof nilai === 'bigint') return nilai;
  if (typeof nilai === 'number') {
    if (!Number.isInteger(nilai)) {
      throw new Error(`Nilai uang ${nilai} bukan bilangan bulat; rupiah tidak pernah pecahan.`);
    }
    return BigInt(nilai);
  }
  return BigInt(nilai);
}

export interface OrderUntukPosisi {
  id: string;
  status: string;
  total: NilaiUang;
  /** `order.tax_amount` — SELURUH pajak, termasuk yang inklusif. */
  taxAmount: NilaiUang;
  /**
   * Diisi HANYA pada order pembatal, menunjuk order yang dibatalkan.
   *
   * Namanya terbaca terbalik; itu utang yang tercatat di `HANDOFF.md`, bukan
   * kekeliruan — arahnya dipaksa AC FR-B7 pertama.
   */
  voidedByOrderId: string | null;
}

export interface RefundUntukPosisi {
  orderId: string;
  amount: NilaiUang;
}

export interface PosisiPenjualan {
  omzetKotor: bigint;
  voidAmount: bigint;
  refundAmount: bigint;
  omzetBersih: bigint;
  pajakTerkumpul: bigint;
  jumlahTransaksi: number;
  rataRataPerTransaksi: bigint;
}

/**
 * Status yang dihitung sebagai PENJUALAN.
 *
 * `open` dan `abandoned` tidak: keduanya belum menghasilkan uang. `voided`
 * tidak: baris ber-status itu adalah pembatal, dan nilainya SALINAN dari order
 * yang dibatalkannya — memasukkannya akan membuat omzet NAIK setiap kali
 * sebuah penjualan dibatalkan.
 */
const STATUS_PENJUALAN: ReadonlySet<string> = new Set(['paid', 'closed', 'refunded']);

export function posisiPenjualan({
  orders,
  refunds,
}: {
  orders: readonly OrderUntukPosisi[];
  refunds: readonly RefundUntukPosisi[];
}): PosisiPenjualan {
  // Order mana yang punya pembatal. Dikumpulkan lebih dulu karena pembatal
  // dapat muncul di posisi mana pun dalam larik — SQL tidak menjamin urutan
  // tanpa `ORDER BY`, dan menggantungkan kebenaran pada urutan adalah cacat
  // yang tidak akan pernah terlihat di test yang memakai fake.
  const dibatalkan = new Set<string>();
  let voidAmount = 0n;
  for (const o of orders) {
    if (o.voidedByOrderId !== null && o.voidedByOrderId !== undefined) {
      dibatalkan.add(o.voidedByOrderId);
      voidAmount += keBigInt(o.total);
    }
  }

  // Refund per order, supaya porsi pajaknya dapat dihitung per order.
  const refundPerOrder = new Map<string, bigint>();
  let refundAmount = 0n;
  for (const r of refunds) {
    const nilai = keBigInt(r.amount);
    refundPerOrder.set(r.orderId, (refundPerOrder.get(r.orderId) ?? 0n) + nilai);
  }

  let omzetKotor = 0n;
  let pajakTerkumpul = 0n;
  let jumlahTransaksi = 0;

  for (const o of orders) {
    if (!STATUS_PENJUALAN.has(o.status)) continue;
    if (dibatalkan.has(o.id)) continue;

    const total = keBigInt(o.total);
    omzetKotor += total;
    jumlahTransaksi += 1;

    // Refund atas order INI mengurangi omzet bersih dan porsi pajaknya.
    // Refund atas order yang dibatalkan tidak pernah sampai ke sini — order
    // itu sudah keluar dari omzet kotor, dan mengurangkannya lagi akan
    // menghapus penjualan yang sama dua kali.
    const direfund = refundPerOrder.get(o.id) ?? 0n;
    refundAmount += direfund;

    // `spec-g:45`: pajak dikurangi "porsi yang direfund" — sebanding, karena
    // refund parsial mengembalikan sebagian barang beserta pajaknya.
    // Pembagian integer membulatkan ke bawah; selisih rupiah-an di sini tidak
    // pernah menjadi uang yang dibayarkan siapa pun, dan membulatkan ke atas
    // akan melaporkan pajak lebih besar daripada yang benar-benar terkumpul.
    const pajakOrder = keBigInt(o.taxAmount);
    if (total > 0n && direfund > 0n) {
      const sisa = total > direfund ? total - direfund : 0n;
      pajakTerkumpul += (pajakOrder * sisa) / total;
    } else {
      pajakTerkumpul += pajakOrder;
    }
  }

  // Refund atas order yang TIDAK ada di periode ini (`spec-g:283` — refund
  // transaksi hari lalu) tetap mengurangi omzet bersih hari ini. Itu sebabnya
  // ia dijumlahkan dari daftar refund, bukan hanya dari order yang cocok.
  for (const [orderId, nilai] of refundPerOrder) {
    const punyaOrder = orders.some(
      (o) => o.id === orderId && STATUS_PENJUALAN.has(o.status) && !dibatalkan.has(o.id)
    );
    if (!punyaOrder && !dibatalkan.has(orderId)) refundAmount += nilai;
  }

  // ⛔ Tanpa clamp. `spec-g:283`: refund yang melebihi penjualan menghasilkan
  // omzet bersih NEGATIF, dan ia "ditampilkan apa adanya dengan penjelasan".
  // Menjepitnya ke nol menyembunyikan hari yang justru paling perlu dilihat.
  const omzetBersih = omzetKotor - refundAmount;

  return {
    omzetKotor,
    voidAmount,
    refundAmount,
    omzetBersih,
    pajakTerkumpul,
    jumlahTransaksi,
    rataRataPerTransaksi: jumlahTransaksi === 0 ? 0n : omzetBersih / BigInt(jumlahTransaksi),
  };
}
