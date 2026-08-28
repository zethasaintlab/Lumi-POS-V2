import type { BarisStruk, ReceiptDocument } from './escpos.ts';

/**
 * `ReceiptDocument` — struktur deskriptif struk (FR-C10, `spec-c:371`).
 *
 * `ARCH:204`: "Aplikasi menghasilkan struktur deskriptif (baris, gaya, cut,
 * drawer, logo); renderer menerjemahkannya ke byte. Tanpa pemisahan ini,
 * mendukung printer fiskal berarti menyentuh layar kasir."
 *
 * ## ⛔ MURNI, dan seluruh datanya SNAPSHOT
 *
 * `spec-b:145`: "Cetak ulang struk tidak melakukan query ke tabel katalog."
 * Fungsi ini tidak melakukan query apa pun — pemanggil yang membaca baris dari
 * SQLite lokal, dan yang dibacanya hanya `order`, `order_line`,
 * `order_line_modifier`, dan `payment`. Semua nama dan harga sudah tersimpan
 * sebagai salinan di `order_line` (`spec-b:115`).
 *
 * Akibatnya skenario `spec-b:131` berlaku sendirinya: produk yang di-rename,
 * dinaikkan harganya, lalu diarsipkan tetap tercetak dengan nama dan harga
 * saat transaksi terjadi.
 *
 * Tanpa jam juga — `occurred_at` dan zona outlet diserahkan pemanggil. Struk
 * yang dicetak ulang bulan depan harus identik dengan yang pertama.
 */

export interface BarisStrukOrder {
  itemName: string;
  variationName: string;
  /**
   * FR-A2 AC keempat — berapa varian yang item ini punya SAAT PENJUALAN.
   *
   * `spec-a:98`: nama varian dicetak **hanya** bila item punya lebih dari
   * satu. Angkanya datang dari `order_line.variation_count_at_sale`, jadi
   * cetakan pertama dan cetak ulang memutuskannya dari sumber yang SAMA —
   * `spec-b:145` menuntut keduanya identik, dan cetak ulang tidak boleh
   * menyentuh tabel katalog untuk mencari tahu.
   *
   * ⛔ Bawaannya 1, bukan `undefined` yang dianggap ">1". Baris yang datang
   * dari jalur lama tidak boleh tiba-tiba mencetak nama varian di struk yang
   * seharusnya identik dengan cetakan pertamanya.
   */
  variationCountAtSale?: number;
  /** ×1000. */
  quantityMilli: number;
  lineTotal: number;
  /** Nama modifier, sudah sebagai snapshot. `qtyMilli` default 1000 (FR-A3). */
  modifier?: readonly { nama: string; harga: number; qtyMilli?: number }[];
}

export interface DataStruk {
  namaMerchant: string;
  alamatOutlet?: string | null;
  receiptNumber: string;
  /** Sudah diformat di zona outlet — `"26 Jul 2026  14:32"`. */
  waktu: string;
  namaKasir: string;
  channel: 'dine_in' | 'takeaway';
  baris: readonly BarisStrukOrder[];
  subtotal: number;
  diskon: number;
  serviceCharge: number;
  /** `[{ nama: 'PBJT 10%', jumlah: 8505 }]` — nama dari `TaxRate.name`. */
  pajak: readonly { nama: string; jumlah: number }[];
  pembulatan: number;
  total: number;
  /** `[{ nama: 'Tunai', jumlah: 100000 }]`. */
  pembayaran: readonly { nama: string; jumlah: number }[];
  kembalian: number;
  /** Ditambahkan pada cetakan kedua dan seterusnya (FR-B11). */
  cetakUlang?: boolean;
}

const CHANNEL: Record<DataStruk['channel'], string> = {
  dine_in: 'Dine-in',
  takeaway: 'Takeaway',
};

/**
 * Format uang untuk STRUK.
 *
 * ⛔ Tanpa awalan `Rp`, berbeda dari layar. `spec-c:378` menunjukkannya
 * langsung (`50.000`, bukan `Rp 50.000`): pada 32 karakter, awalan `Rp` di
 * setiap baris memakan tiga karakter dari nama produk — dan nama produk yang
 * terpotong membuat struk tidak dapat dicocokkan dengan pesanan.
 *
 * Titik ribuan dan tanpa desimal tetap mengikuti design system.
 */
function uang(n: number): string {
  const abs = Math.abs(n).toLocaleString('id-ID');
  return n < 0 ? `− ${abs}` : abs;
}

/** `2000` → `"2"`, `1500` → `"1,5"`. Kuantitas adalah INTEGER ×1000. */
function qty(milli: number): string {
  if (milli % 1000 === 0) return String(milli / 1000);
  return (milli / 1000).toLocaleString('id-ID');
}

