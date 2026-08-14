/**
 * `ReceiptRenderer` — implementasi ESC/POS.
 *
 * `ARCH:199`: `render(ReceiptDocument, PrinterProfile) → bytes`. Ia satu dari
 * lima port di `ARCH:§6`, dan ESC/POS adalah implementasi bawaannya; printer
 * fiskal (Italia RT) adalah implementasi lain dari port yang sama.
 *
 * ## Kenapa `ReceiptDocument` ada sebagai perantara
 *
 * `ARCH:204`: "Aplikasi menghasilkan struktur deskriptif (baris, gaya, cut,
 * drawer, logo); renderer menerjemahkannya ke byte. Tanpa pemisahan ini,
 * mendukung printer fiskal berarti menyentuh layar kasir."
 *
 * ## ⛔ MURNI, dan itu syarat cetak ulang
 *
 * Tanpa jam, tanpa acak, tanpa I/O. FR-B11 menuntut struk yang dicetak ulang
 * identik dengan yang pertama; renderer yang menyentuh `Date.now()` membuat
 * itu mustahil dibuktikan.
 *
 * ## ⛔ Perintah printer datang dari PROFIL, bukan dari berkas ini
 *
 * `ERD:445`: `printer_profile` adalah "**Data, bukan kode** — menambah model
 * printer = menambah baris." Byte potong dan byte laci yang di-hardcode di
 * sini membuat model berikutnya menuntut perubahan kode, lalu rilis, lalu
 * pembaruan di setiap perangkat merchant.
 */

/** `ERD:443`. Nilai perintah disimpan sebagai hex berspasi: `"1B 40"`. */
export interface PrinterProfile {
  id: string;
  nama: string;
  paperWidthMm: number;
  charsPerLine: number;
  codepage: string;
  hasCutter: boolean;
  initCommand: string;
  cutCommand: string;
  drawerCommand: string;
  imageSupport: boolean;
}

export type Perataan = 'kiri' | 'tengah' | 'kanan';

export type BarisStruk =
  | { jenis: 'teks'; isi: string; rata?: Perataan; tebal?: boolean }
  /** Nama di kiri, angka di kanan — bentuk paling sering di struk. */
  | { jenis: 'duaKolom'; kiri: string; kanan: string; tebal?: boolean }
  | { jenis: 'garis' }
  | { jenis: 'kosong' };

export interface ReceiptDocument {
  baris: readonly BarisStruk[];
  potong?: boolean;
  bukaLaci?: boolean;
}

/** `"1B 40"` → `[0x1B, 0x40]`. String kosong → tidak ada byte sama sekali. */
function dariHex(hex: string): number[] {
  const bersih = hex.trim();
  if (bersih.length === 0) return [];
  return bersih
    .split(/\s+/)
    .map((h) => Number.parseInt(h, 16))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 0xff);
}

const ESC = 0x1b;
const LF = 0x0a;

const RATA: Record<Perataan, number> = { kiri: 0, tengah: 1, kanan: 2 };

/**
 * Teks → byte, dengan karakter di luar jangkauan diganti, bukan dilempar.
 *
 * ⛔ Nama produk dapat memuat karakter apa pun yang diketik merchant — emoji,
 * aksara Jepang, apa saja. Render yang melempar berarti struk tidak tercetak
 * SAMA SEKALI, dan invariant #3 menetapkan cetak adalah efek samping yang
 * boleh gagal, bukan yang boleh menjatuhkan alur penjualan.
 *
 * Diganti `?`, sama seperti printer sendiri melakukannya untuk karakter di
 * luar codepage-nya.
 */
const TRANSLITERASI: ReadonlyMap<string, string> = new Map([
  // Design system memakai bentuk tipografis; codepage printer termal tidak
  // punya satu pun dari mereka. Diterjemahkan, bukan diganti `?` — struk
  // berbunyi "2? Kopi Susu" dan "? Rp 8.000" adalah angka yang TANDANYA
  // hilang, dan pelanggan yang memegangnya tidak punya cara tahu.
  ['−', '-'], // minus tipografis
  ['×', 'x'], // tanda kali
  ['…', '...'],
  ['–', '-'], // en dash
  ['—', '-'], // em dash
  ['‘', "'"],
  ['’', "'"],
  ['“', '"'],
  ['”', '"'],
  [' ', ' '], // spasi tak-putus
  ['·', '-'], // middle dot — dipakai design system sebagai pemisah
  ['•', '-'], // bullet
]);

