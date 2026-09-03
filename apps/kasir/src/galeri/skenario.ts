/**
 * Skenario galeri — TUJUH keadaan, bukan satu keadaan bahagia.
 *
 * ## ⛔ Kenapa daftar ini persis seperti ini
 *
 * Keputusan user, 31 Agustus 2026, setelah cacat halaman-putih lolos ke
 * tangannya: *"cacat itu adalah cacat KEADAAN, bukan cacat komponen. Galeri
 * yang hanya menampilkan keadaan bahagia akan meloloskan bug yang persis sama
 * lagi."*
 *
 * Itu benar, dan buktinya ada di repo ini: 439 test back-office hijau selama
 * layar itu tidak dapat dibuka sama sekali. Semuanya menguji komponen sebagai
 * fungsi; tidak satu pun merendernya melewati transisi keadaan.
 *
 * Tiap skenario karena itu bukan "data contoh" — ia PERTANYAAN yang layar harus
 * jawab, dan jawabannya harus terlihat mata.
 */

export type NamaSkenario =
  | 'kosong'
  | 'normal'
  | 'memuat'
  | 'error'
  | 'offline'
  | 'panjang'
  | 'meluap'
  | 'angka-besar'
  | 'gambar';

export interface Skenario {
  nama: NamaSkenario;
  judul: string;
  /** Pertanyaan yang layar ini harus jawab. Ditampilkan di galeri. */
  tanya: string;
}

export const SKENARIO: readonly Skenario[] = [
  {
    nama: 'kosong',
    judul: 'Kosong',
    tanya:
      'Katalog belum turun. Apakah layar menjelaskan APA yang harus dilakukan, ' +
      'atau hanya menampilkan kotak kosong? Aturan DS #7 menuntut keadaan kosong ada.',
  },
  {
    nama: 'normal',
    judul: 'Normal',
    tanya: 'Keadaan sehari-hari: 18 varian, empat kategori. Pembanding untuk sisanya.',
  },
  {
    nama: 'memuat',
    judul: 'Memuat',
    tanya:
      'Query belum selesai. Apakah ada penanda memuat, atau layar tampak KOSONG ' +
      'dan kasir menyimpulkan katalognya hilang?',
  },
  {
    nama: 'error',
    judul: 'Error',
    tanya:
      'Database lokal menolak. Apakah pesannya menyebut AKIBATNYA bagi kasir ' +
      '("penjualan tidak dapat disimpan"), atau hanya nama galatnya?',
  },
  {
    nama: 'offline',
    judul: 'Offline · antrean belum terkirim',
    tanya:
      'Dua belas penjualan menunggu, tiga gagal. Apakah indikator menyatakannya, ' +
      'dan apakah ia BERBEDA dari "Tersinkron"? Ini nilai jual produknya.',
  },
  {
    nama: 'panjang',
    judul: 'Daftar panjang (120 varian)',
    tanya:
      'Merchant sungguhan punya ratusan menu. Apakah grid tetap dapat dipindai, ' +
      'atau ia menjadi dinding yang menuntut scroll tanpa ujung?',
  },
  {
    nama: 'meluap',
    judul: 'Teks meluap (nama 60 karakter)',
    tanya:
      'Nama menu panjang adalah hal biasa di kafe. Apakah ia dipotong dengan ' +
      'rapi, atau ia merusak tata letak kartu di sebelahnya?',
  },
  {
    nama: 'angka-besar',
    judul: 'Angka besar (Rp 12.500.000)',
    tanya:
      'Katering dan pesanan borongan menghasilkan angka tujuh digit. Apakah ia ' +
      'muat, tetap `tabular-nums`, dan tidak mendorong kolom di sebelahnya?',
  },
  {
    nama: 'gambar',
    judul: 'Gambar produk · campuran',
    tanya:
      'Satu grid, TIGA keadaan sekaligus: sebagian item bergambar, sebagian ' +
      'belum difoto, dan dua yang barisnya ADA tetapi gagal verifikasi. ' +
      'Apakah "belum difoto" terlihat NORMAL — tanpa penanda memuat dan tanpa ' +
      'kotak abu-abu yang terbaca rusak — dan apakah "gagal dimuat" jelas ' +
      'BERBEDA darinya? Dua keadaan itu yang terlihat sama adalah kekosongan ' +
      'menyamar yang membuat `bytea` dicabut.',
  },
];