export function bangunDokumenStruk(data: DataStruk): ReceiptDocument {
  const baris: BarisStruk[] = [];

  baris.push({ jenis: 'teks', isi: data.namaMerchant, rata: 'tengah', tebal: true });
  if (data.alamatOutlet) baris.push({ jenis: 'teks', isi: data.alamatOutlet, rata: 'tengah' });
  baris.push({ jenis: 'garis' });

  baris.push({ jenis: 'teks', isi: data.receiptNumber });
  baris.push({ jenis: 'teks', isi: data.waktu });
  baris.push({ jenis: 'teks', isi: `Kasir: ${data.namaKasir}` });
  baris.push({ jenis: 'teks', isi: CHANNEL[data.channel] });

  // FR-B11 — cetakan kedua dan seterusnya DITANDAI. Struk kedua yang tidak
  // dapat dibedakan dari yang pertama adalah alat penipuan: pelanggan yang
  // sama dapat menagih dua kali, dan tidak ada yang dapat membuktikan mana
  // yang asli.
  if (data.cetakUlang) baris.push({ jenis: 'teks', isi: '** CETAK ULANG **', rata: 'tengah' });

  baris.push({ jenis: 'garis' });

  for (const b of data.baris) {
    // ⛔ FR-A2 AC keempat. Sebelum ini `variationName` dibawa sepanjang jalur
    // cetak lalu DIJATUHKAN di sini: merchant yang menjual "Kopi Susu Regular"
    // dan "Kopi Susu Large" mencetak dua baris struk yang tidak dapat
    // dibedakan, dan struk adalah satu-satunya bukti yang pelanggan pegang.
    //
    // ⛔ Diputuskan dari `variationCountAtSale` — SNAPSHOT di barisnya —
    // bukan dari nama variannya. Aturan berbasis nama ("sebut bila berbeda
    // dari nama item") DICOBA dan DIKEMBALIKAN: `spec-c:376` mencetak
    // "2x Kopi Susu" untuk baris ber-varian "Regular", jadi ia bertentangan
    // dengan contoh spec sendiri.
    const varian = String(b.variationName ?? '').trim();
    const sebutVarian = (b.variationCountAtSale ?? 1) > 1 && varian.length > 0;
    const nama = sebutVarian ? `${b.itemName} ${varian}` : b.itemName;
    baris.push({
      jenis: 'duaKolom',
      // Nama yang terlalu panjang dipotong `duaKolom` DI KIRI, tidak pernah di
      // angkanya — aturan itu sudah ada; yang berubah hanya panjang teks yang
      // masuk ke sana.
      kiri: `${qty(b.quantityMilli)}× ${nama}`,
      kanan: uang(b.lineTotal),
    });
    for (const m of b.modifier ?? []) {
      // Modifier menjorok, dan harganya hanya dicetak bila bukan nol —
      // `spec-c:405`: "baris dengan nilai 0 tidak dicetak".
      //
      // ⛔ Kuantitas modifier ikut, dan HARGANYA dikalikan (FR-A3,
      // `allow_duplicate`). Mencetak "Extra Shot" dengan harga satu shot pada
      // pesanan dua shot menghasilkan struk yang baris-barisnya tidak
      // menjumlah ke totalnya sendiri — dan pelanggan yang menghitungnya akan
      // menyimpulkan ia ditagih lebih.
      const qtyM = m.qtyMilli ?? 1000;
      const jumlahM = m.harga * (qtyM / 1000);
      baris.push({
        jenis: 'duaKolom',
        kiri: qtyM === 1000 ? `   + ${m.nama}` : `   + ${m.nama} ${qty(qtyM)}×`,
        kanan: jumlahM === 0 ? '' : uang(jumlahM),
      });
    }
  }

  baris.push({ jenis: 'garis' });
  baris.push({ jenis: 'duaKolom', kiri: 'Subtotal', kanan: uang(data.subtotal) });

  // ⛔ `spec-c:405`: "Baris dengan nilai 0 TIDAK dicetak, kecuali pajak 0%
  // yang eksplisit dikonfigurasi." Diskon dan service charge nol adalah
  // ketiadaan, bukan informasi; pajak 0% adalah keputusan merchant yang
  // auditor perlu lihat.
  if (data.diskon !== 0) baris.push({ jenis: 'duaKolom', kiri: 'Diskon', kanan: uang(-Math.abs(data.diskon)) });
  if (data.serviceCharge !== 0) {
    baris.push({ jenis: 'duaKolom', kiri: 'Service', kanan: `+ ${uang(data.serviceCharge)}` });
  }
  for (const p of data.pajak) {
    // Nama dari `TaxRate.name` — `spec-c:404` melarang string generik
    // "Pajak". Baris ini dicetak walau jumlahnya nol.
    baris.push({ jenis: 'duaKolom', kiri: p.nama, kanan: `+ ${uang(p.jumlah)}` });
  }
  if (data.pembulatan !== 0) {
    baris.push({
      jenis: 'duaKolom',
      kiri: 'Pembulatan',
      kanan: data.pembulatan > 0 ? `+ ${uang(data.pembulatan)}` : uang(data.pembulatan),
    });
  }

  baris.push({ jenis: 'garis' });
  baris.push({ jenis: 'duaKolom', kiri: 'TOTAL', kanan: uang(data.total), tebal: true });

  for (const p of data.pembayaran) {
    baris.push({ jenis: 'duaKolom', kiri: p.nama, kanan: uang(p.jumlah) });
  }
  if (data.kembalian !== 0) {
    baris.push({ jenis: 'duaKolom', kiri: 'Kembali', kanan: uang(data.kembalian) });
  }

  baris.push({ jenis: 'garis' });
  baris.push({ jenis: 'kosong' });

  return { baris, potong: true };
}