/**
 * Bentuk yang BENAR-BENAR tercetak: tipografi diterjemahkan, sisanya `?`.
 *
 * ⛔ Dipanggil SEBELUM hitungan lebar, bukan saat menulis byte. `…`
 * panjangnya 1 karakter di JavaScript tetapi mencetak 3 (`...`); menerjemahkan
 * belakangan membuat baris yang dihitung "pas 32" mencetak 34, dan printer
 * melipatnya sendiri — memindahkan angka ke baris berikutnya tanpa label apa
 * pun. Ditemukan oleh test, setelah transliterasi ditambahkan.
 */
function keAscii(teks: string): string {
  let out = '';
  for (const ch of teks) {
    const ganti = TRANSLITERASI.get(ch);
    if (ganti !== undefined) {
      out += ganti;
      continue;
    }
    out += (ch.codePointAt(0) ?? 0x3f) <= 0x7f ? ch : '?';
  }
  return out;
}

function keByte(teks: string): number[] {
  const out: number[] = [];
  for (const ch of teks) out.push(ch.charCodeAt(0) & 0xff);
  return out;
}

/** Melipat teks pada batas kata; kata yang lebih panjang dari baris dipotong. */
function lipat(teks: string, lebar: number): string[] {
  if (lebar <= 0) return [teks];
  const hasil: string[] = [];
  let kini = '';
  for (const kata of teks.split(' ')) {
    if (kata.length > lebar) {
      if (kini) {
        hasil.push(kini);
        kini = '';
      }
      for (let i = 0; i < kata.length; i += lebar) hasil.push(kata.slice(i, i + lebar));
      continue;
    }
    const calon = kini ? `${kini} ${kata}` : kata;
    if (calon.length > lebar) {
      hasil.push(kini);
      kini = kata;
    } else {
      kini = calon;
    }
  }
  if (kini || hasil.length === 0) hasil.push(kini);
  return hasil;
}

/**
 * Dua kolom, tepat selebar kertas.
 *
 * ⛔ Yang dipotong saat tidak muat adalah kolom KIRI. Memotong dari kanan
 * menghasilkan `"Rp 25.0"` — struk yang menyebut harga yang salah, dan
 * pelanggan yang memegangnya tidak punya cara tahu.
 */
function duaKolom(kiri: string, kanan: string, lebar: number): string {
  const sisa = lebar - kanan.length;
  if (sisa <= 0) return kanan.slice(-lebar);
  const kiriDipotong = kiri.length > sisa ? kiri.slice(0, sisa) : kiri;
  return kiriDipotong + ' '.repeat(lebar - kiriDipotong.length - kanan.length) + kanan;
}

export function renderEscPos(dok: ReceiptDocument, profil: PrinterProfile): Uint8Array {
  const out: number[] = [];
  const lebar = profil.charsPerLine;

  out.push(...dariHex(profil.initCommand));

  for (const b of dok.baris) {
    if (b.jenis === 'kosong') {
      out.push(LF);
      continue;
    }

    if (b.jenis === 'garis') {
      out.push(...keByte('-'.repeat(lebar)), LF);
      continue;
    }

    if (b.jenis === 'duaKolom') {
      if (b.tebal) out.push(ESC, 0x45, 0x01);
      out.push(...keByte(duaKolom(keAscii(b.kiri), keAscii(b.kanan), lebar)), LF);
      if (b.tebal) out.push(ESC, 0x45, 0x00);
      continue;
    }

    // Perataan diserahkan ke PRINTER (`ESC a n`), bukan dihitung dengan spasi:
    // spasi yang dihitung sendiri bergeser begitu codepage atau font berubah.
    const rata = b.rata ?? 'kiri';
    if (rata !== 'kiri') out.push(ESC, 0x61, RATA[rata]);
    if (b.tebal) out.push(ESC, 0x45, 0x01);

    for (const potongan of lipat(keAscii(b.isi), lebar)) {
      out.push(...keByte(potongan), LF);
    }

    if (b.tebal) out.push(ESC, 0x45, 0x00);
    // ⛔ Dikembalikan ke kiri SELALU, bukan hanya saat baris berikutnya
    // berbeda. Perataan ESC/POS bersifat menetap: satu baris tengah yang
    // tidak dikembalikan membuat seluruh sisa struk ikut tertengah.
    if (rata !== 'kiri') out.push(ESC, 0x61, RATA.kiri);
  }

  if (dok.bukaLaci) out.push(...dariHex(profil.drawerCommand));

  // ⛔ Potong hanya untuk profil yang PUNYA pemotong. Perintah potong ke
  // printer tanpa cutter tercetak sebagai karakter sampah di ujung struk.
  if (dok.potong && profil.hasCutter) out.push(...dariHex(profil.cutCommand));

  return Uint8Array.from(out);
}