/** Nama menu 60 karakter — bukan karangan, ia bentuk nama yang kafe benar-benar pakai. */
export const NAMA_PANJANG = 'Kopi Susu Gula Aren Kelapa Pandan Spesial Racikan Barista Kami';

export interface BarisItem {
  item_id: string;
  item_name: string;
  category_id: string | null;
  variation_id: string;
  variation_name: string;
  harga_dasar: number;
  barcode: string | null;
  track_stock: number;
}

const KATEGORI = ['kat-kopi', 'kat-nonkopi', 'kat-makanan', 'kat-pastry'];

const MENU: readonly [string, string, number][] = [
  ['Kopi Susu Gula Aren', 'Regular', 24000],
  ['Kopi Susu Gula Aren', 'Large', 30000],
  ['Americano', 'Hot', 22000],
  ['Americano', 'Iced', 25000],
  ['Cappuccino', 'Regular', 28000],
  ['Kopi Tubruk ORIGEN', 'Regular', 18000],
  ['Cold Brew 500ml', 'Botol', 45000],
  ['Matcha Latte', 'Regular', 32000],
  ['Matcha Latte', 'Large', 38000],
  ['Cokelat Klasik', 'Regular', 26000],
  ['Teh Melati Dingin', 'Regular', 15000],
  ['Nasi Ayam Rica', 'Porsi', 42000],
  ['Roti Bakar Cokelat Keju', 'Porsi', 27000],
  ['Kentang Goreng Truffle', 'Porsi', 35000],
  ['Butter Croissant', 'Pcs', 28000],
  ['Pain au Chocolat', 'Pcs', 32000],
  ['Cinnamon Roll', 'Pcs', 30000],
  ['Banana Bread', 'Slice', 24000],
];

/* ⛔ `item_id` diturunkan dari NAMA, bukan dari indeks baris.
 *
 * Grid K-03 merender ITEM, bukan variasi: dua varian satu produk adalah SATU
 * kartu berbunyi "dari Rp 24.000". Versi pertama fixture ini memberi setiap
 * baris `item-${i}`, jadi "Kopi Susu Gula Aren" Regular dan Large muncul
 * sebagai DUA kartu yang namanya sama persis — dan saya sempat mencatatnya
 * sebagai cacat produk. Ia cacat FIXTURE.
 *
 * Galeri yang datanya berbentuk salah menghasilkan temuan yang salah, dan
 * temuan yang salah lebih mahal daripada tidak ada galeri: ia menuntun
 * perbaikan pada kode yang tidak rusak.
 */
function hashNama(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
}

function idDariNama(nama: string): string {
  return 'item-' + nama.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function baris(itemId: string, nama: string, varian: string, harga: number): BarisItem {
  return {
    item_id: itemId,
    item_name: nama,
    /* ⛔ Kategori diturunkan dari ITEM, bukan dari indeks baris. Kategori
       adalah sifat item; `i % 4` menempatkan dua varian satu produk di
       kategori BERBEDA — keadaan yang tidak dapat ada, dan yang membuat
       pengelompokan apa pun di layar terlihat rusak tanpa sebab. */
    category_id: KATEGORI[Math.abs(hashNama(itemId)) % KATEGORI.length] ?? null,
    variation_id: `${itemId}-v${varian}`,
    variation_name: varian,
    harga_dasar: harga,
    barcode: null,
    track_stock: 1,
  };
}

/** Baris `item` untuk sebuah skenario. */
export function itemUntuk(skenario: NamaSkenario): BarisItem[] {
  if (skenario === 'kosong') return [];

  if (skenario === 'panjang') {
    // 120 varian. Bukan 20 yang "cukup banyak" — merchant sungguhan punya
    // ratusan, dan grid yang nyaman pada 20 dapat runtuh pada 120.
    const hasil: BarisItem[] = [];
    for (let i = 0; i < 120; i += 1) {
      const [nama, varian, harga] = MENU[i % MENU.length]!;
      const n = `${nama} ${Math.floor(i / MENU.length) + 1}`;
      hasil.push(baris(idDariNama(n), n, varian, harga));
    }
    return hasil;
  }

  if (skenario === 'meluap') {
    return [
      baris('item-panjang', NAMA_PANJANG, 'Ukuran Paling Besar Sekali', 24000),
      ...MENU.slice(0, 5).map(([n, v, h]) => baris(idDariNama(n), n, v, h)),
    ];
  }

  if (skenario === 'angka-besar') {
    return [
      baris('item-katering', 'Paket Katering 100 Orang', 'Porsi', 12_500_000),
      baris('item-borongan', 'Pesanan Borongan Kantor', 'Dus', 2_750_000),
      ...MENU.slice(0, 4).map(([n, v, h]) => baris(idDariNama(n), n, v, h)),
    ];
  }

  // normal · memuat · error · offline memakai katalog yang sama; yang berbeda
  // adalah PERILAKU db-nya, bukan isinya.
  return MENU.map(([n, v, h]) => baris(idDariNama(n), n, v, h));
}

/* --------------------------------------------------------------- gambar -- */

export interface BarisGambarPalsu {
  id: string;
  data_base64: string;
  byte: number;
  checksum: string;
  mime: string;
}

/**
 * Gambar produk untuk galeri — DIBUAT dengan encoder yang sama dengan yang
 * back-office pakai, bukan diambil dari berkas.
 *
 * ⛔ Kanvas → `toBlob('image/webp')` → base64, lalu `byte` dan `checksum`
 * dihitung dengan fungsi domain yang SUNGGUHAN. Fixture yang byte-nya diketik
 * tangan akan lolos verifikasi karena angkanya dikarang agar cocok — dan
 * galeri yang seperti itu tidak pernah merender keadaan "rusak" sama sekali,
 * yang justru satu-satunya keadaan yang sulit dibuktikan benar.
 *
 * ⛔ Dua baris SENGAJA dirusak, masing-masing dengan bentuk kerusakan yang
 * berbeda: satu checksum yang tidak cocok (isi berubah, panjang tetap), satu
 * teks yang dipotong (panjang berubah). Keduanya harus mendarat di keadaan
 * yang sama dan terlihat.
 */
export async function gambarUntuk(
  skenario: NamaSkenario,
  item: readonly BarisItem[]
): Promise<BarisGambarPalsu[]> {
  if (skenario !== 'gambar') return [];

  // Item unik, dalam urutan grid.
  const idItem = [...new Set(item.map((b) => b.item_id))];
  const domain = await import('../../../../packages/domain/src/gambar-produk.ts');

  const hasil: BarisGambarPalsu[] = [];
  /* ⛔ Hanya SEBAGIAN item difoto, dan itu bentuk yang paling sering nyata:
     merchant memfoto menu andalannya lebih dulu dan sisanya menyusul —
     kadang selamanya. Grid yang seluruhnya bergambar tidak pernah menjawab
     pertanyaan yang skenario ini ajukan. */
  const bergambar = idItem.filter((_, i) => i % 3 !== 2);

  for (const [i, id] of bergambar.entries()) {
    const base64 = await webpPalsu(i);
    hasil.push({
      id,
      data_base64: base64,
      byte: domain.byteDariBase64(base64),
      checksum: domain.checksumGambar(base64),
      mime: 'image/webp',
    });
  }

  // Kerusakan 1 — isi berubah, PANJANG TETAP. Hanya checksum yang menangkapnya.
  const a = hasil[1];
  if (a) a.checksum = 'deadbeef';

  // Kerusakan 2 — teks DIPOTONG, dan potongannya tetap base64 yang sah.
  // `byte` yang menangkapnya, bukan bentuknya.
  const b = hasil[4];
  if (b) b.data_base64 = b.data_base64.slice(0, Math.floor(b.data_base64.length / 8) * 4);

  return hasil;
}

/**
 * Satu WebP 400×400 sintetis. Warnanya diturunkan dari indeks supaya kartu
 * dapat dibedakan satu sama lain di tangkapan layar.
 *
 * ⛔ Ia TIDAK memakai token warna design system, dan itu bukan pelanggaran
 * aturan #6: ini isi GAMBAR, bukan styling komponen. Foto produk merchant
 * juga tidak akan memakai palet kita.
 */
async function webpPalsu(i: number): Promise<string> {
  const k = document.createElement('canvas');
  k.width = 400;
  k.height = 400;
  const c = k.getContext('2d');
  if (!c) return '';

  const rona = (i * 47) % 360;
  const gr = c.createLinearGradient(0, 0, 400, 400);
  gr.addColorStop(0, `hsl(${rona} 42% 72%)`);
  gr.addColorStop(1, `hsl(${(rona + 40) % 360} 38% 52%)`);
  c.fillStyle = gr;
  c.fillRect(0, 0, 400, 400);
  c.fillStyle = `hsl(${(rona + 180) % 360} 30% 96%)`;
  c.beginPath();
  c.arc(200, 190, 96, 0, Math.PI * 2);
  c.fill();
  c.fillRect(120, 300, 160, 44);

  const blob: Blob | null = await new Promise((r) => k.toBlob(r, 'image/webp', 0.8));
  if (!blob) return '';
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (const byte of buf) s += String.fromCharCode(byte);
  return btoa(s);
}

/** Ringkasan antrean outbox untuk indikator sinkronisasi. */
export function antreanUntuk(skenario: NamaSkenario): { menunggu: number; gagal: number } {
  if (skenario === 'offline') return { menunggu: 12, gagal: 3 };
  return { menunggu: 0, gagal: 0 };
}

export interface BarisOrderPalsu {
  id: string;
  receipt_number: string;
  business_date: string;
  status: string;
  total: number;
  amount_due: number;
  tax_amount: number;
  rounding_adjustment: number;
  occurred_at: string;
  created_by: string;
  voided_by_order_id: string | null;
}

const TANGGAL = '2026-09-01';

function jam(menitLalu: number): string {
  return new Date(Date.parse(`${TANGGAL}T14:32:00+07:00`) - menitLalu * 60_000).toISOString();
}

function order(i: number, total: number, opsi: Partial<BarisOrderPalsu> = {}): BarisOrderPalsu {
  return {
    id: `ord-${i}`,
    receipt_number: `K1-20260901-${String(i).padStart(4, '0')}`,
    business_date: TANGGAL,
    status: 'closed',
    total,
    amount_due: total,
    tax_amount: Math.round((total * 11) / 111),
    rounding_adjustment: 0,
    occurred_at: jam(i * 7),
    created_by: 'user-galeri',
    voided_by_order_id: null,
    ...opsi,
  };
}

/**
 * Riwayat penjualan K-08 untuk sebuah skenario.
 *
 * ⛔ Rantai void ikut, juga di skenario "normal". Order yang dibatalkan tetap
 * berstatus `open` (AC FR-B7 pertama) dan statusnya diturunkan dari ada
 * tidaknya PEMBATAL — jadi riwayat yang hanya berisi penjualan lurus tidak
 * pernah merender penanda pembatalan sama sekali, dan cacat di sana lolos
 * persis seperti cacat halaman-putih lolos.
 */
export function orderUntuk(skenario: NamaSkenario): BarisOrderPalsu[] {
  if (skenario === 'kosong') return [];

  if (skenario === 'angka-besar') {
    return [
      order(1, 12_500_000),
      order(2, 2_750_000),
      order(3, 47_000),
      order(4, 138_000),
    ];
  }

  if (skenario === 'panjang') {
    return Array.from({ length: 60 }, (_, i) => order(i + 1, 18_000 + ((i * 3700) % 96_000)));
  }

  const dasar = [
    order(1, 54_000),
    order(2, 27_000),
    order(3, 132_000),
    order(4, 24_000),
    order(5, 88_500),
    // Order asli yang DIBATALKAN — tetap `open`, penanda datang dari pembatal.
    order(6, 45_000, { status: 'open' }),
    order(7, 0, { status: 'voided', voided_by_order_id: 'ord-6', amount_due: 0, tax_amount: 0 }),
  ];
  return dasar;
}
